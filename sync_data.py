"""Resumable Steam collection, with durable per-app checkpoints and provenance."""
import datetime as dt
from contextlib import contextmanager
import html
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from prepare_data import DB

BASELINE = '2024-10-15'


class AppUnavailable(Exception):
    pass


@contextmanager
def db_connection(path):
    conn = sqlite3.connect(path, timeout=30)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def parse_date(value):
    for pattern in ('%b %d, %Y', '%d %b, %Y', '%Y-%m-%d', '%B %d, %Y'):
        try:
            return dt.datetime.strptime(value.strip(), pattern).date().isoformat()
        except (ValueError, TypeError):
            pass
    return None


def clean(value):
    return html.unescape(re.sub(r'<[^>]*>', '', value)).strip()


def page_tags(page):
    return sorted(set(clean(v) for v in re.findall(r'<a\b[^>]*class="[^\"]*\bapp_tag\b[^\"]*"[^>]*>(.*?)</a>', page, re.S) if clean(v)))


def ensure_schema(path=DB):
    with db_connection(path) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        existing = {r[1] for r in conn.execute('PRAGMA table_info(games)')}
        for name, definition in [('name_zh', 'TEXT'), ('updated_at', 'TEXT'), ('owners', 'TEXT'),
                                 ('ccu', 'INTEGER'), ('coming_soon', 'INTEGER')]:
            if name not in existing:
                conn.execute(f'ALTER TABLE games ADD COLUMN {name} {definition}')
        conn.executescript('''
          CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT);
          CREATE TABLE IF NOT EXISTS sync_queue(appid INTEGER PRIMARY KEY,priority INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,error TEXT,updated_at TEXT);
          CREATE TABLE IF NOT EXISTS app_sources(appid INTEGER,source TEXT,fetched_at TEXT,payload TEXT,
            PRIMARY KEY(appid,source));
          CREATE TABLE IF NOT EXISTS app_index(appid INTEGER PRIMARY KEY,name TEXT,last_modified INTEGER);
        ''')


