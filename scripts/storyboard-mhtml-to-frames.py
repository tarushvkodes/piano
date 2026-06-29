#!/usr/bin/env python3
import sys
from email import policy
from email.parser import BytesParser
from io import BytesIO
from pathlib import Path

from PIL import Image


def extract_images(mhtml_path, image_dir):
    image_dir.mkdir(parents=True, exist_ok=True)
    msg = BytesParser(policy=policy.default).parsebytes(mhtml_path.read_bytes())
    paths = []
    for part in msg.walk():
        content_type = part.get_content_type()
        if not content_type.startswith("image/"):
            continue
        data = part.get_payload(decode=True)
        if not data:
            continue
        ext = content_type.split("/")[-1].replace("jpeg", "jpg")
        path = image_dir / f"storyboard_{len(paths):03d}.{ext}"
        path.write_bytes(data)
        paths.append(path)
    return paths


def split_frames(image_paths, frames_dir):
    frames_dir.mkdir(parents=True, exist_ok=True)
    frame_index = 0
    for image_path in sorted(image_paths):
        image = Image.open(image_path).convert("RGB")
        width, height = image.size
        tile_width = 320
        tile_height = 180
        for y in range(0, height, tile_height):
            for x in range(0, width, tile_width):
                tile = image.crop((x, y, x + tile_width, y + tile_height))
                if not tile.getbbox():
                    continue
                output = frames_dir / f"frame_{frame_index:04d}.jpg"
                tile.save(output, quality=92)
                frame_index += 1
    return frame_index


def main():
    if len(sys.argv) != 4:
        print("Usage: storyboard-mhtml-to-frames.py <storyboard.mhtml> <storyboard-images-dir> <frames-dir>", file=sys.stderr)
        return 2

    mhtml_path = Path(sys.argv[1])
    image_dir = Path(sys.argv[2])
    frames_dir = Path(sys.argv[3])
    image_paths = extract_images(mhtml_path, image_dir)
    frame_count = split_frames(image_paths, frames_dir)
    print(f"Extracted {len(image_paths)} storyboard sheets")
    print(f"Extracted {frame_count} storyboard frames")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
