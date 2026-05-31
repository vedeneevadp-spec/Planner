#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

PINNED_LIVEKIT_WAKEWORD_COMMIT = "1ec7f680df30ff4ca0ebae6b5983441e94b10980"
PARITY_SCORE_TOLERANCE = 0.03
PARITY_WINDOW_SECONDS = 2
SAMPLE_RATE = 16000


@dataclass(frozen=True)
class FrontendPaths:
    mel: Path
    embedding: Path
    source: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Python LiveKit wake-word parity fixtures.")
    parser.add_argument("--model", required=True, type=Path, help="Path to haotika.onnx classifier.")
    parser.add_argument("--input", required=True, type=Path, help="Directory with 16 kHz mono PCM16 WAV files.")
    parser.add_argument("--out", required=True, type=Path, help="Directory for expected .npy/.json fixtures.")
    parser.add_argument(
        "--frontend-dir",
        type=Path,
        default=None,
        help="Directory containing melspectrogram.onnx and embedding_model.onnx copied from the installed LiveKit package.",
    )
    parser.add_argument("--model-version", default=None, help="Model version to record in expected metadata.")
    parser.add_argument(
        "--livekit-commit",
        default=PINNED_LIVEKIT_WAKEWORD_COMMIT,
        help="Pinned livekit-wakeword commit used to generate parity fixtures.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def onnx_tensor_metadata(value: object) -> dict[str, object]:
    return {
        "name": value.name,
        "type": value.type,
        "shape": list(value.shape),
    }


def inspect_onnx_io(path: Path) -> dict[str, object]:
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return {
        "inputs": [onnx_tensor_metadata(value) for value in session.get_inputs()],
        "outputs": [onnx_tensor_metadata(value) for value in session.get_outputs()],
    }


def model_metadata(path: Path, role: str) -> dict[str, object]:
    if not path.exists():
        raise SystemExit(f"Missing ONNX artifact: {path}")

    return {
        "role": role,
        "fileName": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "io": inspect_onnx_io(path),
    }


def package_frontend_paths() -> FrontendPaths:
    from livekit.wakeword.resources import get_embedding_model_path, get_mel_model_path

    return FrontendPaths(
        mel=get_mel_model_path(),
        embedding=get_embedding_model_path(),
        source="installed_livekit_wakeword_package",
    )


def resolve_frontend_paths(frontend_dir: Path | None) -> FrontendPaths:
    if frontend_dir is None:
        paths = package_frontend_paths()
        require_frontend_files(paths)
        return paths

    paths = FrontendPaths(
        mel=frontend_dir / "melspectrogram.onnx",
        embedding=frontend_dir / "embedding_model.onnx",
        source=str(frontend_dir),
    )
    require_frontend_files(paths)
    verify_frontend_matches_installed_package(paths)
    return paths


def require_frontend_files(paths: FrontendPaths) -> None:
    if not paths.mel.exists():
        raise SystemExit(f"Missing frontend model: {paths.mel}")
    if not paths.embedding.exists():
        raise SystemExit(f"Missing frontend model: {paths.embedding}")


def verify_frontend_matches_installed_package(paths: FrontendPaths) -> None:
    package_paths = package_frontend_paths()
    if sha256_file(paths.mel) != sha256_file(package_paths.mel):
        raise SystemExit(
            "melspectrogram.onnx hash does not match the installed livekit-wakeword package. "
            "Python WakeWordModel would score with a different frontend."
        )
    if sha256_file(paths.embedding) != sha256_file(package_paths.embedding):
        raise SystemExit(
            "embedding_model.onnx hash does not match the installed livekit-wakeword package. "
            "Python WakeWordModel would score with a different frontend."
        )


def frontend_resource_metadata(paths: FrontendPaths) -> dict[str, object]:
    return {
        "source": paths.source,
        "melspectrogram": model_metadata(paths.mel, "livekit_melspectrogram_frontend"),
        "embedding": model_metadata(paths.embedding, "livekit_speech_embedding_frontend"),
    }


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000:
            raise ValueError(f"{path} must be 16 kHz mono PCM16 WAV")
        frames = wav.readframes(wav.getnframes())

    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def normalize_parity_window(audio: np.ndarray) -> np.ndarray:
    window_samples = SAMPLE_RATE * PARITY_WINDOW_SECONDS
    audio = audio.flatten().astype(np.float32)
    if audio.shape[0] >= window_samples:
        return audio[-window_samples:]

    return np.pad(audio, (window_samples - audio.shape[0], 0), mode="constant")


def extract_livekit_embeddings(audio: np.ndarray, frontend_paths: FrontendPaths) -> np.ndarray:
    from livekit.wakeword.inference.model import EMBEDDING_STRIDE, EMBEDDING_WINDOW, MIN_EMBEDDINGS
    from livekit.wakeword.models.feature_extractor import MelSpectrogramFrontend, SpeechEmbedding

    mel_frontend = MelSpectrogramFrontend(onnx_path=frontend_paths.mel)
    speech_embedding = SpeechEmbedding(onnx_path=frontend_paths.embedding)
    mel = mel_frontend(audio)
    if mel.ndim == 3:
        mel = mel[0]

    embeddings = []
    for start in range(0, mel.shape[0] - EMBEDDING_WINDOW + 1, EMBEDDING_STRIDE):
        window = mel[start : start + EMBEDDING_WINDOW]
        embeddings.append(speech_embedding(window[np.newaxis, :, :])[0])

    if len(embeddings) < MIN_EMBEDDINGS:
        return np.zeros((0, 96), dtype=np.float32)

    return np.stack(embeddings[-MIN_EMBEDDINGS:], axis=0).astype(np.float32)


def main() -> None:
    args = parse_args()
    if not args.model.exists():
        raise SystemExit(f"Missing classifier model: {args.model}")

    try:
        from livekit.wakeword import WakeWordModel
    except ImportError as error:
        raise SystemExit("Install livekit-wakeword before generating parity fixtures.") from error

    args.out.mkdir(parents=True, exist_ok=True)
    wav_paths = sorted(args.input.glob("*.wav"))
    if not wav_paths:
        raise SystemExit(
            f"No parity WAV fixtures found in {args.input}. Add positive, hard-negative, and silence/noise 16 kHz mono PCM16 WAV files."
        )

    frontend_paths = resolve_frontend_paths(args.frontend_dir)
    model = WakeWordModel(models=[args.model])
    frontend_metadata = frontend_resource_metadata(frontend_paths)
    classifier_metadata = model_metadata(args.model, "haotika_wake_word_classifier")
    model_version = args.model_version or args.model.parent.name

    parity_metadata = {
        "livekitWakewordCommit": args.livekit_commit,
        "modelVersion": model_version,
        "classifier": classifier_metadata,
        "frontendResources": frontend_metadata,
        "rollingWindowSemantics": {
            "melWindowFrames": 76,
            "melStrideFrames": 8,
            "classifierEmbeddingWindow": 16,
            "classifierInputOrder": "chronological_oldest_to_newest_latest_16",
        },
        "tolerance": {
            "scoreTolerance": PARITY_SCORE_TOLERANCE,
            "shapeExactMatchRequired": True,
            "dtypeExactMatchRequired": True,
            "axisOrderExactMatchRequired": True,
        },
        "audioWindow": {
            "sampleRate": SAMPLE_RATE,
            "windowSeconds": PARITY_WINDOW_SECONDS,
            "windowSamples": SAMPLE_RATE * PARITY_WINDOW_SECONDS,
            "normalization": "If a WAV is longer than 2 seconds, use the latest 2 seconds; if shorter, left-pad with zeros.",
        },
        "safeDataPolicy": "Do not commit real audio, raw embeddings, score fixtures, or full buffers without an explicit data decision.",
    }
    (args.out / "livekit_frontend_metadata.json").write_text(
        json.dumps(parity_metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    for wav_path in wav_paths:
        audio = normalize_parity_window(read_wav(wav_path))
        embeddings = extract_livekit_embeddings(audio, frontend_paths)
        scores = model.predict(audio.astype(np.float32))
        score = float(scores.get(args.model.stem, max(scores.values()) if scores else 0.0))

        np.save(args.out / f"{wav_path.stem}_embeddings.npy", embeddings)
        (args.out / f"{wav_path.stem}_score.json").write_text(
            json.dumps(
                {
                    "sample": wav_path.name,
                    "model": args.model.name,
                    "modelVersion": model_version,
                    "livekitWakewordCommit": args.livekit_commit,
                    "score": score,
                    "embeddingShape": list(embeddings.shape),
                    "audioWindowSamples": int(audio.shape[0]),
                    "classifierIo": classifier_metadata["io"],
                    "frontendIo": {
                        "melspectrogram": frontend_metadata["melspectrogram"]["io"],
                        "embedding": frontend_metadata["embedding"]["io"],
                    },
                    "frontendHashes": {
                        "melspectrogram": frontend_metadata["melspectrogram"]["sha256"],
                        "embedding": frontend_metadata["embedding"]["sha256"],
                    },
                    "rollingWindowSemantics": parity_metadata["rollingWindowSemantics"],
                    "tolerance": parity_metadata["tolerance"],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
