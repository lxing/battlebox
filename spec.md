# Battlebox Reference Site

## Overview
A reference website for Magic: The Gathering battleboxes. Provides decklists, sideboard guides, and primers for quick pickup play.

## Scope
- 3 battleboxes: Pauper, Premodern, Bloomburrow Tribal
- Bloomburrow: 11 decks (no sideboards)
- Pauper/Premodern: 15 decks each (with sideboards)

## Features
- **Decklist view** with card images (via Scryfall)
- **Sideboard guides** against other decks in the battlebox
- **Deck primer** covering playstyle and key combos
- **Card hover preview** for inline card references
- **Offline support** via PWA, heavily cached

## Tech Stack
- Go backend (single binary, embedded static files)
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
      manifest.json    # deck metadata + cards
      primer.md        # deck primer (markdown)
      {opponent}.md    # sideboard guide vs opponent (markdown)
      printings.json   # deck-level printings
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

## Markdown Files
- `primer.md`: Deck strategy, key cards, combos
- `{opponent-slug}.md`: Sideboard guide against that deck

Use `[[Card Name]]` syntax for inline card references:
```markdown
This deck closes games with [[Lightning Bolt]].
Against control, bring in [[Red Elemental Blast]].
```

Card references are resolved against the deck's card list to get the correct printing for Scryfall hover previews.

## Scripts
- `scripts/fetch_moxfield.py`: Import decks from Moxfield URLs
