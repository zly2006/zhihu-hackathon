#!/usr/bin/env python3
"""Convert independent character PNGs to WebP, build an atlas, and clean legacy art.

Usage: uv run --with pillow python scripts/art_pipeline.py --source-dir /path/to/pngs
The source directory contains f1_normal.png ... m4_playful.png (24 files).
PNG inputs are temporary build inputs; product assets are WebP only.
"""
from __future__ import annotations
import argparse, json, re, shutil
from collections import deque
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "public" / "art"
TRASH = ART / "_trash"
CHARS = [f"{g}{i}" for g in "fm" for i in range(1, 5)]
EXPRS = ("normal", "happy", "playful")
EXPECTED = {f"{c}_{e}.png" for c in CHARS for e in EXPRS}
ASSET_RE = re.compile(r"^(?:[fm][1-4](?:_(?:normal|happy|playful))?|player|cafe-rain|characters-atlas)\.(?:webp|json)$")


def keep_largest_component(im: Image.Image) -> Image.Image:
    """Remove detached neighboring sprite fragments from an alpha image."""
    rgba = im.convert("RGBA")
    alpha = rgba.getchannel("A")
    width, height = rgba.size
    pixels = alpha.load()
    seen: set[tuple[int, int]] = set()
    largest: list[tuple[int, int]] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] < 10 or (x, y) in seen:
                continue
            queue = deque([(x, y)])
            seen.add((x, y))
            component: list[tuple[int, int]] = []
            while queue:
                xx, yy = queue.popleft()
                component.append((xx, yy))
                for nx, ny in ((xx - 1, yy), (xx + 1, yy), (xx, yy - 1), (xx, yy + 1)):
                    if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen and pixels[nx, ny] >= 10:
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            if len(component) > len(largest):
                largest = component
    keep = set(largest)
    cleaned = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    source_pixels, target_pixels = rgba.load(), cleaned.load()
    for x, y in keep:
        target_pixels[x, y] = source_pixels[x, y]
    return cleaned


def convert(source_dir: Path) -> list[tuple[Path, Path, int, int]]:
    converted = []
    for name in sorted(EXPECTED):
        src = source_dir / name
        if not src.is_file():
            raise FileNotFoundError(f"missing source PNG: {src}")
        dst = ART / f"{src.stem}.webp"
        with Image.open(src) as im:
            rgba = keep_largest_component(im)
            if rgba.size != (512, 1024):
                rgba = rgba.resize((512, 1024), Image.Resampling.LANCZOS)
            rgba.save(dst, "WEBP", lossless=False, quality=80, method=6)
        converted.append((src, dst, src.stat().st_size, dst.stat().st_size))
    return converted


def build_atlas() -> tuple[Path, Path]:
    cols, rows = 4, 6
    tile_w, tile_h = 512, 1024
    atlas = Image.new("RGBA", (cols * tile_w, rows * tile_h), (0, 0, 0, 0))
    frames = {}
    for index, name in enumerate([f"{c}_{e}" for c in CHARS for e in EXPRS]):
        src = ART / f"{name}.webp"
        with Image.open(src) as im:
            tile = im.convert("RGBA")
            x, y = (index % cols) * tile_w, (index // cols) * tile_h
            atlas.alpha_composite(tile, (x, y))
            frames[name] = {"x": x, "y": y, "w": tile_w, "h": tile_h}
    atlas_path = ART / "characters-atlas.webp"
    atlas.save(atlas_path, "WEBP", lossless=False, quality=80, method=6)
    meta_path = ART / "characters-atlas.json"
    meta_path.write_text(json.dumps({"tileSize": [tile_w, tile_h], "columns": cols, "rows": rows, "frames": frames}, ensure_ascii=False, indent=2) + "\n")
    return atlas_path, meta_path


def clean() -> list[str]:
    TRASH.mkdir(parents=True, exist_ok=True)
    moved = []
    for item in sorted(ART.iterdir()):
        if item.name in {"_trash"}:
            continue
        if item.is_file() and ASSET_RE.match(item.name):
            continue
        target = TRASH / item.name
        if target.exists():
            if target.is_dir(): shutil.rmtree(target)
            else: target.unlink()
        shutil.move(str(item), str(target))
        moved.append(item.name)
    return moved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    converted = convert(args.source_dir)
    atlas, meta = build_atlas()
    moved = clean()
    print(f"converted={len(converted)} atlas={atlas.relative_to(ROOT)} metadata={meta.relative_to(ROOT)}")
    for src, dst, before, after in converted:
        print(f"{dst.relative_to(ROOT)} {before} -> {after} bytes")
    print("moved_to_trash=" + ", ".join(moved))

if __name__ == "__main__":
    main()
