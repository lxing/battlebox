---
name: mtgdecks-winrate-matrix
description: Fetch and normalize MTGDecks winrate data into a slug-only matchup matrix for battlebox formats (currently Pauper and Premodern). Use when asked to update winrate matrices, map MTGDecks archetype names to local deck slugs, or emit canonical matchup JSON using local alias maps.
---

# MTGDecks Winrate Matrix

## Workflow
1. Determine target format from user request (`pauper` or `premodern`).
2. Fetch the MTGDecks winrates page for the format.
3. Load alias map from repo:
- `data/pauper/mtgdecks-name-to-slug.json`
- `data/premodern/mtgdecks-name-to-slug.json`
4. Parse archetype names and pairwise matchup rows from MTGDecks.
5. Convert MTGDecks names to local slugs using `name_to_slug`.
6. Drop any matchup entry where either side is missing from alias map.
7. Emit slug-only matrix JSON in canonical output format.

## Rules
- Keep mapping strict one-to-one as defined in the alias file.
- Never emit MTGDecks display names in output matrix keys.
- Use only local slugs as row/column keys.
- Drop unmapped archetypes instead of inventing slugs.
- If alias map has duplicate slug targets where one-to-one is expected, treat as config error and stop.

## Output Format
Emit JSON with this structure (meta layer only):

```json
{
  "format": "pauper",
  "source": "https://mtgdecks.net/Pauper/winrates",
  "fetched_at": "2026-02-10T00:00:00Z",
  "matchups": {
    "affinity": {
      "bogles": {
        "wr": 0.51,
        "matches": 123,
        "ci_low": 0.44,
        "ci_high": 0.58
      }
    }
  }
}
```

Field guidance:
- `wr`: decimal in `[0,1]`.
- `matches`: integer sample size.
- `ci_low` / `ci_high`: decimals in `[0,1]` when available; omit if unavailable.
- `matchups`: directed matrix keyed by slug `from -> to`.

## Data Sources
- MTGDecks winrates pages:
- `https://mtgdecks.net/Pauper/winrates`
- `https://mtgdecks.net/Premodern/winrates`
- Local alias maps (source of truth for name-to-slug normalization):
- `data/pauper/mtgdecks-name-to-slug.json`
- `data/premodern/mtgdecks-name-to-slug.json`

## Implementation TODO (future)
- Add battlebox-local layer keyed by the same slugs.
- Keep meta and battlebox as two persisted layers.
- Compute merged display values at read time only.
