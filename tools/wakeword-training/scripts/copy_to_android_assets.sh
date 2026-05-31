#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE_DIR}/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${REPO_ROOT}/.wakeword-venv/bin/python}"
VERSION="${1:-}"
APPROVAL="${2:-}"

if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="python3"
fi

if [ -z "${VERSION}" ]; then
  echo "Usage: $0 haotika-livekit-0.1.0 [--yes]" >&2
  exit 1
fi

VERSION_DIR="${WORKSPACE_DIR}/output/${VERSION}"
MODEL_PATH="${VERSION_DIR}/haotika.onnx"
MANIFEST_PATH="${VERSION_DIR}/haotika_manifest.json"
EVALUATION_JSON_PATH="${VERSION_DIR}/evaluation_report.json"
EVALUATION_MD_PATH="${VERSION_DIR}/evaluation_report.md"
APPROVAL_JSON_PATH="${VERSION_DIR}/approval.json"
FRONTEND_DIR="${WORKSPACE_DIR}/output/frontend"
FRONTEND_MEL_PATH="${FRONTEND_DIR}/melspectrogram.onnx"
FRONTEND_EMBEDDING_PATH="${FRONTEND_DIR}/embedding_model.onnx"
ASSET_DIR="${REPO_ROOT}/android/app/src/main/assets/wakewords"
LIVEKIT_ASSET_DIR="${ASSET_DIR}/livekit"

if [ ! -f "${MODEL_PATH}" ]; then
  echo "Missing model: ${MODEL_PATH}" >&2
  exit 1
fi

if [ ! -f "${MANIFEST_PATH}" ]; then
  echo "Missing manifest: ${MANIFEST_PATH}" >&2
  exit 1
fi

if [ ! -f "${EVALUATION_JSON_PATH}" ]; then
  echo "Missing evaluation report: ${EVALUATION_JSON_PATH}" >&2
  exit 1
fi

if [ ! -f "${EVALUATION_MD_PATH}" ]; then
  echo "Missing evaluation report: ${EVALUATION_MD_PATH}" >&2
  exit 1
fi

if [ ! -f "${APPROVAL_JSON_PATH}" ]; then
  echo "Missing approval: ${APPROVAL_JSON_PATH}" >&2
  exit 1
fi

"${PYTHON_BIN}" - "${VERSION}" "${MANIFEST_PATH}" "${EVALUATION_JSON_PATH}" "${APPROVAL_JSON_PATH}" "${FRONTEND_MEL_PATH}" "${FRONTEND_EMBEDDING_PATH}" <<'PY'
import hashlib
import json
import math
import sys
from pathlib import Path

version = sys.argv[1]
manifest_path = Path(sys.argv[2])
report_path = Path(sys.argv[3])
approval_path = Path(sys.argv[4])
frontend_mel_path = Path(sys.argv[5])
frontend_embedding_path = Path(sys.argv[6])

manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
report = json.loads(report_path.read_text(encoding="utf-8"))
approval = json.loads(approval_path.read_text(encoding="utf-8"))
errors = []
expected_livekit_commit = "1ec7f680df30ff4ca0ebae6b5983441e94b10980"

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

manifest_version = str(manifest.get("modelVersion", "")).strip()
report_version = str(report.get("modelVersion", "")).strip()
approval_version = str(approval.get("modelVersion", "")).strip()
input_kind = str(manifest.get("inputKind", "raw_pcm")).strip()
frontend = str(manifest.get("frontend", "none")).strip()
models = manifest.get("models") if isinstance(manifest.get("models"), dict) else {}
threshold = manifest.get("threshold")
approval_threshold = approval.get("threshold")

if manifest_version != version:
    errors.append(f"manifest modelVersion must be {version}, got {manifest_version!r}")

if report_version != version:
    errors.append(f"evaluation report modelVersion must be {version}, got {report_version!r}")

if approval_version != version:
    errors.append(f"approval modelVersion must be {version}, got {approval_version!r}")

if manifest_version in {"", "unknown", "pending", "pending-trained-model"} or manifest_version.startswith("pending"):
    errors.append("manifest modelVersion must be a concrete approved version")

if manifest.get("provider") != "CUSTOM_ONNX":
    errors.append("manifest provider must be CUSTOM_ONNX")

if manifest.get("modelPath") != "wakewords/haotika.onnx":
    errors.append("manifest modelPath must be wakewords/haotika.onnx")

if input_kind not in {"raw_pcm", "embedding_matrix"}:
    errors.append("manifest inputKind must be raw_pcm or embedding_matrix")

if frontend not in {"none", "livekit_openwakeword"}:
    errors.append("manifest frontend must be none or livekit_openwakeword")

if input_kind == "raw_pcm" and frontend != "none":
    errors.append("raw_pcm models must declare frontend none")

