# Repository Agent Notes

## Generated Files Policy
- Do not search, edit, or review generated files unless the user explicitly asks.
- Treat these as generated in this repo:
- `static/data/**` (all emitted JSON payloads such as `index.json` and battlebox JSON files; built by `scripts/build.go`)
- `static/data.json` (legacy generated output path)
- `.card-types.json` (build cache emitted by `scripts/build.go`)

## Source of Truth
- For deck and battlebox content changes, edit source files under `data/**` (for example `data/<battlebox>/manifest.json`, deck manifests, primers, and guides), then run the build only when requested.
