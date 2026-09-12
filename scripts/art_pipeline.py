#!/usr/bin/env python3
"""Prepare, convert, and clean Galgame art assets.

Usage:
  uv run --with pillow python scripts/art_pipeline.py --source-dir /path/to/pngs

The source directory must contain files named f1_happy.png, f1_surprised.png,
... m4_thinking.png. PNGs are copied into public/art/_source and converted to
512x1024 RGBA WebP files in public/art. Unrelated art files are moved to
public/art/_trash with their relative path preserved.
"""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "public" / "art"
SOURCE = ART / "_source"
TRASH = ART / "_trash"
CHARACTERS = [f"{g}{i}" for g in "fm" for i in range(1, 5)]
EXPRESSIONS = ("happy", "surprised", "thinking")
EXPECTED = {f"{c}_{e}.png" for c in CHARACTERS for e in EXPRESSIONS}
KEEP_RE = re.compile(r"^(?:[fm][1-4](?:_(?:happy|surprised|thinking))?|player|cafe-rain)\.(?:webp|png)$")


def copy_sources(source_dir: Path) -> list[Path]:
    SOURCE.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    for name in sorted(EXPECTED):
        src = source_dir / name
        if not src.is_file():
            raise FileNotFoundError(f"missing source PNG: {src}")
        dst = SOURCE / name
        shutil.copy2(src, dst)
        copied.append(dst)
    return copied


def convert_sources() -> list[tuple[Path, Path, int, int]]:
    converted = []
    for src in sorted(SOURCE.glob("[fm][1-4]_[a-z]*.png")):
        if src.name not in EXPECTED:
            continue
        dst = ART / f"{src.stem}.webp"
        with Image.open(src) as im:
            rgba = im.convert("RGBA")
            if rgba.size != (512, 1024):
                rgba = rgba.resize((512, 1024), Image.Resampling.LANCZOS)
            rgba.save(dst, "WEBP", lossless=False, quality=80, method=6)
        converted.append((src, dst, src.stat().st_size, dst.stat().st_size))
    return converted


def clean_art() -> tuple[list[Path], list[Path]]:
    TRASH.mkdir(parents=True, exist_ok=True)
    kept: list[Path] = []
    moved: list[Path] = []
    for item in sorted(ART.iterdir()):
        if item.name in {"_source", "_trash"}:
            kept.append(item)
            continue
        if item.is_file() and KEEP_RE.match(item.name):
            kept.append(item)
            continue
        target = TRASH / item.name
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        shutil.move(str(item), str(target))
        moved.append(item)
    return kept, moved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True, help="directory containing the 24 source PNGs")
    args = parser.parse_args()
    copied = copy_sources(args.source_dir)
    converted = convert_sources()
    kept, moved = clean_art()
    print("Copied PNG sources:")
    for p in copied:
        print(f"  {p.relative_to(ROOT)}")
    print("Converted WebP:")
    for src, dst, before, after in converted:
        print(f"  {dst.relative_to(ROOT)} {before} -> {after} bytes")
    print("Kept:")
    for p in kept:
        print(f"  {p.relative_to(ROOT)}")
    print("Moved to _trash:")
    for p in moved:
        print(f"  {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
