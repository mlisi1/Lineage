#!/bin/sh
# Start the showcase on the board's screen from SSH (R5): its status lines come here every
# 30 s; Ctrl+C stops it and prints how it ran. Needs lineage-showcase@.service installed
# (see the unit's own comments) and ~/lineage-r5/ holding showcase.py, kiosk_bench.py and
# dist-kiosk/.
unit="lineage-showcase@$(id -un)"
summary="$HOME/lineage-r5/showcase-summary.txt"
rm -f "$summary"
sudo systemctl start "$unit" || exit 1
finish() {
  trap - INT TERM
  sudo systemctl stop "$unit"
  # showcase.py writes the summary as it stops.
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$summary" ] && break; sleep 1; done
  echo
  cat "$summary" 2>/dev/null || echo "no summary written: sudo journalctl -u $unit"
  exit 0
}
trap finish INT TERM
sudo journalctl -fu "$unit" -o cat --since now
