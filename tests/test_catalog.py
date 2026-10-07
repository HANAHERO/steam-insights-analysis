import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import Catalog, wilson


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        path = Path(cls.directory.name) / 'fixture.sqlite'
        conn = sqlite3.connect(path)
        conn.executescript('''
          CREATE TABLE games(id INTEGER PRIMARY KEY,name TEXT,date TEXT,free INTEGER,type TEXT,
            price REAL,currency TEXT,positive INTEGER,negative INTEGER,reviews INTEGER,rating TEXT);
          CREATE TABLE tags(game_id INTEGER,tag TEXT,PRIMARY KEY(game_id,tag));
        ''')
        conn.executemany('INSERT INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?)', [
            (1, 'Dragon Alpha', '2020-01-01', 0, 'game', 10, 'USD', 90, 10, 100, 'Very Positive'),
            (2, 'Dragon Dragon Beta', '2022-03-01', 1, 'game', 0, None, 1, 0, 1, 'Positive'),
            (3, 'Gamma', '2022-04-01', 0, 'game', 20, 'EUR', 980, 20, 1000, 'Overwhelmingly Positive'),
            (4, 'Demo', '2022-02-01', 1, 'demo', 0, None, 0, 0, 0, 'No reviews'),
            (5, 'Slay the Spire 2', None, 0, 'game', None, None, 0, 0, 0, 'No reviews'),
            (6, 'Old Game', '1990-01-01', 0, 'game', 5, 'USD', 0, 1, 1, 'Negative'),
            (7, 'No Reviews', '2022-05-01', 0, 'game', 10, 'USD', 0, 0, 0, 'No reviews'),
        ])
        conn.executemany('INSERT INTO tags VALUES(?,?)', [
            (1, 'Arcade'), (1, '2D'), (1, 'Female Protagonist'),
            (2, 'Arcade'), (2, '3D'), (2, 'Roguelike Deckbuilder'),
            (3, 'Platformer'), (3, '2D'), (3, 'Roguelike Deckbuilder'),
            (4, 'Arcade'), (4, '2D'), (5, 'Arcade'), (5, 'Roguelike Deckbuilder'),
            (6, 'Arcade'), (6, '2D'), (7, 'Platformer'), (7, '3D'),
        ])
        conn.commit()
        conn.close()
        cls.catalog = Catalog(path)

    @classmethod
    def tearDownClass(cls):
        cls.catalog.chart.cache_clear()
        cls.directory.cleanup()

    def chart(self, **opts):
        return self.catalog.chart(json.dumps(opts, sort_keys=True))

    def test_default_universe_excludes_demo_undated_and_old_games(self):
        self.assertEqual(self.catalog.eligible({}), {1, 2, 3, 7})
        self.assertEqual(self.catalog.eligible({'undated': 'true'}), {1, 2, 3, 5, 7})

    def test_pair_union_intersection_and_association(self):
        row = self.chart(chart='pairs', aTags='Arcade', bTags='2D')['rows'][0]
        self.assertEqual((row['x'], row['y'], row['countA'], row['countB']), (3, 1, 2, 2))
        self.assertAlmostEqual(row['jaccard'], 33.33)
        self.assertEqual(row['lift'], 1)

    def test_required_tags_are_and_excluded_tags_are_or(self):
        self.assertEqual(self.catalog.eligible({'include': 'Arcade|2D'}), {1})
        self.assertEqual(self.catalog.eligible({'exclude': 'Arcade|2D'}), {7})
        self.assertEqual(self.catalog.eligible({'include': 'not-a-real-tag'}), set())

    def test_pairs_deduplicated_and_zero_overlap_supported(self):
        rows = self.chart(chart='pairs', aTags='Arcade|Platformer', bTags='Arcade|Platformer', minCommon='0')['rows']
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['x'], rows[0]['y']), (4, 0))

    def test_time_series_fills_missing_years(self):
        result = self.chart(chart='releases')
        self.assertEqual(result['rows'], [{'period': '2020', 'count': 1}, {'period': '2021', 'count': 0}, {'period': '2022', 'count': 3}])

    def test_representation_uses_all_selected_releases_as_denominator(self):
        series = self.chart(chart='representation', tag='Female Protagonist')['series'][0]
        self.assertEqual(series['values'], [1, 0, 0])
        self.assertEqual(series['shares'], [100, 0, 0])

    def test_words_count_once_per_title(self):
        words = {r['name']: r['value'] for r in self.chart(chart='words')['rows']}
        self.assertEqual(words['dragon'], 2)
        self.assertNotIn('game', words)

    def test_release_overview_includes_positive_and_hit_series(self):
        result = self.chart(chart='releases')
        self.assertEqual([s['name'] for s in result['series']], ['All releases', 'Positive rating', '10,000+ reviews'])
        self.assertEqual(result['series'][1]['values'], [1, 0, 2])
        self.assertEqual(result['series'][2]['values'], [0, 0, 0])

    def test_deckbuilder_proportion_uses_full_catalog_denominator(self):
        result = self.chart(chart='deck_releases', deckScope='tag')
        self.assertEqual(result['series'][0]['values'], [2])
        self.assertAlmostEqual(result['series'][0]['shares'][0], 66.67)

    def test_dimension_composition_sums_to_100(self):
        result = self.chart(chart='dimensions')
        for i, row in enumerate(result['rows']):
            self.assertAlmostEqual(sum(s['composition'][i] for s in result['series']), 100 if row['count'] else 0, places=1)

    def test_rating_presets_use_original_labels(self):
        rows = self.chart(chart='ratings', rating='Overwhelmingly Positive')['rows']
        self.assertEqual([r['id'] for r in rows], [3])

    def test_wilson_penalizes_tiny_samples(self):
        self.assertLess(wilson(1, 1), wilson(980, 1000))
        self.assertEqual(wilson(0, 0), 0)

    def test_deck_reviews_do_not_invent_undated_points(self):
        rows = self.chart(chart='deck_reviews', undated='true')['rows']
        self.assertEqual([r['id'] for r in rows], [2, 3])
        search = self.catalog.search('\u6740\u622e\u5c16\u58542')
        self.assertEqual(search[0]['id'], 5)
        self.assertIsNone(search[0]['date'])

    def test_detail_counts_match_the_pair(self):
        details = self.catalog.details({'a': 'Arcade', 'b': '2D'})
        self.assertEqual(details['total'], 1)
        self.assertEqual(details['rows'][0]['id'], 1)

    def test_search_available_results_precede_exact_but_excluded_titles(self):
        results = self.catalog.search('Dragon', {'chart': 'deck_reviews'})
        self.assertEqual(results[0]['id'], 2)
        self.assertTrue(results[0]['canHighlight'])
        self.assertFalse(results[1]['canHighlight'])

    def test_pairs_search_checks_eligibility_and_visible_logarithmic_points(self):
        results = self.catalog.search('Dragon', {'chart': 'pairs', 'aTags': 'Arcade', 'bTags': '2D'})
        self.assertTrue(next(r for r in results if r['id'] == 1)['canHighlight'])
        self.assertFalse(next(r for r in results if r['id'] == 2)['canHighlight'])
        results = self.catalog.search('Dragon', {'chart': 'pairs', 'aTags': 'Arcade', 'bTags': '2D', 'include': '3D'})
        self.assertTrue(all(not r['canHighlight'] for r in results))

    def test_search_ranking_limit_and_aggregate_charts_are_unavailable(self):
        self.assertFalse(self.catalog.search('Dragon', {'chart': 'ratings', 'rating': 'Very Positive', 'limit': '1', 'minReviews': '1000'})[0]['canHighlight'])
        self.assertFalse(self.catalog.search('Dragon', {'chart': 'releases'})[0]['canHighlight'])

    def test_empty_selection_all_views_return_no_rows(self):
        for kind in ['pairs', 'releases', 'words', 'ratings', 'themes', 'dimensions', 'representation', 'deck_releases', 'deck_reviews', 'deck_best']:
            with self.subTest(kind=kind):
                self.assertEqual(self.chart(chart=kind, include='not-a-real-tag')['rows'], [])


if __name__ == '__main__':
    unittest.main()
