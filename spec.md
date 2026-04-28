# Battlebox Reference Site

## Overview
A reference website for Magic: The Gathering battleboxes. Provides decklists, sideboard guides, and primers for quick pickup play.

## Scope
- 5 battleboxes: Bloomburrow, Pauper, Premodern, Shared, and Cube
- Bloomburrow: 11 decks (no sideboards)
- Pauper: 20 decks (with sideboards and matchup guides)
- Premodern: 20 decks (with sideboards and matchup guides)
- Shared: 2 shared-library variants
- Cube: 6 cube configurations with in-app draft support

## Features
- **Decklist view** with card images (via Scryfall)
- **Sideboard guides** against other decks in the battlebox
- **Deck primer** covering playstyle and key combos
- **Card hover preview** for inline card references
- **Winrate matrix** for supported battleboxes
- **Combo library** for supported battleboxes
- **Remote draft rooms** for cube play
- **Aggressive static caching** for built JSON and frontend assets

## Tech Stack
- Go backend (single binary serving `static/` plus runtime APIs)
- Hosted on fly.io
- Static-first, aggressive caching
- Build script combines data + markdown into JSON for serving

## Data Structure
```
data/
  printings.json           # project-level card printings
  {battlebox}/
    printings.json         # battlebox-level printings
    {deck-slug}/
      manifest.json       # deck metadata + cards
      primer.md           # deck primer (markdown)
      _{opponent}.json    # sideboard guide vs opponent (structured JSON)
      printings.json      # deck-level printings
```

## manifest.json
```json
{
  "name": "Boros Mice",
  "colors": "wr",
  "cards": [
    {
      "name": "Lightning Bolt",
      "qty": 4
    }
  ],
  "sideboard": [...]
}
```

Fields:
- `name`: Display name
- `colors`: WUBRG lowercase (e.g. "wr", "wubg")
- `cards`: Mainboard cards (printing resolved via printings files)
- `sideboard`: Optional, same format as cards

## Printings
Printing files are JSON maps of `card name -> printing` where `printing` is `set/collector_number`:
```json
{
  "Lightning Bolt": "lea/161",
  "Plains": "blb/263"
}
```

Resolution order (last wins):
1. `data/printings.json` (project-level)
2. `data/{battlebox}/printings.json`
3. `data/{battlebox}/{deck-slug}/printings.json`

Decklists omit `printing`; the build script resolves printings via the printings files.

## Primer And Guides
- `primer.md`: Deck strategy, key cards, combos
- `_{opponent-slug}.json`: Sideboard guide against that deck

Use `[[Card Name]]` syntax for inline card references:
```markdown
This deck closes games with [[Lightning Bolt]].
Against control, bring in [[Red Elemental Blast]].
```

Card references are resolved against the deck's card list to get the correct printing for Scryfall hover previews.

Guide JSON shape:
```json
{
  "status": "plan",
  "plan": {
    "in": {
      "Dust to Dust": 2
    },
    "out": {
      "Lone Missionary": 2
    }
  },
  "notes_md": "Become the control deck."
}
```

Guide status values:
- `plan`: Explicit in/out plan is present
- `no_changes`: Deliberately no sideboard changes
- `todo`: Guide not yet written

## Scripts
- `scripts/fetch_moxfield.py`: Import decks from Moxfield URLs
