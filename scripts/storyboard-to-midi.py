#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

from PIL import Image


FIRST_NOTE = 21
LAST_NOTE = 108
WHITE_PITCHES = {0, 2, 4, 5, 7, 9, 11}


def key_geometry(width):
    keys = []
    white_index = 0
    for midi in range(FIRST_NOTE, LAST_NOTE + 1):
        pitch = midi % 12
        is_white = pitch in WHITE_PITCHES
        if is_white:
            left = white_index
            white_index += 1
        else:
            left = white_index - 0.36
        keys.append(
            {
                "midi": midi,
                "x": (left / 52) * width,
                "black": not is_white,
            }
        )

    for key in keys:
        key["width"] = (0.58 if key["black"] else 0.86) / 52 * width
        key["center"] = key["x"] + key["width"] / 2
    return keys


def nearest_midi(x, keys):
    return min(keys, key=lambda item: abs(item["center"] - x))["midi"]


def colored_columns(image):
    width, height = image.size
    pixels = image.convert("RGB").load()
    # The playable moment is where falling bars contact the keyboard.
    y0 = int(height * 0.58)
    y1 = int(height * 0.82)
    counts = [0] * width
    for x in range(width):
        total = 0
        for y in range(y0, y1):
            r, g, b = pixels[x, y]
            green = g > 115 and g > r * 1.25 and g > b * 1.05
            blue = b > 110 and b > r * 1.2 and b > g * 0.78
            if green or blue:
                total += 1
        counts[x] = total
    threshold = max(3, int((y1 - y0) * 0.08))
    return [x for x, count in enumerate(counts) if count >= threshold]


def clusters(columns):
    groups = []
    current = []
    for x in columns:
        if not current or x <= current[-1] + 2:
            current.append(x)
        else:
            groups.append(current)
            current = [x]
    if current:
        groups.append(current)
    return [group for group in groups if len(group) >= 2]


def frame_notes(path, keys):
    image = Image.open(path)
    midis = set()
    for group in clusters(colored_columns(image)):
        center = sum(group) / len(group)
        midis.add(nearest_midi(center, keys))
    return sorted(midis)


def var_len(value):
    bytes_out = [value & 0x7F]
    value >>= 7
    while value:
        bytes_out.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(bytes_out)


def write_midi(notes_by_frame, frame_seconds, output):
    ticks_per_quarter = 480
    tempo_us = 500000
    ticks_per_second = ticks_per_quarter * 1_000_000 / tempo_us
    events = []
    active = {}

    for index, notes in enumerate(notes_by_frame):
        now = int(round(index * frame_seconds * ticks_per_second))
        next_notes = set(notes)
        for midi in list(active):
            if midi not in next_notes:
                events.append((now, 0x80, midi, 0))
                active.pop(midi)
        for midi in next_notes:
            if midi not in active:
                events.append((now, 0x90, midi, 84))
                active[midi] = now

    end_tick = int(round((len(notes_by_frame) + 1) * frame_seconds * ticks_per_second))
    for midi in list(active):
        events.append((end_tick, 0x80, midi, 0))

    events.sort(key=lambda event: (event[0], event[1]))
    track = bytearray()
    name = b"Mrs Magic Draft"
    track.extend(b"\x00\xff\x03")
    track.extend(var_len(len(name)))
    track.extend(name)
    track.extend(b"\x00\xff\x51\x03\x07\xa1\x20")
    last_tick = 0
    for tick, status, midi, velocity in events:
        track.extend(var_len(max(0, tick - last_tick)))
        track.extend(bytes([status, midi, velocity]))
        last_tick = tick
    track.extend(b"\x00\xff\x2f\x00")

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as file:
        file.write(b"MThd")
        file.write((6).to_bytes(4, "big"))
        file.write((0).to_bytes(2, "big"))
        file.write((1).to_bytes(2, "big"))
        file.write((ticks_per_quarter).to_bytes(2, "big"))
        file.write(b"MTrk")
        file.write(len(track).to_bytes(4, "big"))
        file.write(track)


def main():
    if len(sys.argv) != 5:
        print("Usage: storyboard-to-midi.py <frames-dir> <duration-seconds> <midi-output> <report-json>", file=sys.stderr)
        return 2

    frames_dir = Path(sys.argv[1])
    duration = float(sys.argv[2])
    output = Path(sys.argv[3])
    report = Path(sys.argv[4])
    frames = sorted(frames_dir.glob("frame_*.jpg"))
    if not frames:
        print(f"No storyboard frames found in {frames_dir}", file=sys.stderr)
        return 1

    sample = Image.open(frames[0])
    keys = key_geometry(sample.size[0])
    frame_seconds = duration / max(1, len(frames) - 1)
    notes_by_frame = [frame_notes(path, keys) for path in frames]
    write_midi(notes_by_frame, frame_seconds, output)
    report.write_text(
        json.dumps(
            {
                "source": str(frames_dir),
                "frames": len(frames),
                "duration_seconds": duration,
                "frame_seconds": frame_seconds,
                "midi_output": str(output),
                "nonempty_frames": sum(1 for notes in notes_by_frame if notes),
                "first_frames": notes_by_frame[:20],
            },
            indent=2,
        )
    )
    print(f"Wrote {output}")
    print(f"Wrote {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
