# Architecture

This repository builds a static, offline-friendly SPA for Magic: The Gathering battleboxes, and serves it via a small Go HTTP server. The data pipeline compiles deck data and markdown into a single JSON artifact that the SPA consumes.

## Code Structure

- `main.go`: Go HTTP server. Serves the SPA and exposes a small JSON API backed by prebuilt data.
- `scripts/build.go`: Build pipeline. Reads deck data/markdown, resolves card printings, fetches card types from Scryfall, and writes `static/data/index.json` plus per-battlebox JSON files in `static/data/`.
- `build.sh`: Convenience wrapper for the build script.
- `data/`: Source content for battleboxes and decks.
  - `data/printings.json`: Project-level card printings.
  - `data/{battlebox}/printings.json`: Battlebox-level printings.
  - `data/{battlebox}/{deck}/manifest.json`: Deck metadata and card list.
  - `data/{battlebox}/{deck}/primer.md`: Deck primer text.
  - `data/{battlebox}/{deck}/{opponent}.md`: Sideboard guides.
  - `data/{battlebox}/{deck}/printings.json`: Deck-level printings.
- `static/`: SPA assets and generated data.
  - `static/index.html`: SPA shell.
  - `static/assets/*`: Frontend assets.
  - `static/data/index.json`: Battlebox index consumed by the SPA.
  - `static/data/<battlebox>.json`: Per-battlebox datasets loaded on demand.
- `.card-types.json`: Cached mapping of `printing -> type` to avoid repeated Scryfall calls.

## Purpose and Data Flow

1. Source data lives under `data/` as JSON manifests and markdown content.
2. The build step (`scripts/build.go`, via `build.sh`) loads and merges printings, resolves card printings, and fetches card type lines from Scryfall when missing.
3. The build step writes `static/data/index.json` plus per-battlebox JSON files with decks, cards, and guides.
4. The Go server (`main.go`) serves the SPA and the generated data for the frontend.

## Printing Resolution Behavior

Cards can have multiple printings. Each card’s printing is a `set/collector_number` string (e.g., `mh3/123`). Printings let you pin a printing globally, per battlebox, or per deck.

### Printing Files

Printings are JSON maps of `card name -> printing`:

```json
{
  "Lightning Bolt": "lea/161",
  "Plains": "blb/263"
}
```

### Resolution Order (Last Wins)

Printings are merged in this order:

1. `data/printings.json` (project level)
2. `data/{battlebox}/printings.json` (battlebox level)
3. `data/{battlebox}/{deck}/printings.json` (deck level)

During the build, each card’s printing is resolved from the printings files. If a card has no printing entry, the build errors.

### Normalization

Printing keys are normalized (trimmed and lowercased) when loaded, so matching is case-insensitive.

### Where it Happens

- Printing loading/merging and printing resolution: `scripts/build.go`
- High-level data layout description: `spec.md`
