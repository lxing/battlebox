---
name: deck-primer-writer
description: Write sober, gameplay-focused deck primers using web research; use when asked to generate or update any battlebox primer.
---

# Deck Primer Writer

## Purpose
Create concise, accurate primers for battlebox decks that focus on gameplay and strategy.

## Required workflow
1. **Read the decklist**: Open `data/<battlebox>/<deck>/manifest.json` to identify key cards, core plan, and sideboard (if present).
2. **Research**: Use `web.run` to find reliable primers or strategy discussions for the *specific archetype*.  
   - Prefer official format resources and established primer articles/posts.  
   - Avoid conflating similar archetypes.  
   - If you cannot find enough trustworthy material, report that instead of guessing.
3. **Draft the primer**: Write `data/<battlebox>/<deck>/primer.md`.
   - Tone: clear and factual; keep hype minimal unless the user requests it.
   - Structure: short intro paragraph + `### Early game`, `### Midgame`, `### Closing the game`.
   - Use `[[Card Name]]` references for notable cards that appear in the decklist.
   - Length: ~150–250 words, concise and practical.
   - **Do not** include a sideboard section unless explicitly requested.
4. **Integrity**: Do not edit `manifest.json` or any printings files while writing primers.

## Notes
- Paraphrase sources; do not copy long quotes.
- If sources conflict, prefer consensus or note uncertainty.
