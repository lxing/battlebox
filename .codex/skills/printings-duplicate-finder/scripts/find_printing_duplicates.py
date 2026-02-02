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


def print_section(title: str, lines: list[str]) -> None:
    print(title)
    if not lines:
        print("  None.")
        return
    for line in lines:
        print(line)


def strict_by_name(entries: dict[str, list[tuple[str, str]]]) -> list[str]:
    lines: list[str] = []
    for name in sorted(entries):
        by_printing: dict[str, list[str]] = {}
        for deck, printing in entries[name]:
            by_printing.setdefault(printing, []).append(deck)
        for printing, decks in sorted(by_printing.items()):
            if len(decks) < 2:
                continue
            deck_list = ", ".join(sorted(decks))
            lines.append(f"  {name} ({printing}): {deck_list}")
    return lines


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
        "--no-strict",
        action="store_true",
        help="Skip strict (name+printing) sections in the report.",
    )
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Data directory (default: data)",
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    battlebox_dir = data_dir / args.battlebox
    box_printings = load_json(battlebox_dir / "printings.json")
    box_norm = {normalize(k): v for k, v in box_printings.items()}

    box_dupes: dict[str, list[tuple[str, str, str]]] = {}
    deck_dupes: dict[str, list[tuple[str, str]]] = {}

    for deck_dir in sorted(battlebox_dir.iterdir()):
        if not deck_dir.is_dir():
            continue
        deck_printings = load_json(deck_dir / "printings.json")
        if not deck_printings:
            continue
        for name, printing in deck_printings.items():
            key = normalize(name)
            deck_dupes.setdefault(key, []).append((deck_dir.name, printing))
            if key in box_norm:
                box_dupes.setdefault(deck_dir.name, []).append((name, printing, box_norm[key]))

    box_name_lines: list[str] = []
    box_strict_lines: list[str] = []
    for deck in sorted(box_dupes):
        entries = sorted(box_dupes[deck])
        for name, deck_printing, box_printing in entries:
            box_name_lines.append(f"{deck}\n  {name}: deck={deck_printing} box={box_printing}")
            if deck_printing == box_printing:
                box_strict_lines.append(f"{deck}\n  {name}: deck={deck_printing} box={box_printing}")

    deck_name_entries = {name: entries for name, entries in deck_dupes.items() if len(entries) > 1}
    deck_name_lines: list[str] = []
    for name in sorted(deck_name_entries):
        entries = ", ".join(f"{deck}={printing}" for deck, printing in sorted(deck_name_entries[name]))
        deck_name_lines.append(f"  {name}: {entries}")

    if not box_name_lines and not deck_name_lines:
        print("No duplicates found.")
        return 0

    print_section("Box-level duplicates (name-only):", box_name_lines)
    if not args.no_strict:
        print_section("\nBox-level duplicates (strict):", box_strict_lines)

    print_section("\nDeck-level duplicates (name-only):", deck_name_lines)
    if not args.no_strict:
        print_section("\nDeck-level duplicates (strict):", strict_by_name(deck_name_entries))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
