# FP-10 Piano Learner

This is a local browser app for learning songs on a Roland FP-10 over standard Bluetooth MIDI.

## Why this does not need proprietary reverse engineering

The FP-10 exposes Bluetooth MIDI. On macOS, pair it with **Audio MIDI Setup > Window > Show MIDI Studio > Bluetooth**, then open this app in Chrome or Edge and click **Connect MIDI**. The browser receives note-on and note-off events from the FP-10 through Web MIDI.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173/`.

## Scan for the FP-10 Bluetooth MIDI advertisement

Turn on the FP-10, then run:

```bash
npm run scan:ble-midi
```

If macOS prompts for Bluetooth permission, allow Terminal or your shell app. The standard BLE MIDI service UUID is `03B80E5A-EDE8-4B33-A751-6CE34EC4C700`.

## Practice flow

1. Pair the FP-10 in macOS Audio MIDI Setup.
2. Start the app with `npm run dev`.
3. Click **Connect MIDI** and choose the FP-10 input.
4. Load a `.mid` or `.midi` file.
5. Use **Coach** mode to play one note or chord step at a time.

Coach mode is active learning, not a passive video-style playback:

- The app highlights the exact key or chord you should play next.
- If you play the correct note or complete the chord, it advances to the next step.
- If **Restart on mistake** is enabled, a wrong note sends you back to the beginning of the song.
- If **Restart on mistake** is disabled, wrong notes are counted but the song does not reset.

**Follow** mode keeps the scrolling piano-roll behavior for looser practice.

## Built-in song slots

The Song panel has buttons for:

- `Mrs Magic` -> `public/midi/mrs-magic-strings-version.mid`
- `Stress Relief` -> `public/midi/stress-relief-late-night-drive-home.mid`

Put those MIDI files in `public/midi/` and the buttons will load them. If a source blocks browser fetches, download the MIDI and use **Load MIDI**.

If those files are missing or a URL returns HTML instead of MIDI, the app shows a clear missing-file message instead of trying to parse the page as MIDI.

## FP-10 instrument

Leave the FP-10 on Concert Piano. The app only listens to incoming MIDI notes and does not send tone/program changes to the keyboard.

## Extract video frames for sheet music

Install `yt-dlp` if needed:

```bash
brew install yt-dlp
```

Then run:

```bash
npm run extract:video -- "https://youtu.be/WvWwMW6bBls" mrs-magic
```

The script uses `yt-dlp --cookies-from-browser chrome` so YouTube can serve the actual media streams from your signed-in browser session. It creates a local workspace in `tools/extracted_sheet_music/<slug>/`, extracts frame samples and audio, and regenerates the coach MIDI at:

```text
public/midi/mrs-magic-strings-version.mid
```

If YouTube still blocks the full MP4, the script falls back to public storyboard thumbnails and generates a lower-resolution draft MIDI from those frames.
