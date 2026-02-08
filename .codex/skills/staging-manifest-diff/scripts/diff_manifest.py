#!/usr/bin/env python3
"""Diff a staging deck manifest against the current data manifest."""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Dict, Iterable, Tuple


def canonical_name(name: str) -> str:
    base = (name or "").strip()
    if " / " in base:
        base = base.split(" / ", 1)[0].strip()
    folded = unicodedata.normalize("NFKD", base)
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    folded = folded.replace("’", "'")
    folded = re.sub(r"\s+", " ", folded)
    return folded.lower().strip()


def load_manifest(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"manifest not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON at {path}: {exc}") from exc


def derive_current_path(staging_path: Path) -> Path:
    parts = list(staging_path.parts)
    if not parts or parts[0] != "staging":
        raise SystemExit(
            "unable to derive current manifest path: staging path must start with 'staging/'"
        )
    tail = parts[1:]
    if len(tail) >= 2 and tail[0] == tail[1]:
        tail = tail[1:]
    return Path("data", *tail)


def zone_to_map(entries: Iterable[dict]) -> Tuple[Dict[str, int], Dict[str, str]]:
    qty_by_key: Dict[str, int] = {}
    name_by_key: Dict[str, str] = {}
    for raw in entries or []:
        name = str(raw.get("name", "")).strip()
        if not name:
            continue
        key = canonical_name(name)
        if not key:
            continue
        qty = int(raw.get("qty", 0))
        qty_by_key[key] = qty_by_key.get(key, 0) + qty
        name_by_key[key] = name
    return qty_by_key, name_by_key


def zone_diff_lines(
    label: str, current: dict, staging: dict
) -> Tuple[list[str], list[str], list[str]]:
    c_qty, c_name = zone_to_map(current.get(label, []))
    s_qty, s_name = zone_to_map(staging.get(label, []))
    keys = sorted(set(c_qty) | set(s_qty))

    added_lines: list[str] = []
    changed_lines: list[str] = []
    removed_lines: list[str] = []

    for key in keys:
        cq = c_qty.get(key, 0)
        sq = s_qty.get(key, 0)
        if cq == sq:
            continue
        name = s_name.get(key) or c_name.get(key) or key
        if cq == 0 and sq > 0:
            added_lines.append(f"+ {sq} {name}")
        elif sq == 0 and cq > 0:
            removed_lines.append(f"- {cq} {name}")
        else:
            delta = sq - cq
            delta_str = f"+{delta}" if delta > 0 else str(delta)
            changed_lines.append(f"~ {name}: {cq} -> {sq} ({delta_str})")

    return added_lines, changed_lines, removed_lines


def list_or_none(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def metadata_diff_lines(current: dict, staging: dict) -> list[str]:
    tracked = ["name", "source_url", "colors", "tags", "difficulty_tags", "icon"]
    lines: list[str] = []
    for field in tracked:
        c_val = current.get(field)
        s_val = staging.get(field)
        if field in ("tags", "difficulty_tags"):
            c_val = sorted(str(v).strip() for v in list_or_none(c_val) if str(v).strip())
            s_val = sorted(str(v).strip() for v in list_or_none(s_val) if str(v).strip())
        else:
            c_val = "" if c_val is None else str(c_val).strip()
            s_val = "" if s_val is None else str(s_val).strip()
        if c_val != s_val:
            lines.append(f"~ {field}: {c_val!r} -> {s_val!r}")
    return lines


def print_symbol_blocks(added: list[str], changed: list[str], removed: list[str]) -> None:
    if added:
        print("  + Added")
        for line in added:
            print(f"    {line}")
    if changed:
        print("  ~ Changed")
        for line in changed:
            print(f"    {line}")
    if removed:
        print("  - Removed")
        for line in removed:
            print(f"    {line}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Diff staging manifest against current deck manifest.")
    parser.add_argument(
        "--staging",
        required=True,
        help="Path to staging manifest, for example staging/pauper/pauper/caw-gates/manifest.json",
    )
    parser.add_argument(
        "--current",
        help="Path to current manifest. If omitted, derive from staging path under data/.",
    )
    args = parser.parse_args()

    staging_path = Path(args.staging)
    current_path = Path(args.current) if args.current else derive_current_path(staging_path)

    staging = load_manifest(staging_path)
    current = load_manifest(current_path)

    metadata_lines = metadata_diff_lines(current, staging)
    main_added_lines, main_changed_lines, main_removed_lines = zone_diff_lines("cards", current, staging)
    side_added_lines, side_changed_lines, side_removed_lines = zone_diff_lines("sideboard", current, staging)

    print(f"staging: {staging_path}")
    print(f"current: {current_path}")
    print()

    if metadata_lines:
        print("Metadata")
        print("  ~ Changed")
        for line in metadata_lines:
            print(f"    {line}")
        print()

    if main_added_lines or main_changed_lines or main_removed_lines:
        print("Mainboard")
        print_symbol_blocks(main_added_lines, main_changed_lines, main_removed_lines)
        print()

    if side_added_lines or side_changed_lines or side_removed_lines:
        print("Sideboard")
        print_symbol_blocks(side_added_lines, side_changed_lines, side_removed_lines)
        print()

    if (
        not metadata_lines
        and not main_added_lines
        and not main_changed_lines
        and not main_removed_lines
        and not side_added_lines
        and not side_changed_lines
        and not side_removed_lines
    ):
        print("No differences.")
    else:
        main_added = len(main_added_lines)
        main_removed = len(main_removed_lines)
        main_changed = len(main_changed_lines)
        side_added = len(side_added_lines)
        side_removed = len(side_removed_lines)
        side_changed = len(side_changed_lines)
        print(
            "Summary "
            f"(main +{main_added} -{main_removed} ~{main_changed}, "
            f"side +{side_added} -{side_removed} ~{side_changed}, "
            f"meta {len(metadata_lines)})"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
