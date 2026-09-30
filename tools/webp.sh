#!/bin/sh
# Pack one baked PNG into WebP and remove the PNG.
#   sh tools/webp.sh <file.png> <quality>
set -e
cwebp -quiet -q "$2" "$1" -o "${1%.png}.webp"
rm -f "$1"
