#!/bin/bash
# Copies the latest deck from the folder above the repository into presentation/.
cd "$(dirname "$0")" || exit 1
SRC="../../LiDAR_Workshop_Slides.pptx"
[ -f "$SRC" ] || { echo "Deck not found at $SRC"; exit 1; }
cp "$SRC" LiDAR_Workshop_Slides.pptx && echo "Updated presentation/LiDAR_Workshop_Slides.pptx"
