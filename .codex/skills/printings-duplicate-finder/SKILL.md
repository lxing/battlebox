---
name: printings-duplicate-finder
description: Detect and enumerate deck-level printings.json entries that duplicate battlebox-level printings; use when asked to find or clean duplicate printings in battlebox data.
---

# Printings Duplicate Finder

## Purpose
Identify deck-level `printings.json` entries that duplicate battlebox-level entries by card name (regardless of printing), so they can be lifted or removed.

## Workflow
1. Run the duplicate-finder script with the target battlebox slug.
2. Review the report and remove or lift duplicates as needed.

## Script
Use the bundled script to enumerate duplicates:

```bash
python .codex/skills/printings-duplicate-finder/scripts/find_printing_duplicates.py --battlebox premodern
```

By default, the script flags name-only duplicates. To require exact printing matches:

```bash
python .codex/skills/printings-duplicate-finder/scripts/find_printing_duplicates.py --battlebox premodern --mode strict
```

### Output format
```
<deck-slug>
  <Card Name>: deck=<set/collector> box=<set/collector>
```

If no duplicates are found, the script prints `No duplicates found.`
