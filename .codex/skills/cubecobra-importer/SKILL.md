---
name: cubecobra-importer
description: Import a CubeCobra cube URL into battlebox deck source files by generating manifest cards and Scryfall-backed printings.json. Use when asked to populate or update a deck from CubeCobra.
---

# CubeCobra Importer

## When to use
- User provides a CubeCobra link/id and wants deck cards and printings populated.
- User wants a script-based import path (not manual copy/paste).

## Workflow
1. Run the importer script:
- `python3 .codex/skills/cubecobra-importer/scripts/import_cubecobra.py <cube_url_or_id> --battlebox <battlebox> --deck-slug <slug>`
2. For a safe check first:
- add `--dry-run` to preview counts and target paths.
3. If the output looks right, run without `--dry-run` to write:
- `data/<battlebox>/<deck-slug>/manifest.json`
- `data/<battlebox>/<deck-slug>/printings.json`
4. Confirm the resulting manifest/printings are source files under `data/**`.

## Rules
- Do not edit generated build outputs (`static/data/**`, `static/data.json`, `.card-types.json`) unless explicitly requested.
- Use Scryfall collection lookups for printings; do not guess set/collector numbers.
- If Scryfall cannot resolve one or more imported cards, stop and report unresolved cards.
- Preserve existing manifest metadata fields by default; only replace `cards`.

## Examples
- Dry run into existing pauper cube deck:
- `python3 .codex/skills/cubecobra-importer/scripts/import_cubecobra.py https://cubecobra.com/cube/list/3jujr --battlebox cube --deck-slug pauper --dry-run`

- Write files:
- `python3 .codex/skills/cubecobra-importer/scripts/import_cubecobra.py https://cubecobra.com/cube/list/3jujr --battlebox cube --deck-slug pauper`