class SyncManager:
    def __init__(self, path=DB, on_update=None, delay=1.2):
        self.path = Path(path)
        ensure_schema(path)
        self.on_update = on_update
        self.delay = max(1.0, delay)
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.last_request = 0
        self.failures = 0
        self.api_key = os.environ.get('STEAM_API_KEY')
        self.live = {'running': False, 'phase': 'idle', 'currentApp': None, 'lastError': None}
        with self.connect() as conn:
            conn.execute("UPDATE sync_queue SET status='pending' WHERE status='working'")

    def connect(self):
        return db_connection(self.path)

    def get(self, key, default=None):
        with self.connect() as conn:
            row = conn.execute('SELECT value FROM sync_meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, **values):
        with self.connect() as conn:
            conn.executemany('INSERT OR REPLACE INTO sync_meta VALUES(?,?)',
                             [(key, json.dumps(value)) for key, value in values.items()])

    def status(self):
        with self.connect() as conn:
            counts = dict(conn.execute('SELECT status,count(*) FROM sync_queue GROUP BY status'))
            localized = conn.execute("SELECT count(*) FROM games WHERE name_zh IS NOT NULL AND name_zh!=''").fetchone()[0]
            refreshed = conn.execute('SELECT count(*) FROM games WHERE updated_at IS NOT NULL').fetchone()[0]
            discovered = conn.execute('SELECT count(*) FROM app_index').fetchone()[0]
        return {**self.live, 'counts': counts, 'total': sum(counts.values()), 'localized': localized,
                'refreshed': refreshed, 'discovered': discovered, 'baseline': BASELINE,
                'targetDate': self.get('target_date'), 'startedAt': self.get('started_at'),
                'lastUpdatedAt': self.get('last_updated_at'), 'lastCompletedAt': self.get('last_completed_at'),
                'discoveryComplete': self.get('discovery_complete', False),
                'discoverySource': self.get('discovery_source', 'not started'),
                'discoveryCoverage': self.get('discovery_coverage', 'not started'),
                'hasApiKey': bool(self.api_key)}

    def start(self, api_key=None):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return self.status()
            if api_key:
                self.api_key = api_key.strip()
                if self.get('discovery_source') != 'Steam GetAppList':
                    self.put(discovery_complete=False, discovery_cursor=0, discovery_category=0)
            backup = self.path.with_name('catalog-2024-10.sqlite')
            if self.path == DB and not backup.exists():
                with self.connect() as source, db_connection(backup) as dest:
                    source.backup(dest)
            completed = self.get('last_completed_at')
            if completed:
                self.put(discovery_complete=False, discovery_cursor=0, discovery_category=0)
            with self.connect() as conn:
                if completed:
                    conn.execute('DELETE FROM sync_queue')
                # Current reference games first; then recent/undated releases; then old games by review count.
                conn.execute('''INSERT OR IGNORE INTO sync_queue(appid,priority)
                  SELECT id,CASE WHEN id IN (2868840,646570,1092790,2379780) THEN 3000000000
                    WHEN date>=? OR date IS NULL THEN 2000000000+reviews ELSE reviews END FROM games''', (BASELINE,))
                conn.execute("UPDATE sync_queue SET status='pending',attempts=0 WHERE status='failed'")
            self.stop.clear()
            self.live.update(running=True, phase='starting', lastError=None)
            self.put(target_date=dt.date.today().isoformat(), started_at=now())
            self.thread = threading.Thread(target=self.run, name='steam-sync', daemon=True)
            self.thread.start()
        return self.status()

    def pause(self):
        self.stop.set()
        self.live['phase'] = 'pausing' if self.live['running'] else 'paused'
        return self.status()

    def request(self, url, as_json=True):
        for attempt in range(4):
            wait = max(0, self.delay-(time.monotonic()-self.last_request))
            if self.stop.wait(wait):
                raise InterruptedError('Collection paused')
            self.last_request = time.monotonic()
            request = urllib.request.Request(url, headers={
                'User-Agent': 'SteamAtlas/1.0 (local catalog research)',
                'Cookie': 'birthtime=0; mature_content=1; wants_mature_content=1',
                'Accept-Language': 'en-US,en;q=0.9'})
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    raw = response.read().decode('utf-8')
                return json.loads(raw) if as_json else raw
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504):
                    raise
                delay = min(120, max(15, int(error.headers.get('Retry-After', '0') or 0), 15*2**attempt))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                delay = 5*2**attempt
            self.live['phase'] = 'rate-limit backoff'
            if self.stop.wait(delay):
                raise InterruptedError('Collection paused')
        raise RuntimeError('Endpoint unavailable after retries')

    def collect(self, appid):
        sources = {}
        base = 'https://store.steampowered.com/api/appdetails?'
        try:
            english = self.request(base+urllib.parse.urlencode({'appids': appid, 'l': 'english', 'cc': 'us'}))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise AppUnavailable('App removed or unavailable in the collection region') from error
            raise
        entry = english.get(str(appid), {})
        if not entry.get('success'):
            raise AppUnavailable('App details unavailable or removed from store')
        game = entry['data']
        sources['details_en'] = game
        if game.get('type') not in ('game', 'demo'):
            return None, sources
        chinese = self.request(base+urllib.parse.urlencode({'appids': appid, 'l': 'schinese', 'cc': 'us'}))
        localized = chinese.get(str(appid), {}).get('data', {})
        sources['details_zh'] = localized
        # Some publishers keep the English brand name in every Steam locale. Never invent a translation.
        localized_name = localized.get('name') or ''
        name_zh = localized_name if re.search(r'[\u3400-\u9fff]', localized_name) else None
        page = self.request(f'https://store.steampowered.com/app/{appid}/?l=english&cc=us', False)
        tags = page_tags(page)
        sources['store_tags'] = {'tags': tags, 'recognized': bool(tags)}
        params = {'appid': appid, 'num_per_page': 1, 'purchase_type': 1, 'filter': 0,
                  'languages': ['all'], 'review_type': 0, 'day_range': 0, 'display_language': 'english'}
        try:
            response = self.request('https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/?'+
                                    urllib.parse.urlencode({'input_json': json.dumps(params)}))
            summary = response['response']['query_summary']
            if not all(key in summary for key in ('total_positive', 'total_negative', 'total_reviews')):
                raise ValueError('Incomplete review summary')
            sources['reviews_v1'] = summary
        except (urllib.error.HTTPError, KeyError, ValueError):
            response = self.request(f'https://store.steampowered.com/appreviews/{appid}?json=1&language=all&purchase_type=all&num_per_page=1&filter=all')
            if response.get('success') != 1:
                raise ValueError('Invalid review summary')
            summary = response['query_summary']
            sources['reviews_legacy'] = summary
        spy_error = None
        try:
            spy = self.request(f'https://steamspy.com/api.php?request=appdetails&appid={appid}')
            sources['steamspy'] = spy
        except (urllib.error.HTTPError, RuntimeError, urllib.error.URLError, TimeoutError) as error:
            spy = {}
            spy_error = str(error)
        released = game.get('release_date', {})
        price = game.get('price_overview', {})
        positive, negative = int(summary.get('total_positive', 0)), int(summary.get('total_negative', 0))
        row = {'id': appid, 'name': game['name'], 'name_zh': name_zh,
               'date': None if released.get('coming_soon') else parse_date(released.get('date', '')),
               'coming_soon': int(bool(released.get('coming_soon'))), 'free': int(bool(game.get('is_free'))),
               'type': game['type'], 'price': price.get('final', 0)/100 if price else 0 if game.get('is_free') else None,
               'currency': price.get('currency'), 'positive': positive, 'negative': negative,
               'reviews': int(summary.get('total_reviews', positive+negative)),
               'rating': summary.get('review_score_desc', 'No reviews'), 'owners': spy.get('owners'),
               'ccu': spy.get('ccu'), 'updated_at': now(), 'tags': tags, 'warning': spy_error}
        return row, sources

    def save_app(self, row, sources, appid):
        timestamp = now()
        with self.connect() as conn:
            conn.executemany('INSERT OR REPLACE INTO app_sources VALUES(?,?,?,?)',
                             [(appid, source, timestamp, json.dumps(payload, ensure_ascii=False)) for source, payload in sources.items()])
            if row:
                keys = [key for key in row if key not in ('tags', 'warning')]
                columns = ','.join(keys)
                conn.execute(f'INSERT INTO games({columns}) VALUES({",".join("?" for _ in keys)}) '
                             f'ON CONFLICT(id) DO UPDATE SET {",".join(key+"=excluded."+key for key in keys if key!="id")}',
                             [row[key] for key in keys])
                # Empty tags can mean an age gate or changed markup; preserve known tags rather than deleting them.
                if row['tags']:
                    conn.execute('DELETE FROM tags WHERE game_id=?', (appid,))
                    conn.executemany('INSERT OR IGNORE INTO tags VALUES(?,?)', [(appid, tag) for tag in row['tags']])
            conn.execute("UPDATE sync_queue SET status='done',error=?,updated_at=? WHERE appid=?",
                         (row.get('warning') if row else None, timestamp, appid))
            conn.execute('INSERT OR REPLACE INTO sync_meta VALUES(?,?)', ('last_updated_at', json.dumps(timestamp)))

    def discover_page(self):
        key = self.api_key
        cursor = self.get('discovery_cursor', 0)
        if key:
            params = {'key': key, 'last_appid': cursor, 'max_results': 10000,
                      'include_games': 'true', 'include_dlc': 'true', 'include_software': 'true',
                      'include_videos': 'true', 'include_hardware': 'true'}
            # All IDs on the first pass; later refreshes use modification timestamps plus known IDs.
            result = self.request('https://api.steampowered.com/IStoreService/GetAppList/v1/?'+urllib.parse.urlencode(params))['response']
            apps = result.get('apps', [])
            next_cursor = result.get('last_appid', apps[-1]['appid'] if apps else cursor)
            with self.connect() as conn:
                conn.executemany('INSERT OR REPLACE INTO app_index VALUES(?,?,?)', [(int(a['appid']), a.get('name'), a.get('last_modified')) for a in apps])
                conn.executemany('INSERT OR IGNORE INTO sync_queue(appid,priority) VALUES(?,?)', [(int(a['appid']), 1000000000) for a in apps])
            complete = not result.get('have_more_results', bool(apps))
            if not complete and next_cursor <= cursor:
                raise ValueError('Catalog cursor did not advance')
            self.put(discovery_cursor=next_cursor, discovery_complete=complete, discovery_source='Steam GetAppList',
                     discovery_coverage='Steam API catalog plus original baseline')
        else:
            category = self.get('discovery_category', 0)
            params = {'start': cursor, 'count': 100, 'sort_by': 'Released_DESC', 'category1': [998, 10][category],
                      'infinite': 1, 'l': 'english', 'cc': 'us', 'ignore_preferences': 1, 'hidef2p': 0, 'ndl': 1}
            result = self.request('https://store.steampowered.com/search/results/?'+urllib.parse.urlencode(params))
            if not result.get('success'):
                raise ValueError('Store search unavailable')
            page = result.get('results_html', '')
            blocks = re.findall(r'<a\b[^>]*data-ds-appid="(\d+)"[^>]*>(.*?)</a>', page, re.S)
            dates = []
            with self.connect() as conn:
                for appid, block in blocks:
                    title = re.search(r'class="title"[^>]*>(.*?)</span>', block, re.S)
                    released = re.search(r'class="[^"]*search_released[^"]*"[^>]*>(.*?)</div>', block, re.S)
                    date = parse_date(clean(released[1])) if released else None
                    if date:
                        dates.append(date)
                    name = clean(title[1]) if title else ''
                    conn.execute('INSERT OR REPLACE INTO app_index VALUES(?,?,NULL)', (int(appid), name))
                    if date and BASELINE <= date <= self.get('target_date', dt.date.today().isoformat()):
                        conn.execute('INSERT OR IGNORE INTO sync_queue(appid,priority) VALUES(?,?)', (int(appid), 2500000000))
            reached_old = bool(dates) and all(date < BASELINE for date in dates)
            ended = not blocks or cursor+100 >= int(result.get('total_count', 0)) or reached_old
            if ended and category == 0:
                category, cursor = 1, 0
                complete = False
            else:
                cursor += 100
                complete = ended
            self.put(discovery_cursor=cursor, discovery_category=category, discovery_complete=complete,
                     discovery_source='Steam store search (no API key)',
                     discovery_coverage='Searchable releases since October 2024 plus original baseline; not a complete Steam API catalog')

    def run(self):
        changed = 0
        last_publish = time.monotonic()
        try:
            while not self.stop.is_set():
                # Interleave discovery with collection so charts gain new records during the first pass.
                if not self.get('discovery_complete', False) and changed % 10 == 4:
                    self.live['phase'] = 'discovering catalog'
                    self.discover_page()
                with self.connect() as conn:
                    item = conn.execute("SELECT appid,attempts FROM sync_queue WHERE status='pending' ORDER BY priority DESC,appid LIMIT 1").fetchone()
                    if item:
                        conn.execute("UPDATE sync_queue SET status='working',attempts=attempts+1 WHERE appid=?", (item[0],))
                if not item:
                    if not self.get('discovery_complete', False):
                        self.discover_page()
                        continue
                    with self.connect() as conn:
                        failed = conn.execute("SELECT count(*) FROM sync_queue WHERE status='failed'").fetchone()[0]
                    self.live['phase'] = 'completed with errors' if failed else 'completed'
                    if not failed:
                        self.put(last_completed_at=now())
                    break
                appid, attempts = item
                self.live.update(phase='collecting apps', currentApp=appid)
                try:
                    row, sources = self.collect(appid)
                    self.save_app(row, sources, appid)
                    self.failures = 0
                except InterruptedError:
                    with self.connect() as conn:
                        conn.execute("UPDATE sync_queue SET status='pending' WHERE appid=?", (appid,))
                    break
                except AppUnavailable as error:
                    with self.connect() as conn:
                        conn.execute("UPDATE sync_queue SET status='unavailable',error=?,updated_at=? WHERE appid=?",
                                     (str(error), now(), appid))
                    self.failures = 0
                except Exception as error:
                    # Never persist a key-bearing URL in logs or in the UI.
                    self.live['lastError'] = type(error).__name__+': '+str(error).split('?')[0][:180]
                    with self.connect() as conn:
                        conn.execute("UPDATE sync_queue SET status=?,error=? WHERE appid=?",
                                     ('pending' if attempts < 1 else 'failed', self.live['lastError'], appid))
                    self.failures += 1
                    if self.failures >= 8:
                        self.live['phase'] = 'paused after repeated endpoint failures'
                        break
                changed += 1
                if changed == 4 or time.monotonic()-last_publish > 45:
                    if self.on_update:
                        self.on_update()
                    last_publish = time.monotonic()
        except InterruptedError:
            self.live['phase'] = 'paused'
        except Exception as error:
            self.live.update(phase='paused after discovery error', lastError=type(error).__name__+': '+str(error).split('?')[0][:180])
        finally:
            if self.on_update and changed:
                self.on_update()
            self.live.update(running=False, currentApp=None)
            if self.stop.is_set():
                self.live['phase'] = 'paused'
