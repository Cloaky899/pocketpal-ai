#!/usr/bin/env python3
"""Classify the first useful renderer failure without emitting raw secrets."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PATTERNS = [
    ("dependency", re.compile(r"ModuleNotFoundError|No module named|ImportError|pip install", re.I)),
    ("syntax", re.compile(r"SyntaxError|IndentationError|invalid syntax", re.I)),
    ("policy", re.compile(r"not allowed|disallowed|policy", re.I)),
    ("timeout", re.compile(r"timed out|TimeoutExpired|timeout", re.I)),
    ("resource", re.compile(r"out of memory|disk space|killed|resource", re.I)),
    ("artifact", re.compile(r"no MP4|missing|artifact|file not found|failed to find package", re.I)),
    ("network", re.compile(r"HTTP [45]\d\d|URLError|connection|rate limit|quota", re.I)),
]


def sanitize(line: str) -> str:
    line = re.sub(r"(?i)(authorization\s*:\s*bearer\s+)[^\s]+", r"\1[redacted]", line)
    line = re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)[^\s]+", r"\1[redacted]", line)
    return line[:500]


def main() -> int:
    paths = [Path(value) for value in sys.argv[1:]]
    lines: list[str] = []
    for path in paths:
        if path.is_file():
            lines.extend(path.read_text(encoding="utf-8", errors="replace").splitlines())
    for line in lines:
        for category, pattern in PATTERNS:
            if pattern.search(line):
                print(json.dumps({"category": category, "first_causal_line": sanitize(line)}))
                return 0
    print(json.dumps({"category": "unknown", "first_causal_line": sanitize(lines[-1]) if lines else "no diagnostic log found"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
