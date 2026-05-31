#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION="haotika-livekit-copy-gate-test"
VERSION_DIR="${WORKSPACE_DIR}/output/${VERSION}"
COPY_SCRIPT="${SCRIPT_DIR}/copy_to_android_assets.sh"
EXPORT_SCRIPT="${SCRIPT_DIR}/export_model.sh"
PYTHON_BIN="${PYTHON_BIN:-${WORKSPACE_DIR}/../../.wakeword-venv/bin/python}"

if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="python3"
fi

cleanup() {
  rm -rf "${VERSION_DIR}"
}

trap cleanup EXIT
cleanup
mkdir -p "${VERSION_DIR}"
printf 'dummy onnx bytes' > "${VERSION_DIR}/haotika.onnx"

"${EXPORT_SCRIPT}" "${VERSION}" 0.65 >/dev/null

if "${COPY_SCRIPT}" "${VERSION}" --yes >/tmp/haotika-copy-test.out 2>/tmp/haotika-copy-test.err; then
  echo "copy_to_android_assets.sh unexpectedly succeeded without evaluation_report.json" >&2
  exit 1
fi

printf '{"modelVersion":"%s","modelIoContract":{}}\n' "${VERSION}" > "${VERSION_DIR}/evaluation_report.json"
printf '# Evaluation\n' > "${VERSION_DIR}/evaluation_report.md"

if "${COPY_SCRIPT}" "${VERSION}" --yes >/tmp/haotika-copy-test.out 2>/tmp/haotika-copy-test.err; then
  echo "copy_to_android_assets.sh unexpectedly succeeded without approval.json" >&2
  exit 1
fi

cat > "${VERSION_DIR}/approval.json" <<JSON
{
  "modelVersion": "${VERSION}",
  "approvedForAndroidClosedRollout": false,
  "ioContractConfirmedForAndroid": true,
  "approvedBy": "test",
  "date": "2026-05-31",
  "threshold": 0.65,
  "notes": "copy gate negative test"
}
JSON

if "${COPY_SCRIPT}" "${VERSION}" --yes >/tmp/haotika-copy-test.out 2>/tmp/haotika-copy-test.err; then
  echo "copy_to_android_assets.sh unexpectedly succeeded with approvedForAndroidClosedRollout=false" >&2
  exit 1
fi

"${PYTHON_BIN}" - "${VERSION_DIR}/haotika_manifest.json" "${VERSION}" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
version = sys.argv[2]

assert manifest["provider"] == "CUSTOM_ONNX"
assert manifest["modelVersion"] == version
assert manifest["modelPath"] == "wakewords/haotika.onnx"
assert manifest["inputKind"] == "embedding_matrix"
assert manifest["frontend"] == "livekit_openwakeword"
assert manifest["ioContractConfirmedForAndroid"] is False
assert manifest["models"]["melspectrogram"] == "wakewords/livekit/melspectrogram.onnx"
assert manifest["models"]["embedding"] == "wakewords/livekit/embedding_model.onnx"
assert manifest["models"]["classifier"] == "wakewords/haotika.onnx"
assert manifest["frontendConfig"]["embeddingWindowSize"] == 16
assert manifest["frontendConfig"]["embeddingSize"] == 96
PY

rm -f /tmp/haotika-copy-test.out /tmp/haotika-copy-test.err
echo "copy_to_android_assets.sh gate tests passed."
