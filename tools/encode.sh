#!/bin/bash
# Frames (PNG, 30 fps, 3200x1800) + soundtrack -> an mp4 that X accepts (1920x1080, H.264 High, yuv420p, TV range, AAC)
#   tools/encode.sh <frames dir> <audio.wav> <out.mp4>
set -e
ffmpeg -v error -y -framerate 30 -i "$1/%05d.png" -i "$2" \
  -vf "scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -profile:v high -crf 16 -preset slow -pix_fmt yuv420p -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$3"
ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,color_range,width,height,nb_frames,r_frame_rate -of csv=p=0 "$3"
