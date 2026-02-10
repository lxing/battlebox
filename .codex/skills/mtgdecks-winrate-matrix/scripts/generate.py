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

try:
    import cloudscraper
    from bs4 import BeautifulSoup
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit(
        "Missing dependencies. Install with:\n"
        "  python3 -m pip install cloudscraper beautifulsoup4 lxml"
    ) from exc


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
    return parser.parse_args()


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "data/pauper/mtgdecks-name-to-slug.json").exists():
            return candidate
    raise SystemExit("Could not locate repository root from script path.")


def clean_text(value: str) -> str:
    return value.replace("\xa0", " ").strip()


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


def build_matrix(config: FormatConfig, fetched_at: str) -> Dict[str, object]:
    alias_doc = json.loads(config.alias_path.read_text())
    source = alias_doc["source"]
    name_to_slug = alias_doc["name_to_slug"]

    enforce_one_to_one(name_to_slug, config.name)

    scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "darwin", "desktop": True}
    )
    response = scraper.get(source, timeout=45)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
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
            parsed = parse_cell(cells[idx].get_text(" ", strip=True))
            if parsed is None:
                continue
            row_matchups[to_slug] = parsed

        if row_matchups:
            matchups[from_slug] = row_matchups

    return {
        "format": config.name,
        "source": source,
        "fetched_at": fetched_at,
        "matchups": matchups,
    }


def main() -> int:
    args = parse_args()
    repo_root = args.repo_root or find_repo_root(Path(__file__).resolve())
    formats = args.formats or ["pauper", "premodern"]

    fetched_at = (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )

    for fmt in formats:
        config = load_format_config(repo_root, fmt)
        payload = build_matrix(config, fetched_at)
        rows = len(payload["matchups"])
        cells = sum(len(v) for v in payload["matchups"].values())

        if not args.dry_run:
            config.output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")

        print(f"{fmt}: rows={rows} cells={cells} output={config.output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
