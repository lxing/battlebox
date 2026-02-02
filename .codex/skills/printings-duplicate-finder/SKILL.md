---
name: printings-duplicate-finder
description: Detect and enumerate deck-level printings.json entries that duplicate battlebox-level printings; use when asked to find or clean duplicate printings in battlebox data.
---

# Printings Duplicate Finder

## Purpose
Identify deck-level `printings.json` entries that duplicate battlebox-level entries by card name (regardless of printing), and also detect duplicates across deck-level printings within the same battlebox.

## Workflow
1. Run the duplicate-finder script with the target battlebox slug.
2. Review the report and remove or lift duplicates as needed.

## Script
Use the bundled script to enumerate duplicates:

```bash
python .codex/skills/printings-duplicate-finder/scripts/find_printing_duplicates.py --battlebox premodern
```

By default, the script reports name-only and strict duplicates for both box→deck and deck↔deck. Use `--no-strict` to suppress strict sections.

### Output format
```
Box-level duplicates (name-only):
<deck-slug>
  <Card Name>: deck=<set/collector> box=<set/collector>

Box-level duplicates (strict):
<deck-slug>
  <Card Name>: deck=<set/collector> box=<set/collector>

Deck-level duplicates (name-only):
  <Card Name>: deck-a=<set/collector>, deck-b=<set/collector>

Deck-level duplicates (strict):
  <Card Name> (<set/collector>): deck-a, deck-b
```

If no duplicates are found, the script prints `No duplicates found.`
