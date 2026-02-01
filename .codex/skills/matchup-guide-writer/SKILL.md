---
name: matchup-guide-writer
description: Write one or more matchup guides for a battlebox deck; use when asked to create or update matchup guide .md files.
---

# Matchup Guide Writer

## Purpose
Create concise matchup guides for a battlebox deck against other decks in the same battlebox, using the required +/− plan format and gameplan prose.

## Required workflow
1. **Read deck data**: Open `data/<battlebox>/<deck>/manifest.json` to confirm mainboard + sideboard contents and counts.
2. **Research**: Use `web.run` to find relevant primers or matchup guides for the specific archetype/opponent pairing. If sources are thin, note the gap and proceed with best‑effort heuristics.
3. **Write guides**: Create or update `data/<battlebox>/<deck>/<opponent>.md` for each matchup requested.
4. **Validate**: Run `./build.sh` and fix any guide errors until build succeeds.

## Format rules (strict)
- **Plan block first**: lines of `+N [[Card Name]]` or `-N [[Card Name]]`.
- **Quantities are required** (`+1`, `-2`, etc.). Missing quantities are invalid.
- **Blank line**, then **prose** describing the plan and key cards.
- Use `[[Card Name]]` references for hover previews.

## Validation rules (enforced at build time)
- Total IN equals total OUT.
- All IN cards exist in the sideboard and do not exceed their counts.
- All OUT cards exist in the mainboard and do not exceed their counts.
- (Soft) Avoid cutting lands unless you are bringing in lands.

## Example guide (file: `data/<battlebox>/<deck>/<opponent>.md`)
```
+2 [[Aura of Silence]]
+1 [[Disenchant]]
-2 [[Wrath of God]]
-1 [[Duress]]

Slow down their engine and keep them off key permanents. Use hate pieces to buy time, then transition to a stable board and win with your primary finisher.
```
