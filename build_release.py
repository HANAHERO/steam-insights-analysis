"""Package a tested, prebuilt local release without caches or credentials."""
import hashlib
import json
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    files = [ROOT / name for name in (
        'server.py', 'prepare_data.py', 'sync_data.py', 'taxonomy.json', 'run.ps1',
        'README.md', 'SOURCES.md', 'VALIDATION.md', 'games.zip', 'tags.zip', 'reviews.zip')]
    files += sorted((ROOT / 'dist').rglob('*'))
    if not (ROOT / 'dist/index.html').is_file():
        raise SystemExit('Build the frontend with npm run build before packaging.')
    for path in files:
        if not path.exists():
            raise SystemExit(f'Required release file missing: {path.name}')
    output = ROOT / 'release'
    output.mkdir(exist_ok=True)
    archive = output / f'steam-atlas-{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in files:
            if path.is_file():
                bundle.write(path, path.relative_to(ROOT).as_posix())
        bundle.writestr('RELEASE.json', json.dumps({
            'version': version, 'runtime': 'Python 3.10+', 'url': 'http://127.0.0.1:8787',
            'dataBaseline': 'October 2024', 'updatedData': 'Collected locally through the Sync data button',
            'launch': 'python server.py', 'containsCredentials': False}, indent=2))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = output / 'SHA256SUMS.txt'
    checksum.write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(f'Release archive: {archive} ({archive.stat().st_size:,} bytes)')
    print(f'SHA256: {digest}')


if __name__ == '__main__':
    main()
