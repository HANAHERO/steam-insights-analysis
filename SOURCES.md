# Chart references and methodology

Original video: https://www.youtube.com/watch?v=qiNv3qv-YbU

Original dataset: https://github.com/NewbieIndieGameDev/steam-insights

The following URLs were recovered from the video's description. Original visualizations are reference material; all charts in this application are recomputed from the repository's ZIP exports.

| Preset | Original visualization |
| --- | --- |
| Game Releases Over Time | https://public.flourish.studio/visualisation/20221119/ |
| Most Common Words | https://public.flourish.studio/visualisation/20054087/ |
| Overwhelmingly Positive Games | https://public.flourish.studio/visualisation/20221305/ |
| Overwhelmingly Negative Games | https://public.flourish.studio/visualisation/20221377/ |
| Genre-Genre Pairs | https://public.flourish.studio/visualisation/20059232/ |
| Top Themes | https://public.flourish.studio/visualisation/20221430/ |
| Genre-Theme Pairs | https://public.flourish.studio/visualisation/20073344/ |
| Genre-Dimension Pairs | https://public.flourish.studio/visualisation/20074409/ |
| Genre-Perspective Pairs | https://public.flourish.studio/visualisation/20074514/ |
| Dimensions Over Time | https://public.flourish.studio/visualisation/20221523/ |
| Female Protagonist | https://public.flourish.studio/visualisation/20255396/ |
| LGBTQ+ | https://public.flourish.studio/visualisation/20255422/ |
| Roguelike Deckbuilders: Releases | https://public.flourish.studio/visualisation/20238203/ |
| Roguelike Deckbuilders: Reviews | https://public.flourish.studio/visualisation/20238521/ |
| Roguelike Deckbuilders: Best | https://public.flourish.studio/visualisation/20238736/ |

## Taxonomy

The supplied image defines 16 families. Membership is reconstructed from tag meaning and Steamworks documentation: https://partner.steamgames.com/doc/store/tags?l=english

The CSV exports do not include the author's full classification or analysis code. Membership is therefore a documented reconstruction, not an exact copy. The original pair presets use the 40 genres, 20 themes, 3 dimensions and 5 perspectives recovered from the published Flourish point labels. Family pickers offer the wider taxonomy. Edit `taxonomy.json` to adjust it. A tag may belong to multiple families; missing known tags are added to Others. No supplied tags are silently discarded.

## Computation

- Default universe: source type `game`, release date 1997-01-01 through today, excluding undated records. Source `game` can include software. The date is the source's stored release date; publication status is unavailable in the baseline.
- Each App ID is counted once. Tags are unweighted binary membership because tag votes/order are not supplied.
- Pair X: `|A union B|`; pair Y: `|A intersection B|`, both within the filtered universe. Same-family pairs are unordered and deduplicated; self-pairs are excluded.
- Jaccard: `100 * intersection / union`. Lift: `intersection * universe_size / (count_A * count_B)`.
- Time charts omit undated records and fill gaps with zero; tag shares use all dated releases within the selection as denominator. Tags overlap, so dimension shares need not sum to 100%.
- The release overview includes all releases, titles with a positive Steam rating label, and titles with at least 10,000 reviews. Dimension stacked proportions normalize the selected dimension tag counts to 100%; a multi-tagged game may contribute to more than one segment. Switch to lines for shares of all releases. Deckbuilder release proportions divide deckbuilder releases by all dated releases in the same filtered period.
- Word counts tokenize English alphabetic words and count a token at most once per title. Common English stop words, demo and edition markers are excluded; titles in other languages remain in the catalog but do not contribute non-Latin tokens.
- Rating presets use the stored `review_score_description`. Best games offer review count, positive percentage and the Wilson 95% lower confidence bound.
- The negative preset defaults to negative review percentage. The deckbuilder Best preset defaults to the original top-20 scatter layout: X is total reviews (logarithmic), Y is positive review percentage. A ranked bar view is also available.
- The broad deckbuilder cohort includes the exact Roguelike Deckbuilder tag OR (any Roguelike/Roguelite/Traditional Roguelike tag AND any Deckbuilding/Card Battler/Card Game tag). This documented reconstruction includes Inscryption, whose source tags do not contain Roguelike Deckbuilder. The cohort selector can restrict to the exact tag. Best defaults to positive ratio with an adjustable 1,000-review sample floor; the author's exact filtering SQL was unavailable. Source record values are never invented.
- Reviews are cumulative at each record's collection time and are not sales. The baseline is October 2024; the current database progressively incorporates collector results. Current-year totals are partial and app refresh dates may differ.
- Search covers all catalog records. Available-to-highlight results precede unavailable results, which explain the active exclusion and cannot be selected.
- Filter choices, selected chart, numeric axis settings and highlight App ID are serialized in the view URL. These are local view settings; sharing a localhost link does not host the dataset for another person.

## Incremental collection (October 2024 onward)

- [Steam GetAppList documentation](https://partner.steamgames.com/doc/webapi/IStoreService): key-authenticated catalog discovery with cursor pagination. No key is embedded in the project. Keys supplied through the UI stay in server memory.
- [Steam review service documentation](https://partner.steamgames.com/doc/webapi/IUserReviewsService): `GetAppReviews/v1` with `languages=["all"]`, `purchase_type=1` (all purchases), `review_type=0` and English score descriptions. Empty language lists default to English, so every-language coverage is explicit. Legacy `appreviews` is a compatibility fallback. Review texts and player identities are not retained; only aggregates are stored.
- Steam Store `api/appdetails`: English and Simplified Chinese title requests, consistent US price currency, actual release dates or null for coming-soon/unparseable dates.
- Steam store HTML: scrape community `app_tag` labels in English. Empty or unrecognized tag markup retains existing tags.
- [SteamSpy API](https://steamspy.com/api.php): `request=appdetails`, estimated owner bands and current players. These estimates have different freshness from Steam data. Optional failures do not invent metric values.
- Without a key, discovery scans release-sorted Steam search for games and demos until pre-baseline releases. Coverage is searchable releases, not a guaranteed complete API catalog. All baseline IDs are still refreshed, including originally undated games.
- Pacing: at least 1.2 seconds between requests, capped retry/backoff, durable app-level checkpoints and atomic per-app updates. Charts read a periodically rebuilt in-memory catalog.
- October 2024 to today describes new-release discovery and today's collection target. It does not reconstruct daily historical reviews, prices or past tag membership: these endpoints expose current values.
