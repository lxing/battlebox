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
    if len(tail) < 3:
        raise SystemExit(
            "unable to derive current manifest path: expected staging/<battlebox>/<deck>/manifest.json"
        )
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


def zone_diff_lines(label: str, current: dict, staging: dict) -> tuple[list[str], list[str]]:
    c_qty, c_name = zone_to_map(current.get(label, []))
    s_qty, s_name = zone_to_map(staging.get(label, []))
    keys = sorted(set(c_qty) | set(s_qty))

    added_lines: list[str] = []
    removed_lines: list[str] = []

    for key in keys:
        cq = c_qty.get(key, 0)
        sq = s_qty.get(key, 0)
        if cq == sq:
            continue
        name = s_name.get(key) or c_name.get(key) or key
        delta = sq - cq
        if delta > 0:
            line = f"+{abs(delta)} {name} ({cq} -> {sq})"
            added_lines.append(line)
        else:
            line = f"-{abs(delta)} {name} ({cq} -> {sq})"
            removed_lines.append(line)

    return added_lines, removed_lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Diff staging manifest against current deck manifest.")
    parser.add_argument(
        "--staging",
        required=True,
        help="Path to staging manifest, for example staging/pauper/caw-gates/manifest.json",
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

    main_added_lines, main_removed_lines = zone_diff_lines("cards", current, staging)
    side_added_lines, side_removed_lines = zone_diff_lines("sideboard", current, staging)

    print(f"staging: {staging_path}")
    print(f"current: {current_path}")
    print()

    if main_added_lines or main_removed_lines:
        print("mainboard")
        for line in main_added_lines + main_removed_lines:
            print(line)
        print()

    if side_added_lines or side_removed_lines:
        print("sideboard")
        for line in side_added_lines + side_removed_lines:
            print(line)
        print()

    if (
        not main_added_lines
        and not main_removed_lines
        and not side_added_lines
        and not side_removed_lines
    ):
        print("No differences.")
    else:
        print(
            "Summary "
            f"(main +{len(main_added_lines)} -{len(main_removed_lines)}, "
            f"side +{len(side_added_lines)} -{len(side_removed_lines)})"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
