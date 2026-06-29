#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: npm run extract:video -- <video-url> [slug]"
  exit 2
fi

if command -v yt-dlp >/dev/null 2>&1; then
  ytdlp=(yt-dlp)
elif python3 -m yt_dlp --version >/dev/null 2>&1; then
  ytdlp=(python3 -m yt_dlp)
else
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
mkdir -p "$root/frames" "$root/audio" "$root/storyboards" "$root/storyboard_frames" "tools/video_sources"

cookie_source="${YTDLP_COOKIES_FROM_BROWSER:-chrome}"
format_selector="${YTDLP_FORMAT:-bestvideo[height<=1080]+bestaudio/best[height<=1080]/best}"
video_path="tools/video_sources/${slug}.%(ext)s"
if "${ytdlp[@]}" \
  --no-playlist \
  --cookies-from-browser "$cookie_source" \
  --format "$format_selector" \
  --write-info-json \
  --write-auto-subs \
  --sub-langs "en.*" \
  --paths "tools/video_sources" \
  --output "${slug}.%(ext)s" \
  --merge-output-format mp4 \
  "$url"; then
  download_mode="video"
else
  download_mode="storyboard"
  echo "Full video download failed; falling back to YouTube storyboard frames."
  "${ytdlp[@]}" \
    --no-playlist \
    --cookies-from-browser "$cookie_source" \
    -f sb0 \
    --paths "tools/video_sources" \
    --output "${slug}-storyboard.%(ext)s" \
    "$url"
fi

video_file="$(find tools/video_sources -maxdepth 1 -type f -name "${slug}.*" ! -name "*.json" ! -name "*.vtt" | sort | tail -1)"

if [[ "$download_mode" == "video" ]]; then
  if [[ -z "$video_file" ]]; then
    echo "Downloaded video was not found."
    exit 1
  fi

  ffmpeg -hide_banner -y -i "$video_file" -vf "fps=2,scale=1600:-1" "$root/frames/frame_%05d.jpg"
  ffmpeg -hide_banner -y -i "$video_file" -vn -ac 1 -ar 44100 "$root/audio/audio.wav"
  python3 scripts/find-sheet-like-frames.py "$root/frames" "$root/sheet-frame-report.json"
  duration="$(ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "$video_file")"
  python3 scripts/storyboard-to-midi.py "$root/frames" "$duration" "public/midi/mrs-magic-strings-version.mid" "$root/video-midi-report.json"
else
  storyboard_file="$(find tools/video_sources -maxdepth 1 -type f -name "${slug}-storyboard.mhtml" | sort | tail -1)"
  if [[ -z "$storyboard_file" ]]; then
    echo "Downloaded storyboard was not found."
    exit 1
  fi
  python3 scripts/storyboard-mhtml-to-frames.py "$storyboard_file" "$root/storyboards" "$root/storyboard_frames"
  duration="$(python3 - <<PY
import json
from pathlib import Path
info = Path("tools/video_sources/${slug}.info.json")
print(json.loads(info.read_text()).get("duration", 0) if info.exists() else 0)
PY
)"
  if [[ "$duration" == "0" ]]; then
    duration=236
  fi
  python3 scripts/storyboard-to-midi.py "$root/storyboard_frames" "$duration" "public/midi/mrs-magic-strings-version.mid" "$root/storyboard-midi-report.json"
fi

cat > "$root/README.md" <<EOF
# Extracted Sheet-Music Workspace

Source URL: $url
Download mode: $download_mode
Video file: ${video_file:-none}

Generated files:

- \`frames/\`: full-video frame samples when the MP4 download succeeds
- \`storyboard_frames/\`: YouTube storyboard frame samples when full video download is blocked
- \`audio/audio.wav\`: mono audio when the MP4 download succeeds
- \`sheet-frame-report.json\`: ranked full-video frames that look most like sheet music
- \`storyboard-midi-report.json\`: note extraction report when storyboard fallback is used

The storyboard fallback writes a draft coach MIDI to \`public/midi/mrs-magic-strings-version.mid\`.
EOF

echo "Done: $root"
