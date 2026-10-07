# Validation

## October 2026 update

- The precompiled v1.0.0 archive passed ZIP integrity checks and a clean-directory launch on an isolated port. It rebuilt all 140,082 baseline records and returned a nonempty pairs chart without Node.js or workspace caches.

- Production TypeScript/Vite build passed; 27 calculation and collector tests passed.
- Search availability tests cover sorting, date/tag eligibility, visible logarithmic pairs, top-N limits and aggregate views.
- Collector tests cover all-language/all-purchase review parameters, real source upserts, Chinese-name search, per-source provenance, date parsing, empty-tag preservation, interrupted-item recovery, post-baseline discovery, completion with errors, unavailable apps and key handling.
- Real requests verified current details, review summaries, store tag HTML and SteamSpy data. Steam review totals with `languages=["all"]` matched the legacy all-language endpoint.
- The former unauthenticated app-list endpoint returned 404; keyed GetAppList returned 403 without a key. Store-search fallback successfully discovered and queued post-baseline releases.
- The original snapshot is backed up separately. The actual job was paused and resumed, including across a server restart, without discarding app checkpoints.
- Browser checks verified white/dark themes, persisted English/Chinese preference, unavailable search results after available results with disabled buttons and specific reasons.
- Chinese Steam title Inscryption / `\u90aa\u6076\u51a5\u523b` was fetched, searched and highlighted in the browser. Switching to English restored the English title while retaining the highlight.
- Slay the Spire 2 acquired a real 2026-03-05 release date and current all-language review totals, and can now be plotted. No synthetic date was used.
- The collection is ongoing, not a completed current-day full refresh. Latest-record and completed-pass timestamps are separate; the UI explicitly marks partial updates.

## Original baseline validation

- `npm run build`: TypeScript and Vite production build passed.
- `npm test`: 15 calculation tests passed, covering distinct game counts, pair union/intersection, AND/OR filters, pair deduplication, zero overlap, time-series gaps, representation denominators, release comparison series, dimension composition, deckbuilder shares, word deduplication, stored ratings, Wilson scores, undated games and drilldown consistency.
- All 15 presets were opened in the Codex in-app browser. Each produced a canvas without a visible chart error; captured console logs contained no application errors or warnings.
- An independent SQLite query confirmed Arcade + 2D union/intersection counts of 35,027 / 5,833 under default filters.
- The broad deckbuilder cohort was checked independently with SQLite: 913 games under default filters, 892 with dates and reviews. Inscryption is included in the broad cohort and omitted from the exact-tag cohort.
- Searching Slay the Spire highlights its plotted point. Searching Slay the Spire 2 returns its real snapshot record and explains why an undated record cannot appear on the review/time chart.
- Native pointer hover over Slay the Spire displayed its actual release date, 166,614 reviews, 97.85% positive ratio and 97.78% Wilson score.
- Required-tag filtering for Roguelike Deckbuilder returned 352 games. The Roguelike Deckbuilder + 2D drilldown returned 225 matching games.
- CSV downloaded successfully and was parsed: 72 filtered pair rows, including the 225-game intersection. PNG downloaded successfully and had a valid PNG header and 1908 x 1020 dimensions. Blob-backed PNG downloads were used for in-app browser compatibility.
- Narrow-screen layout was checked; document width equaled viewport width without horizontal page overflow. Pair-family controls received a dedicated mobile grid layout.
- `npm audit --omit=dev`: zero vulnerabilities.

Screenshots are in `artifacts/`. Reference links and reconstructed methodology are documented in `SOURCES.md`. The original author's full SQL/tag taxonomy was not supplied, so exact numerical parity with every published chart is not asserted.
