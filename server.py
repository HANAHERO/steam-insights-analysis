"""Local catalog API and production web server. No third-party Python packages required."""
import argparse
import collections
import functools
import json
import math
import re
import sqlite3
import time
import datetime as dt
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from prepare_data import DB, ROOT, build
from sync_data import SyncManager


def wilson(positive, total):
    if not total:
        return 0
    p = positive / total
    z = 1.96
    return (p + z*z/(2*total) - z*math.sqrt((p*(1-p)+z*z/(4*total))/total)) / (1+z*z/total)


class Catalog:
    def __init__(self, path=DB):
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        self.games = {r['id']: dict(r) for r in conn.execute('SELECT * FROM games')}
        self.metadata = {}
        if conn.execute("SELECT 1 FROM sqlite_master WHERE name='sync_meta'").fetchone():
            self.metadata = {key: json.loads(value) for key, value in conn.execute("SELECT key,value FROM sync_meta WHERE key!='api_key'")}
        self.tags = collections.defaultdict(set)
        self.game_tags = collections.defaultdict(set)
        for game_id, tag in conn.execute('SELECT game_id,tag FROM tags'):
            if game_id in self.games:
                self.tags[tag].add(game_id)
                self.game_tags[game_id].add(tag)
        conn.close()
        self.taxonomy = json.loads((ROOT / 'taxonomy.json').read_text(encoding='utf-8'))
        assigned = set().union(*(set(v['tags']) for v in self.taxonomy.values()))
        self.taxonomy['Others']['tags'] += sorted(set(self.tags) - assigned)
        for group in self.taxonomy.values():
            group['tags'] = sorted(t for t in set(group['tags']) if t in self.tags)

    def meta(self):
        return {'snapshot': '2024-10', 'lastUpdatedAt': self.metadata.get('last_updated_at'),
                'lastCompletedAt': self.metadata.get('last_completed_at'), 'today': dt.date.today().isoformat(),
                'total': len(self.games), 'tags': len(self.tags),
                'types': dict(collections.Counter(g['type'] for g in self.games.values())),
                'taxonomy': self.taxonomy,
                'tagCounts': {t: len(ids) for t, ids in self.tags.items()},
                'source': 'https://github.com/NewbieIndieGameDev/steam-insights',
                'taxonomyNote': 'Groups reconstructed from the reference image and Steamworks documentation; some tags belong to multiple groups. Edit taxonomy.json to customize.'}

    def eligible(self, options):
        start, end = options.get('start', '1997-01-01'), options.get('end', dt.date.today().isoformat())
        minimum = max(0, int(options.get('minReviews', 0)))
        kind, paid = options.get('type', 'game'), options.get('price', 'all')
        upcoming = options.get('undated') == 'true'
        ids = {i for i, g in self.games.items()
               if (kind == 'all' or kind == g['type']) and g['reviews'] >= minimum
               and (paid == 'all' or (paid == 'free') == bool(g['free']))
               and ((g['date'] is not None and start <= g['date'] <= end) or (upcoming and g['date'] is None))}
        for tag in options.get('include', '').split('|'):
            if tag:
                ids &= self.tags.get(tag, set())
        for tag in options.get('exclude', '').split('|'):
            if tag:
                ids -= self.tags.get(tag, set())
        return ids

    def game(self, i):
        g = dict(self.games[i])
        total = g['positive'] + g['negative']
        g.update(tags=sorted(self.game_tags[i]), positiveRate=round(g['positive']/total*100, 2) if total else None,
                 negativeRate=round(g['negative']/total*100, 2) if total else None,
                 wilson=round(wilson(g['positive'], total)*100, 2))
        return g

    def search(self, query, options=None):
        query = query.casefold().strip()
        if not query:
            return []
        if query in ('\u6740\u622e\u5c16\u5854', '\u6740\u622e\u5c16\u58542', '\u6740\u622e\u5c16\u5854 2'):
            query = 'slay the spire 2' if '2' in query else 'slay the spire'
        matches = [i for i, g in self.games.items() if query in g['name'].casefold()
                   or query in (g.get('name_zh') or '').casefold() or str(i) == query]
        availability = {}
        if options is not None:
            eligible = self.eligible(options)
            chart = self.chart(json.dumps(options, sort_keys=True))
            mode = options.get('chart', 'pairs')
            rows = chart['rows']
            plotted_ids = {r['id'] for r in rows if 'id' in r}
            for i in matches:
                g = self.games[i]
                available, reason = False, 'Individual games are not plotted in this aggregate view.'
                if i not in eligible:
                    reason = ('No release date; enable undated records.' if not g['date'] else
                              'Outside the selected release date range.' if not options.get('start', '1997-01-01') <= g['date'] <= options.get('end', dt.date.today().isoformat()) else
                              'Excluded by the current date, type, price, review or tag filters.')
                elif mode == 'pairs':
                    visible = [r for r in rows if (options.get('xLog', 'true') != 'true' or r[options.get('xMetric', 'x')] > 0)
                               and (options.get('yLog', 'true') != 'true' or r[options.get('yMetric', 'y')] > 0)]
                    available = any(r['a'] in self.game_tags[i] and r['b'] in self.game_tags[i] for r in visible)
                    reason = 'Available to highlight.' if available else 'No visible tag pair matches this game.'
                elif mode in ('deck_reviews', 'deck_best', 'ratings'):
                    available = i in plotted_ids
                    reason = 'Available to highlight.' if available else ('No reviews to plot.' if mode == 'deck_reviews' and not g['reviews'] else
                             'Outside the selected deckbuilder cohort or ranking limit.' if mode.startswith('deck_') else
                             'Outside the selected rating or ranking limit.')
                availability[i] = (available, reason)
        matches.sort(key=lambda i: (not availability.get(i, (True, ''))[0],
                                   self.games[i]['name'].casefold() != query, -self.games[i]['reviews']))
        results = []
        for i in matches[:30]:
            g = self.game(i)
            if options is not None:
                g.update(canHighlight=availability[i][0], highlightReason=availability[i][1])
            results.append(g)
        return results

    def details(self, options):
        ids = self.eligible(options)
        for tag in (options.get('a'), options.get('b')):
            if tag:
                ids &= self.tags.get(tag, set())
        sort = options.get('sort', 'reviews')
        ordered = sorted(ids, key=lambda i: self.games[i]['date'] or '' if sort == 'date' else self.games[i]['reviews'], reverse=True)
        offset = max(0, int(options.get('offset', 0)))
        return {'total': len(ids), 'rows': [self.game(i) for i in ordered[offset:offset+50]]}

    @functools.lru_cache(maxsize=48)
    def chart(self, encoded):
        opts = json.loads(encoded)
        began = time.perf_counter()
        ids = self.eligible(opts)
        universe = ids.copy()
        kind = opts.get('chart', 'pairs')
        result = {'kind': kind, 'matched': len(ids), 'rows': [], 'series': [], 'insights': []}
        if kind.startswith('deck_'):
            deckbuilders = self.tags.get('Roguelike Deckbuilder', set()).copy()
            if opts.get('deckScope', 'broad') == 'broad':
                rogues = self.tags.get('Roguelike', set()) | self.tags.get('Roguelite', set()) | self.tags.get('Traditional Roguelike', set())
                cards = self.tags.get('Deckbuilding', set()) | self.tags.get('Card Battler', set()) | self.tags.get('Card Game', set())
                deckbuilders |= rogues & cards
            ids &= deckbuilders
        total_reviews = sum(self.games[i]['reviews'] for i in ids)
        result['stats'] = {'games': len(ids), 'reviews': total_reviews,
                           'reviewed': sum(self.games[i]['reviews'] > 0 for i in ids),
                           'free': sum(self.games[i]['free'] for i in ids),
                           'undated': sum(self.games[i]['date'] is None for i in ids)}
        if kind == 'pairs':
            left = opts.get('left', 'Genres')
            right = opts.get('right', 'Dimensions')
            a_tags = opts.get('aTags', '').split('|') if opts.get('aTags') else self.taxonomy.get(left, {'tags': []})['tags']
            b_tags = opts.get('bTags', '').split('|') if opts.get('bTags') else self.taxonomy.get(right, {'tags': []})['tags']
            sets = {t: self.tags.get(t, set()) & ids for t in set(a_tags+b_tags)}
            seen = set()
            rows = []
            min_common = max(0, int(opts.get('minCommon', 1)))
            for a in a_tags:
                for b in b_tags:
                    key = tuple(sorted((a, b)))
                    if a == b or key in seen:
                        continue
                    seen.add(key)
                    common = len(sets[a] & sets[b])
                    union = len(sets[a]) + len(sets[b]) - common
                    if common < min_common or not union:
                        continue
                    expected = len(sets[a])*len(sets[b])/len(ids) if ids else 0
                    rows.append({'a': a, 'b': b, 'x': union, 'y': common,
                                 'countA': len(sets[a]), 'countB': len(sets[b]),
                                 'jaccard': round(common/union*100, 2),
                                 'lift': round(common/expected, 3) if expected else 0})
            result['rows'] = sorted(rows, key=lambda r: r['y'], reverse=True)
            if rows:
                biggest = max(rows, key=lambda r: r['y'])
                strongest = max(rows, key=lambda r: r['jaccard'])
                result['insights'] = [
                    {'label': 'MOST COMMON PAIR', 'value': f"{biggest['a']} + {biggest['b']}", 'detail': f"{biggest['y']:,} games carry both tags."},
                    {'label': 'HIGHEST OVERLAP', 'value': f"{strongest['jaccard']}%", 'detail': f"{strongest['a']} + {strongest['b']} \xb7 intersection / union."},
                    {'label': 'READING THE MAP', 'value': 'Frequency, not opportunity', 'detail': 'Rare combinations can be explored, but low supply alone does not establish demand.'}]
        elif kind in ('releases', 'deck_releases', 'dimensions', 'representation'):
            period = opts.get('period', 'year')
            length = 7 if period == 'month' else 4
            periods = collections.Counter(self.games[i]['date'][:length] for i in ids if self.games[i]['date'])
            denominators = collections.Counter(self.games[i]['date'][:length] for i in universe if self.games[i]['date'])
            if periods:
                low, high = min(periods), max(periods)
                if length == 4:
                    keys = [str(y) for y in range(int(low), int(high)+1)]
                else:
                    y, m = map(int, low.split('-'))
                    keys = []
                    while f'{y:04}-{m:02}' <= high:
                        keys.append(f'{y:04}-{m:02}')
                        m += 1
                        if m == 13:
                            y, m = y+1, 1
            else:
                keys = []
            result['rows'] = [{'period': k, 'count': periods[k]} for k in keys]
            selected = (['2D', '2.5D', '3D'] if opts.get('dim25') == 'true' else ['2D', '3D']) if kind == 'dimensions' else [opts.get('tag', 'Female Protagonist')] if kind == 'representation' else ['Roguelike Deckbuilder'] if kind == 'deck_releases' else []
            for tag in selected:
                members = ids if kind == 'deck_releases' else ids & self.tags.get(tag, set())
                counts = collections.Counter(self.games[i]['date'][:length] for i in members if self.games[i]['date'])
                result['series'].append({'name': tag, 'values': [counts[k] for k in keys],
                                         'shares': [round(counts[k]/denominators[k]*100, 2) if denominators[k] else 0 for k in keys]})
            if kind == 'releases':
                positive = collections.Counter(self.games[i]['date'][:length] for i in ids if self.games[i]['date'] and self.games[i]['rating'] in ('Positive', 'Mostly Positive', 'Very Positive', 'Overwhelmingly Positive'))
                hits = collections.Counter(self.games[i]['date'][:length] for i in ids if self.games[i]['date'] and self.games[i]['reviews'] >= 10000)
                result['series'] = [{'name': name, 'values': [values[k] for k in keys],
                                     'shares': [round(values[k]/periods[k]*100, 2) if periods[k] else 0 for k in keys]}
                                    for name, values in [('All releases', periods), ('Positive rating', positive), ('10,000+ reviews', hits)]]
            if kind == 'dimensions':
                for series in result['series']:
                    series['composition'] = [round(series['values'][i]/sum(s['values'][i] for s in result['series'])*100, 2) if sum(s['values'][i] for s in result['series']) else 0 for i in range(len(keys))]
            if keys:
                peak = max(keys, key=lambda k: periods[k])
                result['insights'] = [{'label': 'BUSIEST PERIOD', 'value': peak, 'detail': f'{periods[peak]:,} releases in this selection.'},
                                      {'label': 'DATE COVERAGE', 'value': f'{sum(periods.values()):,}', 'detail': f"Dated records only. {result['stats']['undated']:,} undated records omitted from time charts."},
                                      {'label': 'DATA UPDATED', 'value': self.metadata.get('last_updated_at', '2024-10')[:10], 'detail': 'Tags reflect collection time, not historical tag assignment. The current year may be partial.'}]
        elif kind == 'words':
            stop = set('the a an and of to in for on with is it at by from game games edition demo dlc ii iii iv v pack chapter part episode'.split())
            counts = collections.Counter()
            for i in ids:
                counts.update(set(w for w in re.findall(r"[a-z]+(?:'[a-z]+)?", self.games[i]['name'].lower()) if len(w) > 1 and w not in stop))
            result['rows'] = [{'name': w, 'value': c} for w, c in counts.most_common(int(opts.get('limit', 80)))]
            result['insights'] = [{'label': 'COUNTING METHOD', 'value': 'One title, one vote', 'detail': 'Each English word counts once per game. Common stop words, Demo and edition markers are removed.'}]
        elif kind == 'themes':
            group = opts.get('group', 'Themes')
            counts = [(t, len(ids & self.tags[t])) for t in self.taxonomy.get(group, {'tags': []})['tags']]
            result['rows'] = [{'name': t, 'value': n, 'share': round(n/len(ids)*100, 2) if ids else 0} for t, n in sorted(counts, key=lambda x: x[1], reverse=True) if n][:int(opts.get('limit', 40))]
            if result['rows']:
                best = result['rows'][0]
                result['insights'] = [{'label': 'MOST COMMON TAG', 'value': best['name'], 'detail': f"{best['value']:,} games \xb7 {best['share']}% of the selection."},
                                      {'label': 'OVERLAPPING TAGS', 'value': 'Not market shares', 'detail': 'Games may carry several tags. Percentages are not expected to add to 100%.'}]
        elif kind in ('ratings', 'deck_best'):
            target = opts.get('rating', 'Overwhelmingly Positive')
            selected = [i for i in ids if (kind == 'deck_best' and self.games[i]['reviews'] >= max(1, int(opts.get('bestMinReviews', 1000)))) or (kind == 'ratings' and self.games[i]['rating'] == target)]
            sort = opts.get('rank', 'reviews')
            def score(i):
                g = self.games[i]
                n = g['positive'] + g['negative']
                return wilson(g['positive'], n) if sort == 'wilson' else (g['negative']/n if n else 0) if sort == 'negative' else (g['positive']/n if n else 0) if sort == 'rate' else g['reviews']
            selected.sort(key=lambda i: (score(i), self.games[i]['reviews']), reverse=True)
            result['totalRanked'] = len(selected)
            result['rows'] = [self.game(i) for i in selected[:int(opts.get('limit', 30))]]
            result['insights'] = [{'label': 'MATCHING GAMES', 'value': f'{len(selected):,}', 'detail': 'Games meeting the review sample floor in this cohort.' if kind == 'deck_best' else 'Ratings use the stored Steam rating description, not a recreated threshold.'},
                                  {'label': 'RANKING', 'value': 'Wilson score available', 'detail': 'The 95% lower confidence bound balances positive ratio and review sample size.'}]
        elif kind == 'deck_reviews':
            selected = sorted((i for i in ids if self.games[i]['date'] and self.games[i]['reviews'] > 0), key=lambda i: self.games[i]['date'])
            result['rows'] = [self.game(i) for i in selected]
            result['insights'] = [{'label': 'PLOTTED GAMES', 'value': f'{len(selected):,}', 'detail': 'Games with a release date and at least one review. Hover to inspect; search to highlight.'},
                                  {'label': 'REVIEW SNAPSHOT', 'value': 'Mixed collection dates' if self.metadata.get('last_updated_at') else '2024-10', 'detail': 'Reviews are cumulative at collection time. Baseline and refreshed records have different dates; hover a game to see its update date.'}]
        else:
            raise ValueError('Unknown chart')
        result['elapsedMs'] = round((time.perf_counter()-began)*1000)
        return result


