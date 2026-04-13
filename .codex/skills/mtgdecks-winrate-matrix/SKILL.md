---
name: mtgdecks-winrate-matrix
description: Fetch and normalize MTGDecks winrate data into a slug-only matchup matrix for battlebox formats (currently Pauper and Premodern). Use when asked to update winrate matrices, map MTGDecks archetype names to local deck slugs, or emit canonical matchup JSON using local alias maps.
---

# MTGDecks Winrate Matrix

## Workflow
1. Determine target format from user request (`pauper` or `premodern`).
2. Determine update scope from user request:
- If the user explicitly asks for one deck, one slug, a point update, or to fill a newly added deck only, use point-update mode.
- If the user explicitly asks to refresh the matrix, update all decks, or fetch the latest matrix, use full-refresh mode.
- If the request is ambiguous about scope, ask one short clarifying question before running anything. Example: `Do you want a point update for black-sacrifice only, or a full Pauper matrix refresh?`
3. Fetch the MTGDecks winrates page with the built-in `web` tool:
- `web.search_query` with the format URL.
- `web.open` on the result page to read the rendered table content.
- Do not use `curl` for MTGDecks pages (Cloudflare blocks it in this environment).
4. Load alias map from repo:
- `data/pauper/mtgdecks-name-to-slug.json`
- `data/premodern/mtgdecks-name-to-slug.json`
5. Parse pairwise matchup rows from MTGDecks table content.
6. Convert MTGDecks names to local slugs using `name_to_slug`.
7. Drop any matchup entry where either side is missing from alias map.
8. Drop all mirror cells (`slug -> same slug`).
9. Fill missing directed cells by inverting the reverse cell when available (`A->B = 1 - (B->A)`), preserving `matches` from the reverse edge.
10. Emit slug-only matrix JSON in canonical output format.
11. Run the local generator script in the mode that matches the request:
- Full refresh:
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py pauper`
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py premodern`
  - Or both in one call:
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py`
- Point update for one slug:
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py --update-slug black-sacrifice pauper`
  - This updates only the target row, reverse `other -> target` cells, and recomputed totals in the existing local matrix file.
  - Point updates preserve the file's last full-refresh `fetched_at` and record the targeted refresh time under `point_updates.<slug>`.
- Dry-run either mode first when the user asks to test or when you want to verify scope safely:
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py --dry-run pauper`
  - `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py --dry-run --update-slug black-sacrifice pauper`
12. To prune mirror cells from existing matrix files without refetching:
- `python3 .codex/skills/mtgdecks-winrate-matrix/scripts/generate.py --prune-existing pauper premodern`
13. Verify generated outputs:
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
- Use point-update mode only when the user clearly wants one deck updated without refreshing the rest of the matrix.
- If the user says `update the matrix` or similar without saying whether they want one deck or all decks, ask a short clarification before proceeding.
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
