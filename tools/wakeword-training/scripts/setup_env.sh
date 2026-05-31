#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PYTHON_311_BIN="${PYTHON_311_BIN:-3.11}"
VENV_DIR="${WORKSPACE_DIR}/.wakeword-venv"
LIVEKIT_PACKAGE="${LIVEKIT_PACKAGE:-livekit-wakeword[train,eval,export,voxcpm]}"

fail() {
  echo "wake-word training setup failed: $*" >&2
  echo "" >&2
  echo "Expected setup on macOS:" >&2
  echo "  brew install uv" >&2
  echo "  cd tools/wakeword-training" >&2
  echo "  ./scripts/setup_env.sh" >&2
  echo "If Python cannot connect to files.pythonhosted.org from this network, rerun with:" >&2
  echo "  UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple ./scripts/setup_env.sh" >&2
  exit 1
}

if ! command -v uv >/dev/null 2>&1; then
  fail "uv was not found."
fi

if command -v "${PYTHON_311_BIN}" >/dev/null 2>&1; then
  PYTHON_311_PATH="$(command -v "${PYTHON_311_BIN}")"
else
  echo "Python ${PYTHON_311_BIN} was not found as a system command; installing a uv-managed Python."
  uv python install "${PYTHON_311_BIN}"
  PYTHON_311_PATH="$(uv python find "${PYTHON_311_BIN}")"
fi

if ! "${PYTHON_311_PATH}" - <<'PY' >/dev/null 2>&1
import sys

raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
then
  fail "$("${PYTHON_311_PATH}" --version 2>&1 || echo "${PYTHON_311_PATH}") is not Python 3.11+."
fi

cd "${WORKSPACE_DIR}"

echo "Creating isolated wake-word training venv at ${VENV_DIR}"
uv venv --allow-existing --python "${PYTHON_311_PATH}" "${VENV_DIR}"

echo "Installing ${LIVEKIT_PACKAGE}"
UV_HTTP_TIMEOUT="${UV_HTTP_TIMEOUT:-120}" UV_HTTP_RETRIES="${UV_HTTP_RETRIES:-8}" uv pip install \
  --python "${VENV_DIR}/bin/python" \
  "${LIVEKIT_PACKAGE}"

"${VENV_DIR}/bin/python" - <<'PY'
import livekit.wakeword
import onnxruntime
PY

if [ ! -x "${VENV_DIR}/bin/livekit-wakeword" ]; then
  fail "livekit-wakeword CLI was not installed into ${VENV_DIR}/bin."
fi

echo "Wake-word training environment is ready."
echo "Activate with:"
echo "  source tools/wakeword-training/.wakeword-venv/bin/activate"
