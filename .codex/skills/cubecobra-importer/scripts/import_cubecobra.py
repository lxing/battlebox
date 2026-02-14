#!/usr/bin/env python3
"""
Import a CubeCobra list into battlebox deck source files.

Writes:
  data/<battlebox>/<deck-slug>/manifest.json
  data/<battlebox>/<deck-slug>/printings.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any
from urllib import error, request


CUBECobra_API = "https://cubecobra.com/cube/api/cubeJSON/{cube_id}"
SCRYFALL_COLLECTION_API = "https://api.scryfall.com/cards/collection"
SCRYFALL_COLLECTION_BATCH_SIZE = 75


def slugify(value: str) -> str:
    slug = value.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "cube"


def parse_cube_id(cube_input: str) -> str:
    cube_input = cube_input.strip()
    m = re.search(r"/cube/list/([^/?#]+)", cube_input)
    if m:
        return m.group(1)
    return cube_input


def fetch_json(url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = None
    headers = {"Accept": "application/json"}
    method = "GET"
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"

    req = request.Request(url, data=body, headers=headers, method=method)
    with request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_printing(set_code: str, collector_number: str) -> str:
    return f"{set_code.strip().lower()}/{collector_number.strip().lower()}"


def chunked(items: list[Any], size: int) -> list[list[Any]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def extract_cube_rows(cube: dict[str, Any]) -> list[dict[str, Any]]:
    cards = cube.get("cards")
    if not isinstance(cards, dict):
        raise ValueError("Cube payload missing cards object")
    mainboard = cards.get("mainboard")
    if not isinstance(mainboard, list):
        raise ValueError("Cube payload missing cards.mainboard list")
    return mainboard


def build_cards_and_identifiers(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[tuple[str, str], set[str]], dict[str, str]]:
    counts: "OrderedDict[str, int]" = OrderedDict()
    key_to_names: dict[tuple[str, str], set[str]] = defaultdict(set)
    cubecobra_fallback_printings: dict[str, str] = {}

    for row in rows:
        details = row.get("details")
        if not isinstance(details, dict):
            continue

        name = details.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        name = name.strip()

        counts[name] = counts.get(name, 0) + 1

        scryfall_id = details.get("scryfall_id")
        set_code = details.get("set")
        collector = details.get("collector_number")

        if isinstance(set_code, str) and isinstance(collector, str):
            cubecobra_fallback_printings[name] = normalize_printing(set_code, collector)

        if isinstance(scryfall_id, str) and scryfall_id.strip():
            key_to_names[("id", scryfall_id.strip())].add(name)
        elif isinstance(set_code, str) and isinstance(collector, str):
            set_collector = normalize_printing(set_code, collector)
            key_to_names[("setcn", set_collector)].add(name)

    cards = [{"name": name, "qty": qty} for name, qty in counts.items()]
    return cards, key_to_names, cubecobra_fallback_printings


def resolve_printings_from_scryfall(
    key_to_names: dict[tuple[str, str], set[str]],
) -> tuple[dict[str, str], dict[tuple[str, str], set[str]]]:
    identifiers: list[dict[str, str]] = []
    for key_type, key_value in key_to_names:
        if key_type == "id":
            identifiers.append({"id": key_value})
        elif key_type == "setcn":
            set_code, collector = key_value.split("/", 1)
            identifiers.append({"set": set_code, "collector_number": collector})

    printings: dict[str, str] = {}
    unresolved: dict[tuple[str, str], set[str]] = dict(key_to_names)

    for batch in chunked(identifiers, SCRYFALL_COLLECTION_BATCH_SIZE):
        payload = {"identifiers": batch}
        data = fetch_json(SCRYFALL_COLLECTION_API, payload=payload)

        cards = data.get("data", [])
        if not isinstance(cards, list):
            raise ValueError("Unexpected Scryfall collection response: data is not a list")

        for card in cards:
            if not isinstance(card, dict):
                continue
            set_code = card.get("set")
            collector = card.get("collector_number")
            if not isinstance(set_code, str) or not isinstance(collector, str):
                continue
            printing = normalize_printing(set_code, collector)

            match_keys: list[tuple[str, str]] = []
            card_id = card.get("id")
            if isinstance(card_id, str) and ("id", card_id) in unresolved:
                match_keys.append(("id", card_id))

            set_key = ("setcn", printing)
            if set_key in unresolved:
                match_keys.append(set_key)

            for mk in match_keys:
                for name in unresolved.get(mk, set()):
                    printings[name] = printing
                unresolved.pop(mk, None)

        # Be gentle to Scryfall and avoid bursting when users import larger cubes.
        time.sleep(0.06)

    return printings, unresolved


def load_existing_manifest(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        parsed = json.load(f)
    if not isinstance(parsed, dict):
        raise ValueError(f"Existing manifest is not a JSON object: {path}")
    return parsed


def write_json(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import CubeCobra list into battlebox source files.")
    parser.add_argument("cube", help="CubeCobra URL or short/id (e.g. 3jujr)")
    parser.add_argument("--battlebox", default="cube", help="Battlebox directory under data/ (default: cube)")
    parser.add_argument("--deck-slug", help="Deck slug directory name. Defaults to cube-name slug.")
    parser.add_argument("--data-dir", default="data", help="Root data directory (default: data)")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without writing files")
    parser.add_argument(
        "--replace-manifest-fields",
        action="store_true",
        help="Replace manifest object instead of preserving existing non-cards fields",
    )
    parser.add_argument(
        "--allow-cubecobra-fallback",
        action="store_true",
        help="Allow CubeCobra-provided set/collector fallback if Scryfall misses cards",
    )
    args = parser.parse_args()

    cube_id = parse_cube_id(args.cube)
    cube = fetch_json(CUBECobra_API.format(cube_id=cube_id))

    cube_name = cube.get("name")
    if not isinstance(cube_name, str) or not cube_name.strip():
        raise ValueError("Cube payload missing name")
    cube_name = cube_name.strip()

    rows = extract_cube_rows(cube)
    cards, key_to_names, fallback_printings = build_cards_and_identifiers(rows)
    resolved_printings, unresolved = resolve_printings_from_scryfall(key_to_names)

    if unresolved and not args.allow_cubecobra_fallback:
        unresolved_names = sorted({n for names in unresolved.values() for n in names})
        print("Error: Scryfall did not resolve these cards:", file=sys.stderr)
        for name in unresolved_names:
            print(f"- {name}", file=sys.stderr)
        return 2

    printings = dict(resolved_printings)
    if unresolved:
        for names in unresolved.values():
            for name in names:
                fallback = fallback_printings.get(name)
                if fallback:
                    printings[name] = fallback

    for card in cards:
        if card["name"] not in printings:
            print(f"Error: no printing resolved for '{card['name']}'", file=sys.stderr)
            return 3

    deck_slug = args.deck_slug or slugify(cube_name)
    target_dir = Path(args.data_dir) / args.battlebox / deck_slug
    manifest_path = target_dir / "manifest.json"
    printings_path = target_dir / "printings.json"

    if args.replace_manifest_fields:
        manifest: dict[str, Any] = {"name": cube_name, "colors": "", "cards": cards}
    else:
        existing = load_existing_manifest(manifest_path)
        if existing is None:
            manifest = {"name": cube_name, "colors": "", "cards": cards}
        else:
            manifest = existing
            manifest["cards"] = cards
            if not manifest.get("name"):
                manifest["name"] = cube_name
            if "colors" not in manifest:
                manifest["colors"] = ""

    sorted_printings = {name: printings[name] for name in sorted(printings)}

    print(f"Cube: {cube_name} ({cube_id})")
    print(f"Cards imported: {len(cards)}")
    print(f"Total copies: {sum(c['qty'] for c in cards)}")
    print(f"Printings resolved: {len(sorted_printings)}")
    print(f"Manifest path: {manifest_path}")
    print(f"Printings path: {printings_path}")

    if args.dry_run:
        print("Dry run: no files written.")
        return 0

    target_dir.mkdir(parents=True, exist_ok=True)
    write_json(manifest_path, manifest)
    write_json(printings_path, sorted_printings)
    print("Wrote manifest and printings.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except error.HTTPError as exc:
        print(f"HTTP error: {exc.code} {exc.reason}", file=sys.stderr)
        raise SystemExit(1)
    except error.URLError as exc:
        print(f"Network error: {exc}", file=sys.stderr)
        raise SystemExit(1)
    except ValueError as exc:
        print(f"Input error: {exc}", file=sys.stderr)
        raise SystemExit(1)
