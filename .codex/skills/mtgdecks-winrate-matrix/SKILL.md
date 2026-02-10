---
name: mtgdecks-winrate-matrix
description: Fetch and normalize MTGDecks winrate data into a slug-only matchup matrix for battlebox formats (currently Pauper and Premodern). Use when asked to update winrate matrices, map MTGDecks archetype names to local deck slugs, or emit canonical matchup JSON using local alias maps.
---

# MTGDecks Winrate Matrix

## Workflow
1. Determine target format from user request (`pauper` or `premodern`).
2. Fetch the MTGDecks winrates page with the built-in `web` tool:
- `web.search_query` with the format URL.
- `web.open` on the result page to read the rendered table content.
- Do not use `curl` for MTGDecks pages (Cloudflare blocks it in this environment).
3. Load alias map from repo:
- `data/pauper/mtgdecks-name-to-slug.json`
- `data/premodern/mtgdecks-name-to-slug.json`
4. Parse pairwise matchup rows from MTGDecks table content.
5. Convert MTGDecks names to local slugs using `name_to_slug`.
6. Drop any matchup entry where either side is missing from alias map.
7. Drop all mirror cells (`slug -> same slug`).
8. Fill missing directed cells by inverting the reverse cell when available (`A->B = 1 - (B->A)`), preserving `matches` from the reverse edge.
9. Emit slug-only matrix JSON in canonical output format.
10. Optionally run the local generator script as fallback when needed:
- `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py pauper`
- `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py premodern`
- Or both in one call:
- `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py`
11. To prune mirror cells from existing matrix files without refetching:
- `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py --prune-existing pauper premodern`
12. Verify generated outputs:
- `data/pauper/mtgdecks-winrate-matrix.json`
- `data/premodern/mtgdecks-winrate-matrix.json`

## Rules
- Keep mapping strict one-to-one as defined in the alias file.
- Never emit MTGDecks display names in output matrix keys.
- Use only local slugs as row/column keys.
- Never emit mirror cells (`A -> A`).
- Drop unmapped archetypes instead of inventing slugs.
- If alias map has duplicate slug targets where one-to-one is expected, treat as config error and stop.
- When one direction is missing but reverse exists, infer via inversion (`wr = 1 - reverse.wr`).
- Prefer `web` tool fetches over shell/network tools for MTGDecks pages.
- Do not use `curl` against MTGDecks in this workflow.

## Script Dependencies
- `cloudscraper`
- `beautifulsoup4`
- `lxml`
- Install if needed:
- `python3 -m pip install cloudscraper beautifulsoup4 lxml`

## Output Format
Emit JSON with this structure (meta layer only):

```json
{
  "format": "pauper",
  "source": "https://mtgdecks.net/Pauper/winrates",
  "fetched_at": "2026-02-10T00:00:00Z",
  "totals": {
    "affinity": {
      "wins": 312,
      "matches": 601,
      "wr": 0.5191
    }
  },
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
- `totals`: per-slug aggregate computed at generation time.
- `totals.<slug>.wins`: sum of estimated wins across all opponents (`round(matches * wr)` per opponent).
- `totals.<slug>.matches`: sum of matchup sample sizes across all opponents.
- `totals.<slug>.wr`: `wins / matches` as decimal in `[0,1]` (or `0` when no matches).
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
