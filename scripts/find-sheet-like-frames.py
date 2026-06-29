#!/usr/bin/env python3
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageStat
except ImportError:
    print("Pillow is required. Install it with: python3 -m pip install Pillow", file=sys.stderr)
    sys.exit(127)


def score_frame(path: Path) -> dict:
    image = Image.open(path).convert("L")
    width, height = image.size
    resized = image.resize((400, max(1, int(400 * height / width))))
    stat = ImageStat.Stat(resized)
    mean = stat.mean[0]

    dark_rows = []
    pixels = resized.load()
    for y in range(resized.height):
        dark = 0
        for x in range(resized.width):
            if pixels[x, y] < 80:
                dark += 1
        dark_rows.append(dark / resized.width)

    staffish = 0
    for index in range(len(dark_rows) - 4):
        window = dark_rows[index:index + 5]
        if sum(value > 0.08 for value in window) >= 3:
            staffish += sum(window)

    return {
        "frame": str(path),
        "brightness": round(mean, 2),
        "staff_score": round(staffish, 4),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: find-sheet-like-frames.py <frames-dir> <report-json>", file=sys.stderr)
        return 2

    frames_dir = Path(sys.argv[1])
    report_path = Path(sys.argv[2])
    frames = sorted(frames_dir.glob("*.jpg"))
    ranked = sorted((score_frame(path) for path in frames), key=lambda row: row["staff_score"], reverse=True)
    report_path.write_text(json.dumps({"frames_scanned": len(frames), "top_candidates": ranked[:50]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
