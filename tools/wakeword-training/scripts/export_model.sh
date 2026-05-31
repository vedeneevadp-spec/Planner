#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE_DIR}/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${REPO_ROOT}/.wakeword-venv/bin/python}"
VERSION="${1:-}"
THRESHOLD="${2:-0.65}"

if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="python3"
fi

if [ -z "${VERSION}" ]; then
  echo "Usage: $0 haotika-livekit-0.1.0 [threshold]" >&2
  exit 1
fi

VERSION_DIR="${WORKSPACE_DIR}/output/${VERSION}"
MODEL_PATH="${VERSION_DIR}/haotika.onnx"
MANIFEST_PATH="${VERSION_DIR}/haotika_manifest.json"

if [ ! -f "${MODEL_PATH}" ]; then
  echo "Missing model: ${MODEL_PATH}" >&2
  exit 1
fi

"${PYTHON_BIN}" - "${VERSION}" "${THRESHOLD}" "${MODEL_PATH}" "${MANIFEST_PATH}" <<'PY'
import json
import math
import sys
from pathlib import Path

version = sys.argv[1]
threshold = float(sys.argv[2])
model_path = Path(sys.argv[3])
manifest_path = Path(sys.argv[4])

if version in {"", "unknown", "pending", "pending-trained-model"} or version.startswith("pending"):
    raise SystemExit("modelVersion must be a concrete version")

if not math.isfinite(threshold) or threshold < 0 or threshold > 1:
    raise SystemExit("threshold must be a finite number between 0 and 1")

manifest = {
    "phraseId": "haotika",
    "displayPhrase": "Хаотика",
    "language": "ru-RU",
    "modelVersion": version,
    "provider": "CUSTOM_ONNX",
    "modelPath": "wakewords/haotika.onnx",
    "inputKind": "embedding_matrix",
    "frontend": "livekit_openwakeword",
    "ioContractConfirmedForAndroid": False,
    "models": {
        "melspectrogram": "wakewords/livekit/melspectrogram.onnx",
        "embedding": "wakewords/livekit/embedding_model.onnx",
        "classifier": "wakewords/haotika.onnx",
    },
    "frontendConfig": {
        "embeddingWindowSize": 16,
        "embeddingSize": 96,
    },
    "threshold": threshold,
    "sampleRate": 16000,
    "vadEnabled": True,
    "runtime": {
        "frameMs": 80,
        "windowMs": 2000,
        "scoreSmoothing": True,
    },
    "training": {
        "tool": "livekit-wakeword",
        "config": "tools/wakeword-training/configs/haotika.livekit.yaml",
    },
    "artifactBytes": model_path.stat().st_size,
}

manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "Export is ready:"
echo "  ${MODEL_PATH}"
echo "  ${MANIFEST_PATH}"
echo "Run copy_to_android_assets.sh only after manual approval."
