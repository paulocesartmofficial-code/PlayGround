#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-/home/runner/work/_temp/omgithub-runtime}"
export RUNTIME_DIR

# Report elapsed time and preserve command status for diagnostics.
timed() {
  local label="$1" start end status
  shift
  start="$(date +%s%3N)"
  if "$@"; then status=0; else status=$?; fi
  end="$(date +%s%3N)"
  printf '[timing] %s: %s ms (exit %s)\n' "$label" "$((end - start))" "$status" >&2
  return "$status"
}

[[ -n "${CAPTURE_URL:-}" ]] || { echo 'Set CAPTURE_URL to the exact preview URL.' >&2; exit 1; }
[[ -n "${CAPTURE_DIR:-}" ]] || { echo 'Set CAPTURE_DIR for screenshot output.' >&2; exit 1; }
[[ "$CAPTURE_URL" =~ ^https?:// ]] || { echo 'CAPTURE_URL must be an HTTP(S) URL.' >&2; exit 1; }

cd "$PROJECT_DIR"
# Screenshot evidence must remain outside the project source tree.
case "$(realpath -m "$CAPTURE_DIR")/" in
  "$PROJECT_DIR"/*) echo 'CAPTURE_DIR must be outside the project source tree.' >&2; exit 1 ;;
esac

timed 'create capture output directory' mkdir -p "$CAPTURE_DIR"
# The runtime capture helper owns and closes its Chromium instance, waits for
# rendered content, and assigns exit 75 to transient browser/navigation errors.
timed 'capture desktop and mobile screenshots' env CAPTURE_STRICT=1 node "$RUNTIME_DIR/scripts/default-capture.mjs"
