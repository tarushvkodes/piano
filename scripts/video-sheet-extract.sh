#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: npm run extract:video -- <video-url> [slug]"
  exit 2
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp is not installed. Install it with: brew install yt-dlp"
  exit 127
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed. Install it with: brew install ffmpeg"
  exit 127
fi

url="$1"
slug="${2:-video}"
root="tools/extracted_sheet_music/${slug}"
mkdir -p "$root/frames" "$root/audio" "tools/video_sources"

video_path="tools/video_sources/${slug}.%(ext)s"
yt-dlp \
  --no-playlist \
  --write-info-json \
  --write-auto-subs \
  --sub-langs "en.*" \
  --paths "tools/video_sources" \
  --output "${slug}.%(ext)s" \
  --merge-output-format mp4 \
  "$url"

video_file="$(find tools/video_sources -maxdepth 1 -type f -name "${slug}.*" ! -name "*.json" ! -name "*.vtt" | sort | tail -1)"

if [[ -z "$video_file" ]]; then
  echo "Downloaded video was not found."
  exit 1
fi

ffmpeg -hide_banner -y -i "$video_file" -vf "fps=1/2,scale=1600:-1" "$root/frames/frame_%05d.jpg"
ffmpeg -hide_banner -y -i "$video_file" -vn -ac 1 -ar 44100 "$root/audio/audio.wav"

python3 scripts/find-sheet-like-frames.py "$root/frames" "$root/sheet-frame-report.json"

cat > "$root/README.md" <<EOF
# Extracted Sheet-Music Workspace

Source URL: $url
Video file: $video_file

Generated files:

- \`frames/\`: one frame every two seconds, scaled for visual/OCR inspection
- \`audio/audio.wav\`: mono audio for future transcription experiments
- \`sheet-frame-report.json\`: ranked frames that look most like sheet music

Next step: inspect the top-ranked frames, crop any visible staff area, then run OMR/OCR or manually recreate MIDI from the extracted notation.
EOF

echo "Done: $root"
