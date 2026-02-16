# Architecture

This project is a static-first battlebox reference site with a small Go server and a build pipeline that compiles source content in `data/` into frontend JSON payloads in `static/data/`.

At runtime, the browser loads `index.json` plus battlebox-specific payloads, then renders an SPA with decklists, primers, matchup guides, matrix views, life counter utilities, and a websocket-powered draft room flow.

## Repository Layout

- `data/`: Source of truth for battleboxes and decks.
- `internal/buildtool/`: Build pipeline implementation.
- `scripts/build.go`: Build entrypoint (`go run scripts/build.go`).
- `server/`: HTTP server and draft subsystem.
- `static/`: Frontend assets plus generated JSON outputs.
- `tmp/build-stamps.json`: Incremental build stamp cache.
- `.card-types.json`: Scryfall-derived card metadata cache.

## Data Model (Source of Truth)

### Top-level

- `data/manifest.json`: Optional ordered list of battlebox slugs for output ordering.
- `data/printings.json`: Project-level default printings map.

### Per battlebox

- `data/<battlebox>/manifest.json`: Battlebox metadata and UI policy.
- `data/<battlebox>/printings.json`: Battlebox printings overrides.
- `data/<battlebox>/banned.json`: Optional banned list used for UI tags.
- `data/<battlebox>/mtgdecks-winrate-matrix.json`: Optional matrix source copied to static output.

Battlebox manifest supports:
- Display metadata (`name`, `description`).
- UI switches (`disable_random_roll`, `disable_double_random_roll`, `disable_type_sort`, `disable_matrix_tab`).
- UI profile system (`default_ui_profile`, `ui_profiles`) for deck display/sample behavior.
- `land_subtypes` (currently used by cube rendering for land grouping).

### Per deck

- `data/<battlebox>/<deck>/manifest.json`: Deck metadata and card list.
- `data/<battlebox>/<deck>/primer.md`: Primer markdown.
- `data/<battlebox>/<deck>/_<opponent>.md`: Matchup guide markdown.
- `data/<battlebox>/<deck>/printings.json`: Deck-level printings overrides.

Deck manifest supports:
- `name`, `icon`, `colors`.
- `tags`, `difficulty_tags`.
- Optional `ui_profile` (preferred) or legacy `view` / `sample_hand_size`.
- `cards` and optional `sideboard`.

## Build Pipeline

Entry: `go run scripts/build.go` (also wrapped by `build.sh`).

Core flow in `internal/buildtool/Main()`:

1. Load caches (`.card-types.json`, build stamp file).
2. Read battlebox order from `data/manifest.json` (fallback: alphabetical directory order).
3. Compute hashes for global inputs and each battlebox input tree.
4. Determine dirty battleboxes (or all if `-full`).
5. For dirty battleboxes:
   - Merge printings (project -> battlebox -> deck).
   - Resolve each card's printing.
   - Fail build on missing printing for any decklist/sideboard card.
   - Fetch missing Scryfall metadata and update cache.
   - Parse primers and guides.
   - Enrich cards with type bucket, mana cost/value, double-faced flag.
   - Build per-battlebox output payload.
6. Write `static/data/<battlebox>.json` plus gzip sidecar.
7. Optionally mirror matrix JSON to `static/data/<battlebox>/mtgdecks-winrate-matrix.json` plus gzip.
8. Rebuild `static/data/index.json` (always when build is not skipped), attach `build_id`, and write gzip sidecar.
9. Persist incremental stamp to `tmp/build-stamps.json`.

### Incremental Build Strategy

- Global hash includes:
  - `data/printings.json`
  - `data/manifest.json`
  - build pipeline sources (`scripts/build.go`, `internal/buildtool/*.go`)
- Battlebox hash includes all `.json` and `.md` files under that battlebox directory.
- File hashing uses cached `(size, mtime, hash)` fingerprints for fast no-op builds.

### Validation Behavior

- `-validate` defaults to `true`.
- Current validation path emits warnings (stderr) for printing usage coverage issues, but does not fail by itself.
- Hard failures still occur for structural problems (for example, unresolved printings required by deck cards).

Other validation logic in buildtool includes guide parsing/shape checks, card-ref extraction, and expected deck-size checks used during build-time parsing and verification.

