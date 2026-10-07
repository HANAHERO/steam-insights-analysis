"""Build a local SQLite catalog directly from the original ZIP exports."""
import csv
import io
import json
import sqlite3
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = ROOT / '.data' / 'catalog.sqlite'


def rows(name):
    with zipfile.ZipFile(ROOT / (name + '.zip')) as archive:
        with io.TextIOWrapper(archive.open(name + '.csv'), encoding='utf-8-sig', newline='') as stream:
            yield from csv.DictReader(stream, escapechar='\\')


def number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def build():
    DB.parent.mkdir(exist_ok=True)
    temp = DB.with_suffix('.building.sqlite')
    if temp.exists():
        temp.unlink()
    conn = sqlite3.connect(temp)
    conn.executescript('''
        CREATE TABLE games(id INTEGER PRIMARY KEY, name TEXT, date TEXT, free INTEGER,
          type TEXT, price REAL, currency TEXT, positive INTEGER DEFAULT 0,
          negative INTEGER DEFAULT 0, reviews INTEGER DEFAULT 0, rating TEXT DEFAULT 'No reviews');
        CREATE TABLE tags(game_id INTEGER, tag TEXT, PRIMARY KEY(game_id, tag));
    ''')
    batch = []
    for r in rows('games'):
        try:
            price = json.loads(r['price_overview'])
        except (ValueError, TypeError):
            price = {}
        date = r['release_date']
        if len(date) != 10 or date[4:5] != '-':
            date = None
        batch.append((number(r['app_id']), r['name'], date, number(r['is_free']), r['type'],
                      price.get('final', 0) / 100 if price else None, price.get('currency')))
    conn.executemany('INSERT INTO games(id,name,date,free,type,price,currency) VALUES(?,?,?,?,?,?,?)', batch)
    conn.executemany('INSERT OR IGNORE INTO tags VALUES(?,?)',
                     ((number(r['app_id']), r['tag']) for r in rows('tags')))
    conn.executemany('UPDATE games SET positive=?, negative=?, reviews=?, rating=? WHERE id=?',
                     ((number(r['positive']), number(r['negative']), number(r['total']),
                       r['review_score_description'] if r['review_score_description'] not in ('N', '\\N', '') else 'No reviews',
                       number(r['app_id'])) for r in rows('reviews')))
    conn.executescript('CREATE INDEX tags_by_tag ON tags(tag,game_id); CREATE INDEX games_by_date ON games(date);')
    conn.commit()
    count = conn.execute('SELECT count(*) FROM games').fetchone()[0]
    conn.close()
    temp.replace(DB)
    print(f'Catalog ready: {count:,} records at {DB}')


if __name__ == '__main__':
    build()
