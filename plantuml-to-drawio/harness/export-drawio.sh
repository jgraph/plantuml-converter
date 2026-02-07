#!/bin/bash
# export-drawio.sh
#
# draw.io CLI export wrapper.
# Converts a .drawio XML file to PNG using the draw.io desktop CLI.
#
# Usage: ./harness/export-drawio.sh <input.drawio> <output.png>
#
# Environment:
#   DRAWIO_CMD - Path to draw.io executable (default: macOS app bundle path)

set -euo pipefail

DRAWIO_CMD="${DRAWIO_CMD:-/Applications/draw.io.app/Contents/MacOS/draw.io}"

if [ $# -lt 2 ]; then
	echo "Usage: $0 <input.drawio> <output.png>" >&2
	exit 1
fi

INPUT="$1"
OUTPUT="$2"

if [ ! -f "$INPUT" ]; then
	echo "Error: Input file not found: $INPUT" >&2
	exit 1
fi

if ! command -v "$DRAWIO_CMD" &>/dev/null && [ ! -x "$DRAWIO_CMD" ]; then
	echo "Error: draw.io not found at: $DRAWIO_CMD" >&2
	echo "Set DRAWIO_CMD environment variable to the draw.io executable path." >&2
	exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

# Export to PNG
"$DRAWIO_CMD" --export --format png --output "$OUTPUT" "$INPUT"