if input_kind == "embedding_matrix" and frontend != "livekit_openwakeword":
    errors.append("embedding_matrix models must declare frontend livekit_openwakeword")

if input_kind == "embedding_matrix" and manifest.get("ioContractConfirmedForAndroid") is not True:
    errors.append("manifest ioContractConfirmedForAndroid must be true before copying embedding_matrix models")

if input_kind == "embedding_matrix":
    if models.get("melspectrogram") != "wakewords/livekit/melspectrogram.onnx":
        errors.append("manifest models.melspectrogram must be wakewords/livekit/melspectrogram.onnx")
    if models.get("embedding") != "wakewords/livekit/embedding_model.onnx":
        errors.append("manifest models.embedding must be wakewords/livekit/embedding_model.onnx")
    if models.get("classifier") != "wakewords/haotika.onnx":
        errors.append("manifest models.classifier must be wakewords/haotika.onnx")

if manifest.get("sampleRate") != 16000:
    errors.append("manifest sampleRate must be 16000")

if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or threshold < 0 or threshold > 1:
    errors.append("manifest threshold must be a finite number between 0 and 1")

if not isinstance(report.get("modelIoContract"), dict):
    errors.append("evaluation_report.json must contain modelIoContract")
else:
    model_io = report["modelIoContract"]
    if input_kind == "embedding_matrix":
        if model_io.get("livekitWakewordCommit") != expected_livekit_commit:
            errors.append(f"modelIoContract livekitWakewordCommit must be {expected_livekit_commit}")

        if model_io.get("onnxInputName") != "embeddings":
            errors.append("modelIoContract onnxInputName must be embeddings")

        if model_io.get("onnxOutputName") != "score":
            errors.append("modelIoContract onnxOutputName must be score")

        if model_io.get("embeddingOrder") != "latest 16 embeddings, chronological oldest-to-newest":
            errors.append("modelIoContract must confirm latest-16 chronological embedding order")

        frontend_resources = model_io.get("frontendResources")
        if not isinstance(frontend_resources, dict):
            errors.append("modelIoContract must contain frontendResources")
        else:
            for key, path in (
                ("melspectrogram", frontend_mel_path),
                ("embedding", frontend_embedding_path),
            ):
                resource = frontend_resources.get(key)
                if not isinstance(resource, dict):
                    errors.append(f"modelIoContract frontendResources.{key} is required")
                    continue
                expected_hash = resource.get("sha256")
                if not expected_hash:
                    errors.append(f"modelIoContract frontendResources.{key}.sha256 is required")
                if not isinstance(resource.get("io"), dict):
                    errors.append(f"modelIoContract frontendResources.{key}.io is required")
                if not path.is_file():
                    errors.append(f"frontend artifact is missing: {path}")
                elif expected_hash and sha256(path) != expected_hash:
                    errors.append(f"frontend artifact hash mismatch for {path}")

if approval.get("approvedForAndroidClosedRollout") is not True:
    errors.append("approval.json must contain approvedForAndroidClosedRollout: true")

if approval.get("ioContractConfirmedForAndroid") is not True:
    errors.append("approval.json must contain ioContractConfirmedForAndroid: true")

if not isinstance(approval_threshold, (int, float)) or not math.isfinite(approval_threshold):
    errors.append("approval.json threshold must be a finite number")
elif isinstance(threshold, (int, float)) and abs(float(threshold) - float(approval_threshold)) > 0.000001:
    errors.append("manifest threshold must match approval.json threshold")

if errors:
    for error in errors:
        print(f"Refusing to copy wake-word model: {error}", file=sys.stderr)
    sys.exit(1)
PY

if [ "${APPROVAL}" != "--yes" ]; then
  printf "Copy %s into Android assets? Type yes: " "${VERSION}" >&2
  read -r CONFIRMATION
  if [ "${CONFIRMATION}" != "yes" ]; then
    echo "Cancelled." >&2
    exit 1
  fi
fi

mkdir -p "${ASSET_DIR}"
cp "${MODEL_PATH}" "${ASSET_DIR}/haotika.onnx"
cp "${MANIFEST_PATH}" "${ASSET_DIR}/haotika_manifest.json"

if "${PYTHON_BIN}" - "${MANIFEST_PATH}" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if manifest.get("inputKind") == "embedding_matrix" and manifest.get("frontend") == "livekit_openwakeword":
    sys.exit(0)
sys.exit(1)
PY
then
  mkdir -p "${LIVEKIT_ASSET_DIR}"
  cp "${FRONTEND_MEL_PATH}" "${LIVEKIT_ASSET_DIR}/melspectrogram.onnx"
  cp "${FRONTEND_EMBEDDING_PATH}" "${LIVEKIT_ASSET_DIR}/embedding_model.onnx"
fi

echo "Copied approved wake-word assets for ${VERSION}."
