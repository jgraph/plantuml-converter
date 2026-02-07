#!/bin/bash
# export-drawio.sh
#
# draw.io CLI export wrapper.
# Converts a .drawio XML file to PNG or SVG using the draw.io desktop CLI.
# Output format is detected from the output file extension.
#
# Usage: ./harness/export-drawio.sh <input.drawio> <output.png|output.svg>
#
# Environment:
#   DRAWIO_CMD - Path to draw.io executable (default: macOS app bundle path)

set -euo pipefail

DRAWIO_CMD="${DRAWIO_CMD:-/Applications/draw.io.app/Contents/MacOS/draw.io}"

if [ $# -lt 2 ]; then
	echo "Usage: $0 <input.drawio> <output.png|output.svg>" >&2
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

# Detect format from output file extension
EXT="${OUTPUT##*.}"
case "$EXT" in
	svg)
		FORMAT="svg"
		EXTRA_ARGS=""
		;;
	png)
		FORMAT="png"
		# Export PNGs at 2x scale for better readability
		EXTRA_ARGS="--scale 2"
		;;
	*)
		echo "Error: Unsupported output format: .$EXT (use .png or .svg)" >&2
		exit 1
		;;
esac

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT")"

# Export
"$DRAWIO_CMD" --export --format "$FORMAT" $EXTRA_ARGS --output "$OUTPUT" "$INPUT"
