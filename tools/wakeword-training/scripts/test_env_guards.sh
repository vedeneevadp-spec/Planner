#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE_DIR}/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${REPO_ROOT}/.wakeword-venv/bin/python}"

if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="python3"
fi

expect_failure() {
  local description="$1"
  shift

  if "$@" >/tmp/wakeword-env-guard.out 2>/tmp/wakeword-env-guard.err; then
    echo "Expected failure, but command succeeded: ${description}" >&2
    exit 1
  fi
}

expect_failure "setup_env.sh fails without Python 3.11" env PYTHON_311_BIN=/bin/false "${SCRIPT_DIR}/setup_env.sh"
expect_failure "train_livekit.sh fails without usable training Python" env PYTHON_BIN=/bin/false "${SCRIPT_DIR}/train_livekit.sh" haotika-livekit-0.1.0
expect_failure "collect_livekit_frontend_artifacts.py refuses copy without license confirmation" \
  "${PYTHON_BIN}" "${SCRIPT_DIR}/collect_livekit_frontend_artifacts.py" --copy
expect_failure "generate_python_parity_fixtures.py fails without model" \
  "${PYTHON_BIN}" "${WORKSPACE_DIR}/parity/scripts/generate_python_parity_fixtures.py" \
    --model /tmp/missing-haotika.onnx \
    --input "${WORKSPACE_DIR}/parity/input" \
    --out /tmp/missing-haotika-parity

rm -f /tmp/wakeword-env-guard.out /tmp/wakeword-env-guard.err
echo "wake-word training environment guard tests passed."
