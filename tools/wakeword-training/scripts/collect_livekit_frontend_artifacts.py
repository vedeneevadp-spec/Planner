#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

PINNED_LIVEKIT_WAKEWORD_COMMIT = "1ec7f680df30ff4ca0ebae6b5983441e94b10980"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Locate LiveKit/openWakeWord frontend ONNX artifacts.")
    parser.add_argument(
        "--out",
        default=Path("output/frontend"),
        type=Path,
        help="Output directory for optional local copy and metadata, relative to tools/wakeword-training.",
    )
    parser.add_argument("--copy", action="store_true", help="Copy frontend ONNX artifacts into --out.")
    parser.add_argument(
        "--license-confirmed",
        action="store_true",
        help="Required with --copy. Confirms the license/notice decision was reviewed manually.",
    )
    parser.add_argument(
        "--livekit-commit",
        default=PINNED_LIVEKIT_WAKEWORD_COMMIT,
        help="Pinned livekit-wakeword commit expected by the Android parity gate.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_metadata(value: object) -> dict[str, object]:
    return {
        "name": value.name,
        "type": value.type,
        "shape": list(value.shape),
    }


def inspect_onnx_io(path: Path) -> dict[str, object]:
    try:
        import onnxruntime as ort
    except ImportError as error:
        raise SystemExit("onnxruntime is required. Run ./scripts/setup_env.sh first.") from error

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return {
        "inputs": [tensor_metadata(value) for value in session.get_inputs()],
        "outputs": [tensor_metadata(value) for value in session.get_outputs()],
    }


def artifact_metadata(path: Path, role: str) -> dict[str, object]:
    if not path.exists():
        raise SystemExit(f"Missing LiveKit frontend artifact: {path}")

    return {
        "role": role,
        "sourcePath": str(path),
        "fileName": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "io": inspect_onnx_io(path),
    }


def livekit_resource_paths() -> tuple[Path, Path]:
    try:
        from livekit.wakeword.resources import get_embedding_model_path, get_mel_model_path
    except ImportError as error:
        raise SystemExit("livekit-wakeword is required. Run ./scripts/setup_env.sh first.") from error

    return get_mel_model_path(), get_embedding_model_path()


def main() -> None:
    args = parse_args()
    workspace_dir = Path(__file__).resolve().parents[1]
    output_dir = args.out if args.out.is_absolute() else workspace_dir / args.out

    if args.copy and not args.license_confirmed:
        raise SystemExit(
            "Refusing to copy frontend ONNX artifacts without --license-confirmed. "
            "Review LiveKit/openWakeWord license/notice requirements first."
        )

    mel_path, embedding_path = livekit_resource_paths()
    metadata = {
        "livekitWakewordCommit": args.livekit_commit,
        "licenseObservedAtPinnedCommit": "Apache-2.0",
        "copyRequiresManualLicenseNoticeDecision": True,
        "artifacts": {
            "melspectrogram": artifact_metadata(mel_path, "livekit_melspectrogram_frontend"),
            "embedding": artifact_metadata(embedding_path, "livekit_speech_embedding_frontend"),
        },
    }

    print(json.dumps(metadata, ensure_ascii=False, indent=2))

    if not args.copy:
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(mel_path, output_dir / "melspectrogram.onnx")
    shutil.copy2(embedding_path, output_dir / "embedding_model.onnx")
    (output_dir / "livekit_frontend_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Copied frontend artifacts into {output_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
