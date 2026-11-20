#!/bin/bash
# Supervisor TV Market API — pastikan server hidup walaupun proses induk dibunuh.
# Jalankan: nohup bash /home/ubuntu/.hermes/cache/scratch/tv/supervise.sh >/dev/null 2>&1 &
cd /home/ubuntu/.hermes/cache/scratch/tv
LOG=/home/ubuntu/.hermes/cache/scratch/tv/server.log

while true; do
  if ! pgrep -f "node api/server-live.js" >/dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] server mati — restart" >> "$LOG"
    PORT=8081 node api/server-live.js >> "$LOG" 2>&1
  fi
  sleep 5
done
