#!/usr/bin/env bash
# Mixes the synthesized music under the narration with automatic ducking (the music drops when the narration speaks).
# Usage: tools/mixar_trilha.sh <music gain in dB, e.g. -8> <output.mp4>   (run from the repository root; set FFMPEG to the ffmpeg path if it is not on the PATH)
set -euo pipefail
FF="${FFMPEG:-ffmpeg}"
V=entrega/video
"$FF" -hide_banner -loglevel error -y -i "$V/demo_narracao_regravada.mp4" -i "$V/narracao_regravada.wav" -i "$V/trilha_sintetizada.wav" \
  -filter_complex "[1:a]pan=stereo|c0=0.7071*c0|c1=0.7071*c0,asplit=2[v][vsc];[2:a]atrim=0:135.5,asetpts=PTS-STARTPTS,highpass=f=90,lowpass=f=9000,volume=${1}dB,afade=t=out:st=129:d=6.5[m];[m][vsc]sidechaincompress=threshold=0.02:ratio=2:attack=40:release=700[md];[v][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$2"
