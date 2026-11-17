#!/usr/bin/env bash
set -euo pipefail

[[ "${CODESPACES:-}" == true ]] || exit 0
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

data_dir="$PWD/.weave-codespace"
[[ ! -e "$data_dir/no-autostart" ]] || exit 0
umask 077
mkdir -p "$data_dir"

# Serialize starts and release the lock when the launch check finishes.
exec 9>"$data_dir/start.lock"
flock 9
ready() {
  [[ "$(curl -fsS --max-time 2 http://127.0.0.1:5173/api/health 2>/dev/null)" == '{"ok":true}' ]]
}
if ready; then
  echo "[weave] Already running on port 5173."
  exit 0
fi

log="$data_dir/app.log"
nohup setsid bash .devcontainer/run-weave.sh </dev/null >"$log" 2>&1 9>&- &
launcher=$!
deadline=$((SECONDS + 45))
while (( SECONDS < deadline )) && kill -0 "$launcher" 2>/dev/null; do
  if ready; then
    echo "[weave] Ready on port 5173."
    exit 0
  fi
  sleep 1
done

kill -TERM -- "-$launcher" 2>/dev/null || true
echo "[weave] Startup did not become ready. Check .weave-codespace/app.log." >&2
tail -n 20 "$log" >&2
exit 1
