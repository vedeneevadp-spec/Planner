#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import wave
from dataclasses import dataclass
from pathlib import Path
from statistics import mean

PINNED_LIVEKIT_WAKEWORD_COMMIT = "1ec7f680df30ff4ca0ebae6b5983441e94b10980"


@dataclass(frozen=True)
class SampleScore:
    path: str
    score: float
    duration_ms: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a Haotika ONNX wake-word model.")
    parser.add_argument("--version", required=True, help="Model version, e.g. haotika-livekit-0.1.0.")
    parser.add_argument("--model", required=True, type=Path, help="Path to haotika.onnx.")
    parser.add_argument(
        "--positive",
        "--positive-dir",
        dest="positive_dir",
        required=True,
        type=Path,
        help="Directory with positive WAV files.",
    )
    parser.add_argument(
        "--negative",
        "--negative-dir",
        dest="negative_dir",
        required=True,
        type=Path,
        help="Directory with negative WAV files.",
    )
    parser.add_argument("--threshold", type=float, default=None, help="Detection threshold from manifest.")
    parser.add_argument("--out", "--output-dir", dest="output_dir", type=Path, default=None, help="Directory for evaluation reports.")
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument(
        "--livekit-commit",
        default=PINNED_LIVEKIT_WAKEWORD_COMMIT,
        help="Pinned livekit-wakeword commit used for evaluation.",
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
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return {
        "inputs": [tensor_metadata(value) for value in session.get_inputs()],
        "outputs": [tensor_metadata(value) for value in session.get_outputs()],
    }


def model_metadata(path: Path, role: str) -> dict[str, object]:
    return {
        "role": role,
        "fileName": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "io": inspect_onnx_io(path),
    }


def frontend_resource_metadata() -> dict[str, object] | None:
    try:
        from livekit.wakeword.resources import get_embedding_model_path, get_mel_model_path
    except ImportError:
        return None

    return {
        "melspectrogram": model_metadata(get_mel_model_path(), "livekit_melspectrogram_frontend"),
        "embedding": model_metadata(get_embedding_model_path(), "livekit_speech_embedding_frontend"),
    }


def read_wav(path: Path, sample_rate: int) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        frames = wav.getnframes()
        if channels != 1 or width != 2 or rate != sample_rate:
            raise ValueError(f"{path} must be mono PCM16 {sample_rate}Hz")

        raw = wav.readframes(frames)

    samples = []
    for offset in range(0, len(raw), 2):
        value = int.from_bytes(raw[offset : offset + 2], byteorder="little", signed=True)
        samples.append(max(-1.0, min(1.0, value / 32768.0)))

    duration_ms = round((len(samples) * 1000) / sample_rate)
    return samples, duration_ms


def collect_wavs(directory: Path) -> list[Path]:
    if not directory.exists():
        return []

    return sorted(path for path in directory.rglob("*.wav") if path.is_file())


def read_model_io_contract(model_path: Path, sample_rate: int, livekit_commit: str) -> dict[str, object]:
    try:
        classifier_metadata = model_metadata(model_path, "haotika_wake_word_classifier")
        frontend_metadata = frontend_resource_metadata()
    except ImportError:
        return {
            "runtime": "livekit.wakeword.WakeWordModel",
            "livekitWakewordCommit": livekit_commit,
            "classifierInputKind": "embedding_matrix",
            "frontend": "livekit_openwakeword",
            "input": "Unable to inspect ONNX directly because onnxruntime is not installed.",
            "sampleRate": sample_rate,
            "audioInput": "16kHz mono int16/float32 passed to LiveKit WakeWordModel.",
            "embeddingShape": [1, 16, 96],
            "blockingAndroidItem": "Android must implement LiveKit/openWakeWord preprocessing before using classifier ONNX directly.",
        }

    classifier_inputs = classifier_metadata["io"]["inputs"]
    classifier_outputs = classifier_metadata["io"]["outputs"]
    input_info = classifier_inputs[0] if classifier_inputs else {}
    output_info = classifier_outputs[0] if classifier_outputs else {}

    return {
        "runtime": "livekit.wakeword.WakeWordModel for evaluation",
        "livekitWakewordCommit": livekit_commit,
        "classifierInputKind": "embedding_matrix",
        "frontend": "livekit_openwakeword",
        "classifier": classifier_metadata,
        "frontendResources": frontend_metadata,
        "onnxInputName": input_info.get("name"),
        "onnxInputShape": input_info.get("shape"),
        "onnxInputDtype": input_info.get("type"),
        "onnxOutputName": output_info.get("name"),
        "onnxOutputShape": output_info.get("shape"),
        "onnxOutputDtype": output_info.get("type"),
        "sampleRate": sample_rate,
        "audioInput": "16kHz mono int16/float32 passed to LiveKit WakeWordModel.",
        "embeddingShape": [1, 16, 96],
        "embeddingOrder": "latest 16 embeddings, chronological oldest-to-newest",
        "axisOrder": {
            "melOutput": "batch,time,32 after optional channel squeeze",
            "embeddingInput": "batch,76,32,1 channels-last",
            "classifierInput": "batch,16,96",
        },
        "scoreInterpretation": "WakeWordModel returns a 0-1 score for the loaded classifier.",
        "thresholdSemantics": "WakeWordDetected when score >= manifest.threshold.",
        "blockingAndroidItem": "Android approval requires parity against the same frontend model hashes and rolling order.",
    }


def normalize_window(samples: list[float], sample_rate: int) -> list[float]:
    window_samples = sample_rate * 2
    if len(samples) >= window_samples:
        return samples[-window_samples:]

    return [0.0] * (window_samples - len(samples)) + samples


def run_score(model: object, model_name: str, samples: list[float], sample_rate: int) -> float:
    import numpy as np

    audio_window = np.array(normalize_window(samples, sample_rate), dtype=np.float32)
    scores = model.predict(audio_window)
    if model_name in scores:
        return float(scores[model_name])

    if not scores:
        raise ValueError("LiveKit WakeWordModel returned no scores")

    return float(max(scores.values()))


def score_directory(model: object, model_name: str, directory: Path, sample_rate: int) -> list[SampleScore]:
    scores = []
    for path in collect_wavs(directory):
        samples, duration_ms = read_wav(path, sample_rate)
        scores.append(SampleScore(path=str(path), score=run_score(model, model_name, samples, sample_rate), duration_ms=duration_ms))

    return scores


def false_positives_per_hour(false_accepts: int, negative_scores: list[SampleScore]) -> float:
    duration_hours = sum(score.duration_ms for score in negative_scores) / 3_600_000
    if duration_hours <= 0:
        return 0.0
    return false_accepts / duration_hours


def recommend_threshold(positive_scores: list[SampleScore], negative_scores: list[SampleScore]) -> float:
    if not positive_scores:
        return 0.65

    candidates = [round(value / 100, 2) for value in range(30, 100)]
    best = 0.65
    best_key = (-1.0, -math.inf)

    for threshold in candidates:
        recall = sum(1 for score in positive_scores if score.score >= threshold) / len(positive_scores)
        false_accepts = sum(1 for score in negative_scores if score.score >= threshold)
        fp_per_hour = false_positives_per_hour(false_accepts, negative_scores)
        key = (recall, -fp_per_hour)

        if fp_per_hour <= 1.0 and key > best_key:
            best = threshold
            best_key = key

    return best


def build_report(
    version: str,
    threshold: float,
    positive_scores: list[SampleScore],
    negative_scores: list[SampleScore],
    model_io_contract: dict[str, object],
) -> dict[str, object]:
    true_accepts = sum(1 for score in positive_scores if score.score >= threshold)
    false_rejects = len(positive_scores) - true_accepts
    false_accepts = sum(1 for score in negative_scores if score.score >= threshold)

    return {
        "modelVersion": version,
        "approvedForAndroidClosedRollout": False,
        "modelIoContract": model_io_contract,
        "threshold": threshold,
        "recommendedThreshold": recommend_threshold(positive_scores, negative_scores),
        "recommended_threshold": recommend_threshold(positive_scores, negative_scores),
        "positiveCount": len(positive_scores),
        "positive_count": len(positive_scores),
        "negativeCount": len(negative_scores),
        "negative_count": len(negative_scores),
        "detected_positive_count": true_accepts,
        "missed_positive_count": false_rejects,
        "recall": true_accepts / len(positive_scores) if positive_scores else 0.0,
        "falseAcceptCount": false_accepts,
        "false_accept_count": false_accepts,
        "falseRejectCount": false_rejects,
        "false_reject_count": false_rejects,
        "false_accept_rate": false_accepts / len(negative_scores) if negative_scores else 0.0,
        "falsePositivesPerHour": false_positives_per_hour(false_accepts, negative_scores),
        "averagePositiveScore": mean(score.score for score in positive_scores) if positive_scores else 0.0,
        "averageNegativeScore": mean(score.score for score in negative_scores) if negative_scores else 0.0,
        "positiveScores": [score.__dict__ for score in positive_scores],
        "negativeScores": [score.__dict__ for score in negative_scores],
    }


def write_markdown(path: Path, report: dict[str, object]) -> None:
    path.write_text(
        "\n".join(
            [
                f"# Evaluation {report['modelVersion']}",
                "",
                f"- approvedForAndroidClosedRollout: {str(report['approvedForAndroidClosedRollout']).lower()}",
                f"- threshold: {report['threshold']}",
                f"- recommendedThreshold: {report['recommendedThreshold']}",
                f"- positiveCount: {report['positiveCount']}",
                f"- negativeCount: {report['negativeCount']}",
                f"- recall: {report['recall']:.4f}",
                f"- falseAcceptCount: {report['falseAcceptCount']}",
                f"- falseRejectCount: {report['falseRejectCount']}",
                f"- falsePositivesPerHour: {report['falsePositivesPerHour']:.4f}",
                f"- averagePositiveScore: {report['averagePositiveScore']:.4f}",
                f"- averageNegativeScore: {report['averageNegativeScore']:.4f}",
                "",
            ]
        ),
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    if not args.model.exists():
        raise SystemExit(f"Model is missing: {args.model}")

    try:
        from livekit.wakeword import WakeWordModel
    except ImportError as error:
        raise SystemExit(
            "livekit-wakeword is required for real evaluation. Install it with: "
            "pip install 'livekit-wakeword[eval,export]'"
        ) from error

    output_dir = args.output_dir or args.model.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    threshold = args.threshold
    if threshold is None:
        manifest_path = args.model.with_name("haotika_manifest.json")
        if not manifest_path.exists():
            raise SystemExit("--threshold is required when haotika_manifest.json is absent")
        threshold = json.loads(manifest_path.read_text(encoding="utf-8"))["threshold"]

    model_name = args.model.stem
    model = WakeWordModel(models=[str(args.model)])
    positive_scores = score_directory(model, model_name, args.positive_dir, args.sample_rate)
    negative_scores = score_directory(model, model_name, args.negative_dir, args.sample_rate)
    if not positive_scores:
        raise SystemExit(f"Evaluation requires positive WAV samples in: {args.positive_dir}")

    if not negative_scores:
        raise SystemExit(f"Evaluation requires negative WAV samples in: {args.negative_dir}")

    report = build_report(
        args.version,
        threshold,
        positive_scores,
        negative_scores,
        read_model_io_contract(args.model, args.sample_rate, args.livekit_commit),
    )

    (output_dir / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "evaluation_report.md", report)


if __name__ == "__main__":
    main()
