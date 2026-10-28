#!/bin/sh
# S1's board session, run from the PC at the repository's root (ADR 0023):
#
#   deploy/s1-board.sh setup  <user>@<board> [save.lzma]   # once: environment, build, units
#   deploy/s1-board.sh start  <user>@<board>               # the server, then the kiosk
#   deploy/s1-board.sh status <user>@<board>               # /status, now
#   deploy/s1-board.sh stop   <user>@<board>               # the kiosk, then the server (a save)
#
# Then, from the PC, while it runs (a few hours, a UTC midnight in the window if possible:
# the daily save and the plants' day are part of the cost):
#
#   uv run python -m tools.server_watch http://<board>:8080 --minutes 180 \
#       --out runs/s1-board/status.jsonl
#
# setup copies to ~<user>/lineage/: wheels of lineage-sim, -device and -server built here,
# a virtual environment of Python 3.11 (uv's, in ~/.lineage-uv: the board's own Python is
# Debian's 3.13) with the pinned numpy and websockets (from uv.lock; the board needs the
# network for them), the desk's build, the sim's config and the server's
# settings; and to ~<user>/lineage-data/saves/ the island to start from, if there is none
# yet (default: seed 3 of runs/s1-board-island, grown one year to today: `uv run python -m
# tools.fastforward --years 1 --seeds 1 --seed-base 3 --start <a year ago> --schedule
# office --save-days 30 --snapshot-days 0 --out runs/s1-board-island`). Units are installed
# with sudo, which asks for the password on the board's terminal.
set -eu

action="${1:-}"
board="${2:-}"
[ -n "$action" ] && [ -n "$board" ] || {
  sed -n '2,6p' "$0"
  exit 2
}
user="${board%@*}"
ssh_t() { ssh -t "$board" "$@"; }

case "$action" in
setup)
  save="${3:-runs/s1-board-island/saves/3.lzma}"
  [ -f "$save" ] || { echo "no island at $save (see the comment at the top)"; exit 1; }
  [ -f renderer/dist-kiosk/index.html ] || (cd renderer && npm run build:kiosk)
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  mkdir -p "$stage/wheels" "$stage/sim/config" "$stage/server/config" "$stage/renderer"
  for package in lineage-sim lineage-device lineage-server; do
    uv build --package "$package" --wheel --out-dir "$stage/wheels" -q
  done
  uv export --no-dev --package lineage-server --no-emit-workspace --format requirements-txt \
    --no-hashes -q > "$stage/requirements.txt"
  cp sim/config/default.toml "$stage/sim/config/"
  cp server/config/server.toml "$stage/server/config/"
  cp -r renderer/dist-kiosk "$stage/renderer/"
  cp deploy/lineage-server@.service deploy/lineage-s1-kiosk@.service "$stage/"
  # The island, named as the store names saves (the world's instant).
  name="$(uv run python -c "
import sys
from pathlib import Path
from lineage_server.store import save_name
from lineage_sim.state import io
state = io.loads(Path(sys.argv[1]).read_bytes())
print(save_name(state.epoch_unix_ms + state.t_ms))
" "$save")"
  cp "$save" "$stage/$name"
  ssh "$board" 'mkdir -p lineage lineage-data/saves && rm -rf lineage/wheels lineage/renderer'
  scp -rq "$stage/wheels" "$stage/requirements.txt" "$stage/sim" "$stage/server" \
    "$stage/renderer" "$stage/lineage-server@.service" "$stage/lineage-s1-kiosk@.service" \
    "$board:lineage/"
  ssh "$board" "ls lineage-data/saves/*.lzma >/dev/null 2>&1" ||
    scp -q "$stage/$name" "$board:lineage-data/saves/$name"
  # The board's Python is Debian's (3.13 on Trixie); the project's is 3.11, which uv brings
  # (a standalone CPython). uv itself goes into a small venv of the system's Python, from
  # PyPI, so that nothing is piped into a shell.
  ssh "$board" 'set -e
    [ -x ~/.lineage-uv/bin/uv ] || { python3 -m venv ~/.lineage-uv &&
      ~/.lineage-uv/bin/pip install -q uv; }
    uv=~/.lineage-uv/bin/uv
    cd lineage
    $uv venv -q --python 3.11 --allow-existing .venv
    $uv pip install -q --python .venv -r requirements.txt
    $uv pip install -q --python .venv --no-deps --reinstall wheels/*.whl
    .venv/bin/python -c "import sys, lineage_server.main, numpy, websockets; print(\"environment ok, Python\", sys.version.split()[0])"'
  ssh_t "cd lineage && sudo cp lineage-server@.service lineage-s1-kiosk@.service \
    /etc/systemd/system/ && sudo systemctl daemon-reload &&
    sudo systemctl enable systemd-time-wait-sync >/dev/null 2>&1; echo 'units installed'"
  ;;
start)
  ssh_t "sudo systemctl start lineage-server@$user && sleep 1 &&
    for i in \$(seq 1 120); do curl -sf localhost:8080/status | grep -q '\"ready\": true' && break; sleep 1; done &&
    curl -s localhost:8080/status && echo &&
    sudo systemctl start lineage-s1-kiosk@$user && echo 'kiosk started'"
  ;;
status)
  ssh "$board" 'curl -s localhost:8080/status; echo'
  ;;
stop)
  ssh_t "sudo systemctl stop lineage-s1-kiosk@$user; sudo systemctl stop lineage-server@$user;
    sudo systemctl start getty@tty1; journalctl -u lineage-server@$user -n 5 --no-pager"
  ;;
*)
  sed -n '2,6p' "$0"
  exit 2
  ;;
esac
