#!/usr/bin/env python3
"""Generate slug-only MTGDecks winrate matrices from alias maps."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict


CELL_RE = re.compile(
    r"(?P<ci_low>\d+(?:\.\d+)?)%\s*-\s*(?P<ci_high>\d+(?:\.\d+)?)%\s*"
    r"(?P<wr>\d+(?:\.\d+)?)\s*%\s*(?P<matches>[\d,]+)\s*matches",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FormatConfig:
    name: str
    alias_path: Path
    output_path: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch and generate MTGDecks winrate matrix JSON."
    )
    parser.add_argument(
        "formats",
        nargs="*",
        choices=["pauper", "premodern"],
        help="Formats to generate (default: both).",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root containing data/<format>/mtgdecks-name-to-slug.json.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate but do not write output files.",
    )
    parser.add_argument(
        "--prune-existing",
        action="store_true",
        help="Prune mirror matchup cells from existing output files without fetching.",
    )
    return parser.parse_args()


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "data/pauper/mtgdecks-name-to-slug.json").exists():
            return candidate
    raise SystemExit("Could not locate repository root from script path.")


def clean_text(value: str) -> str:
    return value.replace("\xa0", " ").strip()


def fetch_winrate_html(source: str) -> str:
    try:
        import cloudscraper
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise SystemExit(
            "Missing dependencies. Install with:\n"
            "  python3 -m pip install cloudscraper beautifulsoup4 lxml"
        ) from exc

    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "darwin", "desktop": True}
    )
    response = scraper.get(source, timeout=45)
    response.raise_for_status()
    return response.text


def parse_cell(text: str) -> Dict[str, float | int] | None:
    normalized = " ".join(clean_text(text).split())
    match = CELL_RE.search(normalized)
    if not match:
        return None
    return {
        "wr": round(float(match.group("wr")) / 100.0, 4),
        "matches": int(match.group("matches").replace(",", "")),
        "ci_low": round(float(match.group("ci_low")) / 100.0, 4),
        "ci_high": round(float(match.group("ci_high")) / 100.0, 4),
    }


def load_format_config(repo_root: Path, fmt: str) -> FormatConfig:
    alias_path = repo_root / f"data/{fmt}/mtgdecks-name-to-slug.json"
    output_path = repo_root / f"data/{fmt}/mtgdecks-winrate-matrix.json"
    if not alias_path.exists():
        raise SystemExit(f"Alias map missing for {fmt}: {alias_path}")
    return FormatConfig(name=fmt, alias_path=alias_path, output_path=output_path)


def enforce_one_to_one(name_to_slug: Dict[str, str], fmt: str) -> None:
    seen: Dict[str, str] = {}
    for name, slug in name_to_slug.items():
        if slug in seen:
            raise SystemExit(
                f"Duplicate slug mapping in {fmt}: {slug!r} mapped from "
                f"{seen[slug]!r} and {name!r}"
            )
        seen[slug] = name


def infer_missing_reverse_matchups(
    matchups: Dict[str, Dict[str, Dict[str, float | int]]],
    slugs: list[str],
) -> None:
    """Fill missing directed cells by inverting the reverse matchup when available."""
    for from_slug in slugs:
        row = matchups.setdefault(from_slug, {})
        for to_slug in slugs:
            if from_slug == to_slug:
                continue
            if to_slug in row:
                continue

            reverse = matchups.get(to_slug, {}).get(from_slug)
            if not reverse:
                continue

            reverse_wr = reverse.get("wr")
            if not isinstance(reverse_wr, (int, float)):
                continue

            inferred_wr = round(1.0 - float(reverse_wr), 4)
            if inferred_wr < 0.0:
                inferred_wr = 0.0
            if inferred_wr > 1.0:
                inferred_wr = 1.0

            inferred: Dict[str, float | int] = {
                "wr": inferred_wr,
                "matches": int(reverse.get("matches", 0)),
            }
            # Confidence interval inversion is symmetric around 0.5.
            ci_low = reverse.get("ci_low")
            ci_high = reverse.get("ci_high")
            if isinstance(ci_low, (int, float)) and isinstance(ci_high, (int, float)):
                inferred["ci_low"] = round(1.0 - float(ci_high), 4)
                inferred["ci_high"] = round(1.0 - float(ci_low), 4)

            row[to_slug] = inferred


def prune_mirror_matchups(
    matchups: Dict[str, Dict[str, Dict[str, float | int]]],
) -> Dict[str, Dict[str, Dict[str, float | int]]]:
    """Drop mirror matchup cells (`A -> A`) from all rows."""
    cleaned: Dict[str, Dict[str, Dict[str, float | int]]] = {}
    for from_slug, row in matchups.items():
        next_row = {to_slug: cell for to_slug, cell in row.items() if to_slug != from_slug}
        if next_row:
            cleaned[from_slug] = next_row
    return cleaned


def compute_totals(
    matchups: Dict[str, Dict[str, Dict[str, float | int]]],
    slugs: list[str],
) -> Dict[str, Dict[str, float | int]]:
    """Compute per-deck aggregate wins/matches/wr across all opponents."""
    totals: Dict[str, Dict[str, float | int]] = {}
    for slug in slugs:
        row = matchups.get(slug, {})
        wins = 0
        matches = 0
        for opp_slug, cell in row.items():
            if opp_slug == slug:
                continue
            wr = cell.get("wr")
            played = cell.get("matches")
            if not isinstance(wr, (int, float)) or not isinstance(played, int):
                continue
            if played <= 0:
                continue
            wins += round(float(played) * float(wr))
            matches += played

        total_wr = round(float(wins) / float(matches), 4) if matches > 0 else 0.0
        totals[slug] = {
            "wins": wins,
            "matches": matches,
            "wr": total_wr,
        }
    return totals


def build_matrix(config: FormatConfig, fetched_at: str) -> Dict[str, object]:
    try:
        from bs4 import BeautifulSoup
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise SystemExit(
            "Missing dependencies. Install with:\n"
            "  python3 -m pip install cloudscraper beautifulsoup4 lxml"
        ) from exc

    alias_doc = json.loads(config.alias_path.read_text())
    source = alias_doc["source"]
    name_to_slug = alias_doc["name_to_slug"]

    enforce_one_to_one(name_to_slug, config.name)

    soup = BeautifulSoup(fetch_winrate_html(source), "lxml")
    table = soup.find("table")
    if table is None:
        raise SystemExit(f"No matchup table found for {config.name} at {source}")

    rows = table.find_all("tr")
    if len(rows) < 2:
        raise SystemExit(f"Matchup table too short for {config.name} at {source}")

    headers = [clean_text(c.get_text(" ", strip=True)) for c in rows[0].find_all(["th", "td"])]
    matchups: Dict[str, Dict[str, Dict[str, float | int]]] = {}

    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if not cells:
            continue

        row_name = clean_text(cells[0].get_text(" ", strip=True))
        from_slug = name_to_slug.get(row_name)
        if not from_slug:
            continue

        row_matchups: Dict[str, Dict[str, float | int]] = {}
        limit = min(len(cells), len(headers))
        for idx in range(2, limit):  # skip row label + overall
            opp_name = headers[idx]
            to_slug = name_to_slug.get(opp_name)
            if not to_slug:
                continue
            if to_slug == from_slug:
                continue
            parsed = parse_cell(cells[idx].get_text(" ", strip=True))
            if parsed is None:
                continue
            row_matchups[to_slug] = parsed

        if row_matchups:
            matchups[from_slug] = row_matchups

    slugs = sorted(set(name_to_slug.values()))
    infer_missing_reverse_matchups(matchups, slugs)
    matchups = prune_mirror_matchups(matchups)
    # Keep only non-empty rows after inference pass.
    matchups = {slug: row for slug, row in matchups.items() if row}
    totals = compute_totals(matchups, slugs)

    return {
        "format": config.name,
        "source": source,
        "fetched_at": fetched_at,
        "matchups": matchups,
        "totals": totals,
    }


def prune_existing_matrix(config: FormatConfig, dry_run: bool) -> tuple[int, int]:
    alias_doc = json.loads(config.alias_path.read_text())
    name_to_slug = alias_doc["name_to_slug"]
    slugs = sorted(set(name_to_slug.values()))

    if not config.output_path.exists():
        raise SystemExit(f"Output matrix missing for {config.name}: {config.output_path}")

    payload = json.loads(config.output_path.read_text())
    raw_matchups = payload.get("matchups", {})
    if not isinstance(raw_matchups, dict):
        raise SystemExit(f"Invalid matchups payload in {config.output_path}")

    matchups: Dict[str, Dict[str, Dict[str, float | int]]] = {}
    for from_slug, row in raw_matchups.items():
        if not isinstance(row, dict):
            continue
        matchups[from_slug] = {
            to_slug: cell
            for to_slug, cell in row.items()
            if isinstance(cell, dict)
        }

    matchups = prune_mirror_matchups(matchups)
    payload["matchups"] = matchups
    payload["totals"] = compute_totals(matchups, slugs)

    if not dry_run:
        config.output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

    rows = len(matchups)
    cells = sum(len(v) for v in matchups.values())
    return rows, cells


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root or find_repo_root(Path(__file__).resolve())
    formats = args.formats or ["pauper", "premodern"]

    fetched_at = (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )

    for fmt in formats:
        config = load_format_config(repo_root, fmt)
        if args.prune_existing:
            rows, cells = prune_existing_matrix(config, args.dry_run)
            print(f"{fmt}: pruned mirrors rows={rows} cells={cells} output={config.output_path}")
            continue

        payload = build_matrix(config, fetched_at)
        rows = len(payload["matchups"])
        cells = sum(len(v) for v in payload["matchups"].values())

        if not args.dry_run:
            config.output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

        print(f"{fmt}: rows={rows} cells={cells} output={config.output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
