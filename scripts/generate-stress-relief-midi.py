#!/usr/bin/env python3
"""Generate a beginner piano-coach MIDI for Stress Relief."""

from pathlib import Path
import struct


PPQ = 480
BPM = 142
OUTPUT = Path(__file__).resolve().parents[1] / "public/midi/stress-relief-late-night-drive-home.mid"


def varlen(value):
    buffer = value & 0x7F
    value >>= 7
    while value:
        buffer <<= 8
        buffer |= ((value & 0x7F) | 0x80)
        value >>= 7

    out = []
    while True:
        out.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
        else:
            break
    return bytes(out)


def meta(event_type, data):
    return b"\x00\xff" + bytes([event_type]) + varlen(len(data)) + data


def note_events(notes):
    events = []
    for start, duration, midi, velocity in notes:
        events.append((start, 0, bytes([0x90, midi, velocity])))
        events.append((start + duration, 1, bytes([0x80, midi, 0])))
    events.sort(key=lambda event: (event[0], event[1]))

    track = bytearray()
    previous = 0
    for tick, _, payload in events:
        track.extend(varlen(tick - previous))
        track.extend(payload)
        previous = tick
    track.extend(varlen(0))
    track.extend(b"\xff\x2f\x00")
    return bytes(track)


def add_block(notes, start, root, chord):
    beat = PPQ
    bar = beat * 4
    notes.append((start, beat * 2, root, 74))
    notes.append((start + beat * 2, beat * 2, root + 12, 60))
    for offset, midi in enumerate(chord):
        notes.append((start + beat, beat * 3, midi, 68 + offset * 4))
    return start + bar


def main():
    # Beginner arrangement from the song's common guitar progression:
    # Bbm - Eb - Ab - Dbmaj7. Left hand gets one root at a time, right hand
    # gets compact block chords so Coach mode can drill hand placement.
    progression = [
        (46, [58, 61, 65]),      # Bbm: Bb2 + Bb3 Db4 F4
        (51, [63, 67, 70]),      # Eb: Eb3 + Eb4 G4 Bb4
        (44, [56, 60, 63]),      # Ab: Ab2 + Ab3 C4 Eb4
        (49, [61, 65, 68, 72]),  # Dbmaj7: Db3 + Db4 F4 Ab4 C5
    ]

    notes = []
    tick = 0
    for _ in range(8):
        for root, chord in progression:
            tick = add_block(notes, tick, root, chord)

    tempo = int(60_000_000 / BPM)
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, PPQ)
    track_prefix = bytearray()
    track_prefix.extend(meta(0x03, b"Stress Relief - beginner piano coach"))
    track_prefix.extend(meta(0x51, tempo.to_bytes(3, "big")))
    track_prefix.extend(meta(0x58, bytes([4, 2, 24, 8])))
    track_data = bytes(track_prefix) + note_events(notes)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(header + b"MTrk" + struct.pack(">I", len(track_data)) + track_data)
    print(f"Wrote {OUTPUT} with {len(notes)} notes")


if __name__ == "__main__":
    main()
