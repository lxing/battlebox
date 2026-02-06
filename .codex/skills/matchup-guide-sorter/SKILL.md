---
name: matchup-guide-sorter
description: Alphabetize the in/out plan lines in a single matchup guide .md file by card name (ignoring quantity), keeping all in-cards before out-cards. Use when asked to sort matchup guide plans.
---

# Matchup Guide Sorter

Use the bundled script to alphabetize a single matchup guide's plan block.

## Steps
1. Run the script on a single matchup guide file.
2. Review the diff to confirm only the plan lines were reordered.

## Script
```
python /Users/lxing/py/battlebox/.codex/skills/matchup-guide-sorter/scripts/sort_matchup_guide.py /path/to/guide.md
```

## Behavior
- Only the plan block at the top of the file is reordered.
- All `+` lines (In) come before all `-` lines (Out).
- Sorting ignores quantities and uses card name (handles `[[Card|Alias]]`).
- The prose section remains unchanged.