## Printing Resolution Rules

Printings are a map of `card name -> set/collector_number`, normalized by lowercasing and trimming card-name keys.

Resolution order (last wins):

1. `data/printings.json`
2. `data/<battlebox>/printings.json`
3. `data/<battlebox>/<deck>/printings.json`

Each card in decklists and sideboards must resolve to a printing by build time.

## Runtime Server Architecture

Server entrypoint: `server/main.go`.

### Static serving

- Serves `static/` as the SPA root.
- Routes without file extensions are rewritten to `/` for hash-route SPA navigation.
- Cache behavior:
  - `DEV=1`: no-store.
  - Production assets under `/assets/`: long-lived immutable caching.

### Runtime APIs

- `GET/PUT /api/source-guide?bb=<slug>&deck=<slug>&opponent=<slug>`
  - Reads/writes raw matchup guide source files in `data/.../_<opponent>.md`.
  - Returns parsed guide JSON shape used by the editor UI.
- Draft subsystem:
  - `GET/POST /api/draft/rooms`
  - `GET /api/draft/lobby/events` (SSE)
  - `POST /api/draft/shared`
  - `GET /api/draft/ws` (WebSocket)

### Tailscale mode

- `-ts` flag enables Tailscale-serving mode on `:8443` with certificate refresh via `tailscale cert`.
- Default mode serves plain HTTP on `:$PORT` (default `8080`).

### Legacy endpoint note

- `GET /api/decks/...` handlers still exist but use an older data lookup shape and are not used by the current SPA data-loading path.

## Draft Subsystem Architecture

Draft domain is in `server/draft.go`, room/lobby orchestration in `server/server.go` and `server/lobby.go`.

Key properties:
- In-memory room hub (`draftHub`) with per-room mutexes.
- One active websocket connection per seat (`seat_occupied` rejection otherwise).
- Per-seat monotonic `seq` numbers for idempotent picks and retry safety.
- Round advancement only after every seat picks.
- SSE lobby stream broadcasts room summaries and keepalive pings.

Current tests cover draft progression and room APIs:
- `server/draft_test.go`
- `server/draft_ws_test.go`

## Frontend Architecture

Shell entry:
- `static/index.html`
- `static/assets/app.js` (module entry)

Main frontend modules:
- `static/assets/app/state.js`: hash route parsing and route-state normalization.
- `static/assets/app/render.js`: markdown rendering, `[[Card]]` refs, mana symbol rendering, deck card-group rendering.
- `static/assets/app/deckView.js`: sideboard-application deck transformations.
- `static/assets/app/preview.js`: card hover preview behavior.
- `static/assets/app/hand.js`: sample hand/pack viewer.
- `static/assets/app/draft.js`: room websocket client.
- `static/assets/app/lobby.js`: draft lobby UI and SSE integration.
- `static/assets/app/matrix.js`: matchup matrix tab behavior.

Frontend data-loading behavior:
- Loads `/data/index.json` first.
- Loads `/data/<battlebox>.json` on demand.
- Loads `/data/<battlebox>/mtgdecks-winrate-matrix.json` on demand.
- Appends cache-busting query param based on `build_id` from index.
- Prefers `.gz` payload fetch + browser `DecompressionStream` fallback to plain JSON.

Guide editing behavior:
- Uses `/api/source-guide` to fetch and save raw matchup markdown.
- Saves to source files under `data/`, then forces reload.

## Deployment and Local Dev

### Container build

`Dockerfile`:
1. Build stage runs `sh ./build.sh` to generate static data.
2. Builds Go binary from `./server`.
3. Final distroless image serves the compiled binary.

### Fly.io

- `fly.toml` configures app/service on port `8080`.

### Local hot reload

`.air.toml`:
- Rebuilds with `go run scripts/build.go -validate=false && go build -o ./tmp/main ./server`
- Excludes generated output paths from watch loops.
- Starts server with `DEV=1` and `-ts`.

## Practical Editing Guidance

- Treat `data/` as source of truth for content changes.
- Treat `static/data/` and `.card-types.json` as generated/cache artifacts.
- Re-run build when data or buildtool logic changes.
