import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from server import Catalog
from sync_data import SyncManager, page_tags, parse_date, db_connection, AppUnavailable


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'catalog.sqlite'
        with db_connection(self.path) as conn:
            conn.executescript('''
              CREATE TABLE games(id INTEGER PRIMARY KEY,name TEXT,date TEXT,free INTEGER,type TEXT,
                price REAL,currency TEXT,positive INTEGER,negative INTEGER,reviews INTEGER,rating TEXT);
              CREATE TABLE tags(game_id INTEGER,tag TEXT,PRIMARY KEY(game_id,tag));
              INSERT INTO games VALUES(1,'Old title','2024-01-01',0,'game',5,'USD',1,0,1,'Positive');
              INSERT INTO tags VALUES(1,'2D');
            ''')
        self.manager = SyncManager(self.path)

    def tearDown(self):
        self.manager.stop.set()
        if self.manager.thread:
            self.manager.thread.join(5)
        self.folder.cleanup()

    def mock_request(self, url, as_json=True):
        if 'appdetails?' in url:
            data = {'type': 'game', 'name': '\u4e2d\u6587\u6e38\u620f' if 'l=schinese' in url else 'Updated title',
                    'is_free': False, 'price_overview': {'final': 1500, 'currency': 'USD'},
                    'release_date': {'coming_soon': False, 'date': 'Oct 7, 2026'}}
            return {'1': {'success': True, 'data': data}}
        if 'GetAppReviews' in url:
            params = json.loads(parse_qs(urlparse(url).query)['input_json'][0])
            self.assertEqual(params['languages'], ['all'])
            self.assertEqual(params['purchase_type'], 1)
            return {'response': {'query_summary': {'total_positive': 90, 'total_negative': 10, 'total_reviews': 100, 'review_score_desc': 'Very Positive'}}}
        if 'steamspy' in url:
            return {'owners': '20,000 .. 50,000', 'ccu': 10}
        return '<a class="app_tag" href="/tags/en/Arcade/"> Arcade </a>'

    def test_date_and_html_cleaning(self):
        self.assertEqual(parse_date('23 Jan, 2019'), '2019-01-23')
        self.assertIsNone(parse_date('Coming soon'))
        self.assertEqual(page_tags('<a href="x" class="app_tag">Point &amp; Click</a>'), ['Point & Click'])

    def test_upsert_localized_title_reviews_tags_and_provenance(self):
        self.manager.request = self.mock_request
        row, sources = self.manager.collect(1)
        self.manager.save_app(row, sources, 1)
        catalog = Catalog(self.path)
        self.assertEqual(catalog.games[1]['name_zh'], '\u4e2d\u6587\u6e38\u620f')
        self.assertEqual(catalog.games[1]['reviews'], 100)
        self.assertEqual(catalog.games[1]['date'], '2026-10-07')
        self.assertEqual(catalog.game_tags[1], {'Arcade'})
        self.assertEqual(catalog.search('\u4e2d\u6587')[0]['id'], 1)
        with db_connection(self.path) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM app_sources').fetchone()[0], 5)

    def test_empty_scraped_tags_preserve_previous_known_tags(self):
        self.manager.request = self.mock_request
        row, sources = self.manager.collect(1)
        row['tags'] = []
        self.manager.save_app(row, sources, 1)
        with db_connection(self.path) as conn:
            self.assertEqual(conn.execute('SELECT tag FROM tags').fetchone()[0], '2D')

    def test_working_item_resumes_after_restart(self):
        with db_connection(self.path) as conn:
            conn.execute("INSERT INTO sync_queue(appid,status) VALUES(1,'working')")
        SyncManager(self.path)
        with db_connection(self.path) as conn:
            self.assertEqual(conn.execute('SELECT status FROM sync_queue').fetchone()[0], 'pending')

    def test_discovery_adds_post_baseline_releases_and_stops_at_old_page(self):
        self.manager.put(target_date='2026-10-08')
        def request(url, as_json=True):
            cursor=int(parse_qs(urlparse(url).query)['start'][0])
            date='Oct 7, 2026' if cursor==0 else 'Sep 1, 2024'
            return {'success':1,'total_count':1000,'results_html':f'<a data-ds-appid="99"><span class="title">New title</span><div class="search_released">{date}</div></a>'}
        self.manager.request=request
        self.manager.discover_page()
        with db_connection(self.path) as conn:
            self.assertEqual(conn.execute('SELECT appid FROM sync_queue').fetchone()[0],99)
        self.manager.discover_page()
        self.assertEqual(self.manager.get('discovery_category'),1)
        self.assertEqual(self.manager.get('discovery_cursor'),0)

    def test_completion_is_not_claimed_when_queue_contains_failures(self):
        self.manager.put(discovery_complete=True)
        with db_connection(self.path) as conn:
            conn.execute("INSERT INTO sync_queue(appid,status) VALUES(1,'failed')")
        self.manager.run()
        self.assertEqual(self.manager.status()['phase'],'completed with errors')
        self.assertIsNone(self.manager.status()['lastCompletedAt'])

    def test_keyed_discovery_requests_full_catalog_without_persisting_key(self):
        self.manager.api_key = 'fixture-key'
        def request(url, as_json=True):
            params = parse_qs(urlparse(url).query)
            for kind in ('games', 'dlc', 'software', 'videos', 'hardware'):
                self.assertEqual(params['include_'+kind], ['true'])
            return {'response': {'apps': [{'appid': 99, 'name': 'New Game', 'last_modified': 100}], 'last_appid': 99, 'have_more_results': False}}
        self.manager.request = request
        self.manager.discover_page()
        self.assertTrue(self.manager.get('discovery_complete'))
        self.assertIsNone(self.manager.get('api_key'))
        self.assertNotIn('fixture-key', json.dumps(self.manager.status()))

    def test_unavailable_apps_keep_baseline_and_do_not_stop_the_job(self):
        with db_connection(self.path) as conn:
            conn.execute('INSERT INTO sync_queue(appid) VALUES(1)')
        self.manager.put(discovery_complete=True)
        def unavailable(appid):
            raise AppUnavailable('Removed app')
        self.manager.collect = unavailable
        self.manager.run()
        self.assertEqual(self.manager.status()['counts']['unavailable'], 1)
        with db_connection(self.path) as conn:
            self.assertEqual(conn.execute('SELECT name FROM games').fetchone()[0], 'Old title')

    def test_unchanged_english_locale_title_is_not_invented_as_chinese(self):
        def request(url, as_json=True):
            result = self.mock_request(url, as_json)
            if 'l=schinese' in url:
                result['1']['data']['name'] = 'Updated title'
            return result
        self.manager.request=request
        row, _ = self.manager.collect(1)
        self.assertIsNone(row['name_zh'])


if __name__ == '__main__':
    unittest.main()
