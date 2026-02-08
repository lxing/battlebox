---
name: staging-manifest-diff
description: Compare a staged deck manifest under staging/** against the current data/** deck manifest and report metadata, mainboard, and sideboard changes. Use when iterating deck updates in staging before merging.
---

# Staging Manifest Diff

Use this skill to diff an experimental staged manifest against the current deck manifest.

## Workflow
1. Ensure the staged file exists, typically `staging/<battlebox>/<battlebox>/<deck>/manifest.json`.
2. Run the bundled diff script.
3. Review metadata changes (`name`, `source_url`, `colors`, `tags`, `difficulty_tags`, `icon`) and card quantity deltas.

## Script
Run:

```bash
python3 .codex/skills/staging-manifest-diff/scripts/diff_manifest.py \
  --staging staging/pauper/pauper/caw-gates/manifest.json
```

Optional explicit current manifest path:

```bash
python3 .codex/skills/staging-manifest-diff/scripts/diff_manifest.py \
  --staging staging/pauper/pauper/caw-gates/manifest.json \
  --current data/pauper/caw-gates/manifest.json
```

## Notes
- The script derives `--current` from `--staging` if omitted.
- Card-name comparison normalizes:
  - case and whitespace
  - diacritics (for example `Lórien` vs `Lorien`)
  - split-card suffixes after `" / "` (first face only)
- This is manifest-only bookkeeping and does not touch `printings.json`.