class Handler(SimpleHTTPRequestHandler):
    catalog = None
    sync = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'dist'), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith('/api/'):
            return super().do_GET()
        opts = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
        catalog = self.catalog
        try:
            if parsed.path == '/api/meta':
                data = catalog.meta()
            elif parsed.path == '/api/chart':
                data = catalog.chart(json.dumps(opts, sort_keys=True))
            elif parsed.path == '/api/search':
                options = {k: v for k, v in opts.items() if k != 'q'}
                data = catalog.search(opts.get('q', ''), options if options else None)
            elif parsed.path == '/api/games':
                data = catalog.details(opts)
            elif parsed.path == '/api/sync/status':
                data = self.sync.status()
            elif parsed.path == '/api/health':
                data = {'status': 'ok'}
            else:
                self.send_error(404)
                return
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
        except (ValueError, KeyError, TypeError) as error:
            body = json.dumps({'error': str(error)}).encode()
            self.send_response(400)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and urlparse(origin).hostname not in ('localhost', '127.0.0.1'):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > 4096:
                raise ValueError('Request body too large')
            options = json.loads(self.rfile.read(length) or '{}')
            if self.path == '/api/sync/start':
                data = self.sync.start(options.get('apiKey'))
            elif self.path == '/api/sync/pause':
                data = self.sync.pause()
            else:
                self.send_error(404)
                return
            body = json.dumps(data).encode()
            self.send_response(200)
        except (ValueError, TypeError) as error:
            body = json.dumps({'error': str(error)}).encode()
            self.send_response(400)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    args = parser.parse_args()
    if not DB.exists():
        build()
    def reload_catalog():
        previous = Handler.catalog
        Handler.catalog = Catalog()
        if previous:
            previous.chart.cache_clear()
    Handler.sync = SyncManager(on_update=reload_catalog)
    Handler.catalog = Catalog()
    print(f'Steam Atlas ready at http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
