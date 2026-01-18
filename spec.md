# Battlebox Reference Site

## Overview
A reference website for Magic: The Gathering battleboxes. Provides decklists, sideboard guides, and primers for quick pickup play.

## Scope
- 3 battleboxes: Pauper, Premodern, Bloomburrow Tribal (15 decks each)
- Start with 1 battlebox as prototype

## Features
- **Decklist view** with card images (via Scryfall)
- **Sideboard guides** against each of the 14 other decks in the battlebox
- **Deck primer** covering playstyle and key combos
- **Offline support** via PWA, heavily cached

## Tech Stack
- Django backend
- Hosted on fly.io
- Static-first, aggressive caching

## Data
- Decklists imported from Moxfield
- Stored as JSON
- **Must preserve exact Scryfall printing** (set code + collector number, not just card name)
- Sideboard guides written manually

## Data Model
```
Battlebox
  └── Deck
        ├── name
        ├── primer (playstyle, combos)
        ├── cards[] (name, quantity, set, collector_number)
        ├── sideboard[]
        └── sideboard_guides{opponent_deck: {in, out, notes}}
```
