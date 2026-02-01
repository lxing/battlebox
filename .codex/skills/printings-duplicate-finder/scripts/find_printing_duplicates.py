#!/usr/bin/env python3
"""Enumerate deck-level printings that duplicate battlebox-level printings."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def normalize(name: str) -> str:
    return name.strip().lower()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find deck-level printings.json entries that duplicate battlebox-level printings."
    )
    parser.add_argument(
        "--battlebox",
        "-b",
        default="premodern",
        help="Battlebox slug under data/ (default: premodern)",
    )
    parser.add_argument(
        "--mode",
        choices=("name-only", "strict"),
        default="name-only",
        help="Duplicate detection mode: name-only (default) or strict (name+printing).",
    )
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Data directory (default: data)",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    battlebox_dir = data_dir / args.battlebox
    box_printings_path = battlebox_dir / "printings.json"

    box_printings = load_json(box_printings_path)
    box_norm = {normalize(k): v for k, v in box_printings.items()}

    results: list[tuple[str, list[tuple[str, str]]]] = []

    for deck_dir in sorted(battlebox_dir.iterdir()):
        if not deck_dir.is_dir():
            continue
        deck_printings_path = deck_dir / "printings.json"
        if not deck_printings_path.exists():
            continue
        deck_printings = load_json(deck_printings_path)
        dupes: list[tuple[str, str, str]] = []
        for name, printing in deck_printings.items():
            key = normalize(name)
            if key not in box_norm:
                continue
            box_printing = box_norm[key]
            if args.mode == "strict" and box_printing != printing:
                continue
            dupes.append((name, printing, box_printing))
        if dupes:
            results.append((deck_dir.name, sorted(dupes)))

    if not results:
        print("No duplicates found.")
        return 0

    for deck, dupes in results:
        print(deck)
        for name, deck_printing, box_printing in dupes:
            print(f"  {name}: deck={deck_printing} box={box_printing}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
