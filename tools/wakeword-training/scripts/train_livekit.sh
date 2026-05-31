#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE_DIR}/../.." && pwd)"
VERSION="${1:-haotika-livekit-0.1.0}"
CONFIG_PATH="${2:-${WORKSPACE_DIR}/configs/haotika.livekit.yaml}"
OUTPUT_DIR="${WORKSPACE_DIR}/output/${VERSION}"
LIVEKIT_OUTPUT_DIR="${OUTPUT_DIR}/_livekit"
VENV_DIR="${WORKSPACE_DIR}/.wakeword-venv"
PYTHON_BIN="${PYTHON_BIN:-${VENV_DIR}/bin/python}"

fail() {
  echo "LiveKit training cannot start: $*" >&2
  echo "" >&2
  echo "Prepare the isolated training environment first:" >&2
  echo "  cd tools/wakeword-training" >&2
  echo "  ./scripts/setup_env.sh" >&2
  exit 1
}

if [ "${VERSION}" != "haotika-livekit-0.1.0" ]; then
  echo "This config is pinned to haotika-livekit-0.1.0. Add a new config before training ${VERSION}." >&2
  exit 1
fi

if [ ! -x "${PYTHON_BIN}" ]; then
  fail "Python venv is missing: ${PYTHON_BIN}"
fi

if ! "${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1
import sys

raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
then
  fail "$("${PYTHON_BIN}" --version 2>&1 || echo "${PYTHON_BIN}") is not Python 3.11+"
fi

if ! command -v uv >/dev/null 2>&1; then
  fail "uv was not found. Install it with: brew install uv"
fi

if [ -z "${LIVEKIT_WAKEWORD_BIN:-}" ]; then
  if [ -x "${VENV_DIR}/bin/livekit-wakeword" ]; then
    LIVEKIT_WAKEWORD_BIN="${VENV_DIR}/bin/livekit-wakeword"
  else
    LIVEKIT_WAKEWORD_BIN="$(command -v livekit-wakeword || true)"
  fi
fi

if [ -z "${LIVEKIT_WAKEWORD_BIN}" ] || [ ! -x "${LIVEKIT_WAKEWORD_BIN}" ]; then
  fail "LiveKit Wakeword CLI was not found in ${VENV_DIR}. Run ./scripts/setup_env.sh"
fi

"${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1 || fail "livekit-wakeword Python package is not importable. Run ./scripts/setup_env.sh"
import livekit.wakeword
import onnxruntime
PY

if [ ! -f "${CONFIG_PATH}" ]; then
  fail "Config is missing: ${CONFIG_PATH}"
fi

mkdir -p "${OUTPUT_DIR}"
cd "${WORKSPACE_DIR}"

echo "Preparing LiveKit Wakeword data for ${VERSION}"
if [ "${LIVEKIT_WAKEWORD_SKIP_SETUP:-0}" != "1" ]; then
  "${LIVEKIT_WAKEWORD_BIN}" setup --config "${CONFIG_PATH}"
fi

echo "Running LiveKit Wakeword pipeline for ${VERSION}"
"${LIVEKIT_WAKEWORD_BIN}" run "${CONFIG_PATH}"

EXPECTED_MODEL_PATH="${LIVEKIT_OUTPUT_DIR}/haotika/haotika.onnx"
if [ ! -f "${EXPECTED_MODEL_PATH}" ]; then
  EXPECTED_MODEL_PATH="$(find "${LIVEKIT_OUTPUT_DIR}" -name 'haotika.onnx' -type f | head -n 1)"
fi

if [ -z "${EXPECTED_MODEL_PATH}" ] || [ ! -f "${EXPECTED_MODEL_PATH}" ]; then
  echo "Training finished, but haotika.onnx was not found under ${LIVEKIT_OUTPUT_DIR}." >&2
  exit 1
fi

cp "${EXPECTED_MODEL_PATH}" "${OUTPUT_DIR}/haotika.onnx"
"${SCRIPT_DIR}/export_model.sh" "${VERSION}" 0.65

cat > "${OUTPUT_DIR}/notes.md" <<'EOF'
# haotika-livekit-0.1.0

Initial LiveKit Wakeword candidate.

Manual notes to fill before approval:

- training config version:
- known false accepts:
- known false rejects:
- threshold rationale:
- Android IO contract status:
EOF

echo "Training artifact prepared at ${OUTPUT_DIR}/haotika.onnx"
echo "Run evaluation before approval."
