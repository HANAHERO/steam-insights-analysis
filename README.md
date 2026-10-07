# Steam Catalog Insights (October 2024)

## Steam Atlas web explorer

An interactive local website that recomputes the original video's 15 chart presets from these ZIP exports. It defaults to a white theme, with selectable dark mode and Chinese/English UI and title display, a unified pairs explorer, 16 tag families, game search/highlighting, hover details, matching-game drilldown, date/review/tag filters, numeric-axis selection, log scales, chart zoom, data tables, PNG/CSV export and URL view state.

Requirements: Python 3.10+ and Node.js 20.19+ (or 22.12+).

### Downloaded release

The [GitHub releases](https://github.com/HANAHERO/steam-insights-analysis/releases) include a precompiled ZIP with the three baseline data archives. Extract it, run `python server.py` (or `run.ps1` on Windows), and open http://127.0.0.1:8787. Only Python 3.10+ is required for this package. The first launch builds the local SQLite database. Use Sync data in the website to collect new records.

### Source checkout

```powershell
npm install
npm run build
python server.py
```

Open http://127.0.0.1:8787. The first launch creates `.data/catalog.sqlite` directly from `games.zip`, `tags.zip` and `reviews.zip`. No Python packages, remote database, API keys or extraction of the large descriptions/promotional archives are needed. The server binds only to the local loopback interface.

For frontend development, keep `python server.py` running, then run `npm run dev` in another terminal. Vite proxies `/api` to port 8787. Rebuild with `npm run build` before using the production server after frontend changes. To rebuild the local database after replacing the original ZIP files, stop the server, run `npm run data`, then restart the server. Change tag family membership in `taxonomy.json` and restart the server.

Run calculation tests with `npm test`. See [SOURCES.md](SOURCES.md) for all original chart URLs, the reconstructed taxonomy and exact counting conventions.

After building and testing, `python build_release.py` creates the precompiled download and SHA256 checksum under the ignored `release/` directory. It includes the October 2024 baseline, without local caches, partial crawl results, logs or API credentials.

The original source is an October 2024 snapshot. The Sync data button starts a resumable, rate-limited collector for Steam details, all-language review totals, SteamSpy estimates, English store tags and Chinese game names. New releases since October 15, 2024 are discovered while known records are refreshed. The latest record-update timestamp and the last completed pass are shown separately: starting a job does not make the entire catalog current.

The former public `ISteamApps/GetAppList/v2` endpoint is no longer available. Provide an optional Steam Web API Key in the sync dialog (session only), or set `STEAM_API_KEY` in the server environment, to discover the complete current API catalog. Without a key the collector falls back to Steam store search for recent game/demo releases; removed or region-hidden apps may be absent. Collection uses US pricing consistently. Several days may be needed for the first large pass. Leave the local server running; browser tabs can be closed. After restarting the server click Start / resume sync to continue saved checkpoints. Pause retains pending work.

`.data/catalog-2024-10.sqlite` preserves the baseline. Per-app timestamps, queue checkpoints, source responses and discovery coverage are stored in SQLite. Empty scraped tags retain known tags. Unavailable store apps remain in the baseline with an explicit queue status. Steam-localized Chinese titles are used when present; no title is machine-translated. English titles remain searchable. The language selector applies to controls and game names; individual Steam tags retain their canonical English identifiers.

Search includes matching catalog records. Available games come first; unavailable results remain visible, include a reason and cannot be added as highlights. Pair highlighting checks current filters and visible tag pairs. Rankings check their displayed top-N subset. Aggregate charts do not plot individual games.

The author's exact taxonomy/SQL was not provided; family memberships and analysis definitions are documented reconstructions. See [SOURCES.md](SOURCES.md) and [VALIDATION.md](VALIDATION.md).

## Original data
This repository contains CSV files exported from a SQL database of video game data, covering categories, descriptions, game details, genres, promotional materials, reviews, SteamSpy insights, and tags.

## File Description
Each CSV file corresponds to a table from the Steam catalog dataset. The files have been compressed into ZIP archives for easier download. You can unzip them and import these CSV files into any database or use them directly for data analysis.

- **games.csv**: Main table containing details about the games, such as title, release date, and other metadata.
- **genres.csv**: Genres assigned to each game.
- **tags.csv**: Tags associated with each game, such as "Indie", "Action", etc.
- **reviews.csv**: Review data for the games, including Steam ratings and review counts.
- **steamspy_insights.csv**: Insights gathered from SteamSpy, such as estimated sales, playtime, and more.
- **descriptions.csv**: Full and summary text descriptions of each game.
- **promotional.csv**: Links and metadata for promotional materials, such as trailers and screenshots.
- **categories.csv**: Information about the different Steam categories that games belong to (e.g., "Single-player", "Full controller support", etc.).
