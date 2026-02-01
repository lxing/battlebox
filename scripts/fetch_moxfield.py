#!/usr/bin/env python3
"""
Fetch a Moxfield deck and emit battlebox JSON format.

Usage:
    python scripts/fetch_moxfield.py <moxfield_url> [--battlebox <name>]

Example:
    python scripts/fetch_moxfield.py https://moxfield.com/decks/QSifD7k--ke2T87qL1PqPg --battlebox bloomburrow
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options


def slugify(name: str) -> str:
    """Convert deck name to URL-safe slug."""
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug


def fetch_deck(url: str) -> str:
    """Fetch deck export text from Moxfield using Chrome."""
    # Extract deck ID from URL
    match = re.search(r'/decks/([^/]+)', url)
    if not match:
        raise ValueError(f"Invalid Moxfield URL: {url}")

    chrome_options = Options()
    driver = webdriver.Chrome(options=chrome_options)

    try:
        print(f"Fetching: {url}")
        driver.get(url)
        wait = WebDriverWait(driver, 15)

        # Click "More" menu
        element = wait.until(EC.element_to_be_clickable((By.ID, "subheader-more")))
        element.click()

        # Click "Export"
        export_element = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//a[@class='dropdown-item cursor-pointer no-outline' and text()='Export']")
        ))
        export_element.click()

        # Get export textarea content
        textarea = wait.until(EC.presence_of_element_located(
            (By.XPATH, "//textarea[@class='form-control' and @name='full']")
        ))
        deck_contents = textarea.get_attribute("value")

        # Get deck name from page title: "Deck Name // Format deck list mtg // Moxfield"
        page_title = driver.title
        deck_name = page_title.split(" // ")[0].strip()

        print(f"Fetched: {deck_name}")
        return deck_name, deck_contents

    finally:
        driver.quit()


def parse_deck(deck_name: str, deck_contents: str, include_sideboard: bool = False):
    """
    Parse Moxfield export format into battlebox JSON.

    Moxfield format: "4 Card Name (SET) 123"
    Output format per spec.md
    """
    cards = []
    sideboard = []
    printings = {}
    current_board = cards

    # Pattern variations:
    # "4 Card Name (SET) 123"
    # "4 Card Name (SET) 123a"
    # "4 Card Name (SET) 123 *F*" (foil)
    # "1 Card Name (PLST) SET-123" (promo list)
    pattern = re.compile(r'^(\d+)\s+(.+?)\s+\(([A-Z0-9]+)\)\s+(\S+?)(?:\s+\*F\*)?$', re.IGNORECASE)

    for line in deck_contents.split('\n'):
        line = line.strip()
        if not line:
            continue
        if line.startswith('SIDEBOARD:'):
            current_board = sideboard
            continue

        match = pattern.match(line)
        if match:
            qty, name, set_code, collector_num = match.groups()
            # Handle PLST format: (PLST) NPH-130 -> nph/130
            if set_code.upper() == "PLST" and "-" in collector_num:
                actual_set, actual_num = collector_num.split("-", 1)
                printing = f"{actual_set.lower()}/{actual_num}"
            else:
                printing = f"{set_code.lower()}/{collector_num}"
            printings[name] = printing
            card = {
                "name": name,
                "qty": int(qty)
            }
            current_board.append(card)
        else:
            print(f"Warning: Could not parse line: {line}", file=sys.stderr)

    deck = {
        "name": deck_name,
        "colors": "",  # to be filled manually (e.g. "rw" for Boros)
        "cards": cards,
    }

    if include_sideboard and sideboard:
        deck["sideboard"] = sideboard

    return slugify(deck_name), deck, printings


def fetch_and_save(url: str, battlebox: str, driver, include_sideboard: bool = False) -> None:
    """Fetch a single deck and save it."""
    try:
        print(f"Fetching: {url}")
        driver.get(url)
        wait = WebDriverWait(driver, 15)

        # Click "More" menu
        element = wait.until(EC.element_to_be_clickable((By.ID, "subheader-more")))
        element.click()

        # Click "Export"
        export_element = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//a[@class='dropdown-item cursor-pointer no-outline' and text()='Export']")
        ))
        export_element.click()

        # Get export textarea content
        textarea = wait.until(EC.presence_of_element_located(
            (By.XPATH, "//textarea[@class='form-control' and @name='full']")
        ))
        deck_contents = textarea.get_attribute("value")

        # Get deck name from page title
        page_title = driver.title
        deck_name = page_title.split(" // ")[0].strip()

        print(f"Fetched: {deck_name}")

        slug, deck, printings = parse_deck(deck_name, deck_contents, include_sideboard=include_sideboard)

        # Save to data/{battlebox}/{slug}/manifest.json
        deck_dir = Path(__file__).parent.parent / "data" / battlebox / slug
        deck_dir.mkdir(parents=True, exist_ok=True)

        manifest_path = deck_dir / "manifest.json"
        with open(manifest_path, 'w') as f:
            json.dump(deck, f, indent=2)

        printings_path = deck_dir / "printings.json"
        with open(printings_path, 'w') as f:
            json.dump(printings, f, indent=2)

        # Create empty primer.md if it doesn't exist
        primer_path = deck_dir / "primer.md"
        if not primer_path.exists():
            primer_path.touch()

        print(f"Saved: {deck_dir}/")

    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Fetch Moxfield deck to battlebox JSON")
    parser.add_argument("urls", nargs="+", help="Moxfield deck URL(s)")
    parser.add_argument("--battlebox", "-b", default="bloomburrow", help="Battlebox name (default: bloomburrow)")
    parser.add_argument("--sideboard", "-s", action="store_true", help="Include sideboard")
    args = parser.parse_args()

    chrome_options = Options()
    driver = webdriver.Chrome(options=chrome_options)

    try:
        for i, url in enumerate(args.urls):
            if i > 0:
                time.sleep(1)  # be nice to Moxfield
            fetch_and_save(url, args.battlebox, driver, include_sideboard=args.sideboard)
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
