#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$PROJECT_DIR/dist"
PORT="${PORT:-3000}"
OPENCODE_WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
# Vite preview validates the Host header; explicitly permit the public preview
# hostname used by this deployment (override PREVIEW_HOST when it changes).
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${PREVIEW_HOST:-live-42540435999-1.omgithub.com}"
export PORT OPENCODE_WEB_DIR __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS

# Report elapsed time and preserve each command's exit status, including the
# long-running foreground preview server.
timed() {
  local label="$1" start end status
  shift
  start="$(date +%s%3N)"
  if "$@"; then status=0; else status=$?; fi
  end="$(date +%s%3N)"
  printf '[timing] %s: %s ms (exit %s)\n' "$label" "$((end - start))" "$status" >&2
  return "$status"
}

needs_build() {
  [[ ! -s "$BUILD_DIR/index.html" ]] && return 0
  ! find "$PROJECT_DIR" \
    -type d \( -name .git -o -name node_modules -o -path "$BUILD_DIR" \) -prune -o \
    -type f -newer "$BUILD_DIR/index.html" -print -quit | grep -q .
}

cd "$PROJECT_DIR"
[[ -f package.json ]] || { echo "No package.json in $PROJECT_DIR" >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo 'PORT must be numeric.' >&2; exit 1; }

# Keep generated source/build artifacts in the project; only deployment
# metadata is written to the worker's temporary web directory.
timed 'create worker metadata directory' mkdir -p "$OPENCODE_WEB_DIR"
if [[ -f package-lock.json ]]; then
  timed 'npm ci' npm ci
else
  timed 'npm install' npm install
fi

if needs_build; then
  timed 'npm run build' npm run build
else
  printf '[timing] build check: skipped (dist is up to date)\n' >&2
fi
[[ -s "$BUILD_DIR/index.html" ]] || { echo "Build output missing: $BUILD_DIR/index.html" >&2; exit 1; }

timed 'write deployment metadata' node -e 'const fs=require("node:fs"); const path=require("node:path"); const project=process.cwd(); const directory=path.resolve(project,"dist"); if (!directory.startsWith(project+path.sep)) throw new Error("Build directory must be inside project"); fs.writeFileSync(path.join(process.env.OPENCODE_WEB_DIR,"deployment-output.json"), JSON.stringify({project,directory}));'

# Vite preview is intentionally the foreground process managed by the runtime
# controller (tmux); do not background or daemonize it here.
timed 'serve production build' npm run preview -- --host 0.0.0.0 --port "$PORT"
