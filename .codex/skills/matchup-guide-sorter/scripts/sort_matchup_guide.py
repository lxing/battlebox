#!/usr/bin/env python3
import argparse
import re
from pathlib import Path

COUNT_RE = re.compile(r"^(\d+)\s*x?\s*(.+)$")


def extract_name(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return ""
    if stripped[0] not in "+-":
        return ""
    rest = stripped[1:].strip()
    match = COUNT_RE.match(rest)
    name = match.group(2) if match else rest
    name = name.strip()
    if name.startswith("[[") and name.endswith("]]"):
        inner = name[2:-2].strip()
        parts = inner.split("|", 1)
        name = parts[-1].strip()
    return name


def sort_key(line: str) -> str:
    name = extract_name(line)
    return (name or line).lower()


def main() -> None:
    parser = argparse.ArgumentParser(description="Alphabetize matchup guide plan lines by card name.")
    parser.add_argument("path", help="Path to a single matchup guide .md file")
    args = parser.parse_args()

    path = Path(args.path)
    text = path.read_text()
    newline = "\r\n" if "\r\n" in text else "\n"

    lines = text.splitlines()
    plan_lines = []
    rest_start = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "":
            rest_start = i
            break
        lstripped = line.lstrip()
        if lstripped.startswith("+") or lstripped.startswith("-"):
            plan_lines.append(line)
            continue
        rest_start = i
        break
    else:
        rest_start = len(lines)

    ins = [l for l in plan_lines if l.lstrip().startswith("+")]
    outs = [l for l in plan_lines if l.lstrip().startswith("-")]

    ins_sorted = sorted(ins, key=sort_key)
    outs_sorted = sorted(outs, key=sort_key)

    out_lines = []
    out_lines.extend(ins_sorted)
    out_lines.extend(outs_sorted)
    if rest_start < len(lines):
        out_lines.extend(lines[rest_start:])

    result = newline.join(out_lines)
    if text.endswith("\n") and not result.endswith("\n"):
        result += newline

    path.write_text(result)


if __name__ == "__main__":
    main()
