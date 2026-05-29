#!/usr/bin/env python3
"""Train an experimental TensorFlow Lite wake-word model for "Хаотика".

This is an offline training utility. It intentionally lives outside the Android
app and uses open Speech Commands samples only as the negative class.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import shutil
import urllib.request
import wave
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import tensorflow as tf
from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2


DEFAULT_POSITIVE_DIR = Path("datasets/wakeword/haotika/android-positive/positive")
DEFAULT_EXTRA_POSITIVE_DIRS = [Path("datasets/wakeword/haotika/real-world/true_accept")]
DEFAULT_FALSE_REJECT_POSITIVE_DIRS = [Path("datasets/wakeword/haotika/real-world/false_reject")]
DEFAULT_NEGATIVE_DIR = Path("datasets/wakeword/haotika/open-negative/mini_speech_commands")
DEFAULT_HARD_NEGATIVE_DIRS = [Path("datasets/wakeword/haotika/real-world/false_accept")]
DEFAULT_OUTPUT_DIR = Path("datasets/wakeword/haotika/training/haotika-experimental-v0")
DEFAULT_ASSET_MODEL_PATH = Path("android/app/src/main/assets/wakewords/haotika.tflite")
DEFAULT_ASSET_MANIFEST_PATH = Path("android/app/src/main/assets/wakewords/haotika_manifest.json")
DEFAULT_EXCLUDED_SAMPLES_CSV = Path("datasets/wakeword/haotika/real-world/excluded_samples.csv")

MINI_SPEECH_COMMANDS_URL = (
    "https://storage.googleapis.com/download.tensorflow.org/data/mini_speech_commands.zip"
)
MINI_SPEECH_COMMANDS_LICENSE = "CC-BY-4.0 via Google Speech Commands"
MODEL_VERSION = "haotika-experimental-v0"

SAMPLE_RATE = 16_000
WINDOW_SECONDS = 2
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_SECONDS
EXPECTED_CHANNELS = 1
EXPECTED_SAMPLE_WIDTH_BYTES = 2
MIN_DURATION_SECONDS = 0.3
MAX_DURATION_SECONDS = 2.0
MIN_PEAK = 0.03
MIN_RMS = 0.006
MAX_CLIPPING_RATIO = 0.001
VOICE_ACTIVITY_THRESHOLD = 500
TRUE_ACCEPT_MAX_LEADING_SILENCE_SECONDS = 1.0
TRUE_ACCEPT_MIN_ACTIVE_SPEECH_SECONDS = 0.45
TRUE_ACCEPT_LOW_CONFIDENCE_THRESHOLD = 0.65
THRESHOLD = 0.61
THRESHOLD_SWEEP_START = 0.50
THRESHOLD_SWEEP_END = 0.99
THRESHOLD_SWEEP_STEP = 0.01
POSITIVE_AUGMENTATIONS_PER_FILE = 8
MAX_NEGATIVE_SAMPLES = 640
HARD_NEGATIVE_TRAIN_REPEATS = 8
RANDOM_SEED = 42


@dataclass(frozen=True)
class Split:
    train: list[Path]
    validation: list[Path]
    test: list[Path]


@dataclass(frozen=True)
class Metrics:
    accuracy: float
    precision: float
    recall: float
    false_accept_rate: float
    false_reject_rate: float
    threshold: float
    tp: int
    tn: int
    fp: int
    fn: int


@dataclass(frozen=True)
class RejectedFile:
    path: Path
    role: str
    reasons: list[str]


@dataclass(frozen=True)
class ExcludedSample:
    path: Path
    reasons: list[str]


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.keras.utils.set_random_seed(args.seed)

    positive_dir = args.positive_dir
    negative_dir = args.negative_dir
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    ensure_negative_dataset(negative_dir)
    excluded_samples = read_excluded_samples(args.excluded_samples_csv)

    base_positive_files = sorted(positive_dir.glob("*.wav"))
    extra_positive_files = collect_wav_files(args.extra_positive_dirs)
    extra_positive_files, rejected_extra_positive_files = filter_training_audio(
        extra_positive_files,
        role="real_world_true_accept",
        excluded_samples=excluded_samples,
    )
    false_reject_positive_files = collect_wav_files(args.false_reject_positive_dirs)
    false_reject_positive_files, rejected_false_reject_positive_files = filter_training_audio(
        false_reject_positive_files,
        role="real_world_false_reject",
        excluded_samples=excluded_samples,
    )
    positive_files = unique_paths([*base_positive_files, *extra_positive_files, *false_reject_positive_files])
    open_negative_files = sorted(negative_dir.glob("*/*.wav"))
    hard_negative_files = collect_wav_files(args.hard_negative_dirs)
    hard_negative_files, rejected_hard_negative_files = filter_training_audio(
        hard_negative_files,
        role="real_world_false_accept",
        excluded_samples=excluded_samples,
    )
    rejected_files = [
        *rejected_extra_positive_files,
        *rejected_false_reject_positive_files,
        *rejected_hard_negative_files,
    ]

    if len(positive_files) < 20:
        raise RuntimeError(f"Need at least 20 positive WAV files, found {len(positive_files)}")

    if len(open_negative_files) < 100:
        raise RuntimeError(f"Need at least 100 open negative WAV files, found {len(open_negative_files)}")

    selected_open_negative_files = random.sample(open_negative_files, min(args.max_negative_samples, len(open_negative_files)))
    positive_split = split_positive_by_speaker(positive_files)
    open_negative_split = split_files(selected_open_negative_files)
    hard_negative_split = split_files(hard_negative_files)
    weighted_hard_negative_split = Split(
        train=repeat_files(hard_negative_split.train, args.hard_negative_train_repeats),
        validation=hard_negative_split.validation,
        test=hard_negative_split.test,
    )
    negative_split = combine_splits(open_negative_split, weighted_hard_negative_split)

    train_x, train_y = build_dataset(
        positive_split.train,
        negative_split.train,
        positive_augmentations=args.positive_augmentations,
        negative_augmentations=1,
        training=True,
    )
    validation_x, validation_y = build_dataset(
        positive_split.validation,
        negative_split.validation,
        positive_augmentations=3,
        negative_augmentations=1,
        training=False,
    )
    test_x, test_y = build_dataset(
        positive_split.test,
        negative_split.test,
        positive_augmentations=3,
        negative_augmentations=1,
        training=False,
    )

    model = create_model()
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=5,
            restore_best_weights=True,
        )
    ]
    history = model.fit(
        train_x,
        train_y,
        validation_data=(validation_x, validation_y),
        epochs=args.epochs,
        batch_size=args.batch_size,
        shuffle=True,
        callbacks=callbacks,
        verbose=2,
    )

    keras_model_path = output_dir / "haotika.keras"
    model.save(keras_model_path)

    tflite_model = convert_to_tflite(model)
    tflite_path = output_dir / "haotika.tflite"
    tflite_path.write_bytes(tflite_model)

    validation_scores = predict_scores(model, validation_x)
    test_scores = predict_scores(model, test_x)
    threshold_sweep = build_threshold_sweep(validation_scores, validation_y)
    recommended_threshold = recommend_threshold(threshold_sweep)
    validation_metrics = evaluate_scores(validation_scores, validation_y, recommended_threshold)
    test_metrics = evaluate_scores(test_scores, test_y, recommended_threshold)
    manifest_path = output_dir / "haotika_manifest.json"
    write_asset_manifest(
        manifest_path,
        tflite_path,
        model_version=args.model_version,
        threshold=recommended_threshold,
        base_positive_count=len(base_positive_files),
        extra_positive_count=len(extra_positive_files),
        false_reject_positive_count=len(false_reject_positive_files),
        open_negative_count=len(selected_open_negative_files),
        hard_negative_count=len(hard_negative_files),
        rejected_extra_positive_count=len(rejected_extra_positive_files),
        rejected_false_reject_positive_count=len(rejected_false_reject_positive_files),
        rejected_hard_negative_count=len(rejected_hard_negative_files),
        excluded_samples_count=len(excluded_samples),
    )

    if args.install_asset:
        args.asset_model_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(tflite_path, args.asset_model_path)
        shutil.copyfile(manifest_path, args.asset_manifest_path)

    write_scores(output_dir / "validation_scores.csv", validation_scores, validation_y)
    write_scores(output_dir / "test_scores.csv", test_scores, test_y)
    write_threshold_sweep(output_dir / "threshold_sweep.csv", threshold_sweep)
    write_rejected_files(output_dir / "rejected_samples.csv", rejected_files)
    write_report(
        output_dir / "report.md",
        model_version=args.model_version,
        base_positive_files=base_positive_files,
        extra_positive_files=extra_positive_files,
        false_reject_positive_files=false_reject_positive_files,
        open_negative_files=selected_open_negative_files,
        hard_negative_files=hard_negative_files,
        rejected_files=rejected_files,
        positive_split=positive_split,
        negative_split=negative_split,
        hard_negative_split=hard_negative_split,
        hard_negative_train_repeats=args.hard_negative_train_repeats,
        train_count=len(train_y),
        validation_count=len(validation_y),
        test_count=len(test_y),
        history=history.history,
        recommended_threshold=recommended_threshold,
        validation_metrics=validation_metrics,
        test_metrics=test_metrics,
        threshold_sweep=threshold_sweep,
        tflite_path=tflite_path,
        installed_asset_path=args.asset_model_path if args.install_asset else None,
        excluded_samples_path=args.excluded_samples_csv,
        excluded_samples_count=len(excluded_samples),
    )

    print(f"Trained {args.model_version}")
    print(f"TFLite: {tflite_path}")
    print(f"Manifest: {manifest_path}")
    if args.install_asset:
        print(f"Installed Android asset: {args.asset_model_path}")
    print(f"Report: {output_dir / 'report.md'}")
    print(f"Recommended threshold: {recommended_threshold:.2f}")
    print("Validation:", asdict(validation_metrics))
    print("Test:", asdict(test_metrics))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--positive-dir", type=Path, default=DEFAULT_POSITIVE_DIR)
    parser.add_argument("--extra-positive-dir", type=Path, action="append", dest="extra_positive_dirs", default=list(DEFAULT_EXTRA_POSITIVE_DIRS))
    parser.add_argument("--false-reject-positive-dir", type=Path, action="append", dest="false_reject_positive_dirs", default=list(DEFAULT_FALSE_REJECT_POSITIVE_DIRS))
    parser.add_argument("--negative-dir", type=Path, default=DEFAULT_NEGATIVE_DIR)
    parser.add_argument("--hard-negative-dir", type=Path, action="append", dest="hard_negative_dirs", default=list(DEFAULT_HARD_NEGATIVE_DIRS))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--asset-model-path", type=Path, default=DEFAULT_ASSET_MODEL_PATH)
    parser.add_argument("--asset-manifest-path", type=Path, default=DEFAULT_ASSET_MANIFEST_PATH)
    parser.add_argument("--model-version", default=MODEL_VERSION)
    parser.add_argument("--max-negative-samples", type=int, default=MAX_NEGATIVE_SAMPLES)
    parser.add_argument("--hard-negative-train-repeats", type=int, default=HARD_NEGATIVE_TRAIN_REPEATS)
    parser.add_argument("--positive-augmentations", type=int, default=POSITIVE_AUGMENTATIONS_PER_FILE)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    parser.add_argument("--excluded-samples-csv", type=Path, default=DEFAULT_EXCLUDED_SAMPLES_CSV)
    parser.add_argument("--install-asset", action="store_true")
    return parser.parse_args()


def ensure_negative_dataset(negative_dir: Path) -> None:
    if any(negative_dir.glob("*/*.wav")):
        return

    negative_dir.mkdir(parents=True, exist_ok=True)
    archive_path = negative_dir.parent / "mini_speech_commands.zip"

    if not archive_path.exists():
        print(f"Downloading open negative samples: {MINI_SPEECH_COMMANDS_URL}")
        urllib.request.urlretrieve(MINI_SPEECH_COMMANDS_URL, archive_path)

    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(negative_dir.parent)

    extracted_dir = negative_dir.parent / "mini_speech_commands"
    if extracted_dir != negative_dir and extracted_dir.exists():
        negative_dir.mkdir(parents=True, exist_ok=True)


def collect_wav_files(directories: Iterable[Path]) -> list[Path]:
    files: list[Path] = []

    for directory in directories:
        if directory.exists():
            files.extend(directory.glob("*.wav"))

    return unique_paths(files)


def unique_paths(files: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []

    for file_path in files:
        key = str(file_path)
        if key in seen:
            continue

        seen.add(key)
        unique.append(file_path)

    return sorted(unique)


def read_excluded_samples(path: Path) -> dict[Path, ExcludedSample]:
    if not path.exists():
        return {}

    excluded: dict[Path, ExcludedSample] = {}

    with path.open(newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            raw_path = (row.get("file") or "").strip()
            if not raw_path:
                continue

            reasons_text = (row.get("reasons") or row.get("reason") or "explicitly excluded").strip()
            reasons = [reason.strip() for reason in reasons_text.split(";") if reason.strip()]
            sample_path = Path(raw_path)
            excluded[sample_path] = ExcludedSample(sample_path, reasons or ["explicitly excluded"])

    return excluded


def filter_training_audio(
    files: list[Path],
    *,
    role: str,
    excluded_samples: dict[Path, ExcludedSample],
) -> tuple[list[Path], list[RejectedFile]]:
    accepted: list[Path] = []
    rejected: list[RejectedFile] = []

    for file_path in files:
        explicit_exclusion = excluded_samples.get(file_path)
        reasons = list(explicit_exclusion.reasons) if explicit_exclusion else []
        reasons.extend(audit_training_audio(file_path, role=role))
        reasons = unique_reasons(reasons)

        if reasons:
            rejected.append(RejectedFile(file_path, role, reasons))
        else:
            accepted.append(file_path)

    return accepted, rejected


def unique_reasons(reasons: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []

    for reason in reasons:
        if reason in seen:
            continue

        seen.add(reason)
        unique.append(reason)

    return unique


def audit_training_audio(file_path: Path, *, role: str) -> list[str]:
    reasons: list[str] = []
    pcm = b""
    sample_rate = 0
    channels = 0
    sample_width = 0

    try:
        with wave.open(str(file_path), "rb") as wav:
            channels = wav.getnchannels()
            sample_rate = wav.getframerate()
            sample_width = wav.getsampwidth()
            frame_count = wav.getnframes()
            pcm = wav.readframes(frame_count)
    except wave.Error as error:
        return [f"invalid wav: {error}"]

    if channels != EXPECTED_CHANNELS:
        reasons.append(f"channels={channels}, expected {EXPECTED_CHANNELS}")

    if sample_rate != SAMPLE_RATE:
        reasons.append(f"sampleRate={sample_rate}, expected {SAMPLE_RATE}")

    if sample_width != EXPECTED_SAMPLE_WIDTH_BYTES:
        reasons.append(f"sampleWidth={sample_width}, expected {EXPECTED_SAMPLE_WIDTH_BYTES}")

    duration_seconds = frame_count / sample_rate if sample_rate > 0 else 0.0
    if duration_seconds < MIN_DURATION_SECONDS:
        reasons.append(f"too short: {duration_seconds * 1_000:.0f}ms")

    if duration_seconds > MAX_DURATION_SECONDS:
        reasons.append(f"too long: {duration_seconds * 1_000:.0f}ms")

    if channels == EXPECTED_CHANNELS and sample_width == EXPECTED_SAMPLE_WIDTH_BYTES and pcm:
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32_768.0
        peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
        rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
        clipping_ratio = float(np.mean(np.abs(samples) >= 0.9997)) if len(samples) else 0.0

        if peak < MIN_PEAK:
            reasons.append(f"too quiet peak={peak:.3f}")

        if rms < MIN_RMS:
            reasons.append(f"too quiet rms={rms:.3f}")

        if clipping_ratio > MAX_CLIPPING_RATIO:
            reasons.append(f"clipping={clipping_ratio:.3%}")

        if role == "real_world_true_accept":
            reasons.extend(audit_real_world_true_accept(file_path, samples, sample_rate))

    return reasons


def audit_real_world_true_accept(file_path: Path, samples: np.ndarray, sample_rate: int) -> list[str]:
    reasons: list[str] = []

    if sample_rate <= 0 or len(samples) == 0:
        return reasons

    active_indices = np.flatnonzero(np.abs(samples * 32_768.0) > VOICE_ACTIVITY_THRESHOLD)
    if len(active_indices) == 0:
        reasons.append("no active speech found")
    else:
        leading_silence_seconds = float(active_indices[0] / sample_rate)
        active_speech_seconds = float((active_indices[-1] - active_indices[0] + 1) / sample_rate)

        if leading_silence_seconds > TRUE_ACCEPT_MAX_LEADING_SILENCE_SECONDS:
            reasons.append(f"likely truncated true_accept: leading speech starts at {leading_silence_seconds * 1_000:.0f}ms")

        if active_speech_seconds < TRUE_ACCEPT_MIN_ACTIVE_SPEECH_SECONDS:
            reasons.append(f"likely partial true_accept: active speech {active_speech_seconds * 1_000:.0f}ms")

    metadata = read_wakeword_metadata(file_path.with_suffix(".json"))
    model_version = metadata.get("modelVersion")
    threshold = metadata_float(metadata.get("threshold"))

    if threshold is not None and threshold <= TRUE_ACCEPT_LOW_CONFIDENCE_THRESHOLD:
        reasons.append(f"low-confidence true_accept metadata threshold={threshold:.2f}")

    if model_version == "haotika-experimental-v0":
        reasons.append(f"legacy experimental true_accept modelVersion={model_version}")

    return reasons


def read_wakeword_metadata(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}

    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def metadata_float(value: object) -> float | None:
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def split_positive_by_speaker(files: list[Path]) -> Split:
    speakers: dict[str, list[Path]] = {}
    for file_path in files:
        speaker_id = speaker_id_from_path(file_path)
        speakers.setdefault(speaker_id, []).append(file_path)

    ordered_speakers = sorted(speakers)
    if len(ordered_speakers) < 8:
        return split_files(files)

    train_speakers = ordered_speakers[:-2]
    validation_speakers = ordered_speakers[-2:-1]
    test_speakers = ordered_speakers[-1:]

    return Split(
        train=[file_path for speaker in train_speakers for file_path in speakers[speaker]],
        validation=[file_path for speaker in validation_speakers for file_path in speakers[speaker]],
        test=[file_path for speaker in test_speakers for file_path in speakers[speaker]],
    )


def speaker_id_from_path(file_path: Path) -> str:
    parts = file_path.stem.split("_")

    if len(parts) >= 2 and parts[0] == "speaker" and parts[1].isdigit():
        return "_".join(parts[:2])

    return "unknown"


def split_files(files: list[Path]) -> Split:
    shuffled = list(files)
    random.shuffle(shuffled)
    train_end = math.floor(len(shuffled) * 0.7)
    validation_end = math.floor(len(shuffled) * 0.85)
    return Split(
        train=shuffled[:train_end],
        validation=shuffled[train_end:validation_end],
        test=shuffled[validation_end:],
    )


def repeat_files(files: list[Path], repeats: int) -> list[Path]:
    return files * max(1, repeats)


def combine_splits(first: Split, second: Split) -> Split:
    return Split(
        train=[*first.train, *second.train],
        validation=[*first.validation, *second.validation],
        test=[*first.test, *second.test],
    )


def build_dataset(
    positive_files: list[Path],
    negative_files: list[Path],
    *,
    positive_augmentations: int,
    negative_augmentations: int,
    training: bool,
) -> tuple[np.ndarray, np.ndarray]:
    examples: list[np.ndarray] = []
    labels: list[float] = []

    for file_path in positive_files:
        waveform = load_wav(file_path)
        for _ in range(positive_augmentations):
            examples.append(prepare_window(waveform, training=training, is_positive=True))
            labels.append(1.0)

    for file_path in negative_files:
        waveform = load_wav(file_path)
        for _ in range(negative_augmentations):
            examples.append(prepare_window(waveform, training=training, is_positive=False))
            labels.append(0.0)

    indices = np.arange(len(labels))
    np.random.shuffle(indices)

    x = np.stack(examples).astype(np.float32)[indices]
    y = np.array(labels, dtype=np.float32)[indices]
    return x[..., np.newaxis], y


def load_wav(file_path: Path) -> np.ndarray:
    audio_binary = tf.io.read_file(str(file_path))
    waveform, sample_rate = tf.audio.decode_wav(audio_binary, desired_channels=1)
    sample_rate_value = int(sample_rate.numpy())
    if sample_rate_value != SAMPLE_RATE:
        raise RuntimeError(f"{file_path} has sampleRate={sample_rate_value}, expected {SAMPLE_RATE}")
    return np.squeeze(waveform.numpy(), axis=-1).astype(np.float32)


def prepare_window(waveform: np.ndarray, *, training: bool, is_positive: bool) -> np.ndarray:
    waveform = normalize_peak(waveform)

    if len(waveform) >= WINDOW_SAMPLES:
        if training:
            start = random.randint(0, len(waveform) - WINDOW_SAMPLES)
        else:
            start = (len(waveform) - WINDOW_SAMPLES) // 2
        window = waveform[start : start + WINDOW_SAMPLES]
    else:
        window = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
        if training:
            max_offset = WINDOW_SAMPLES - len(waveform)
            if is_positive:
                offset = random.randint(0, max_offset)
            else:
                offset = random.randint(0, max_offset)
        else:
            offset = (WINDOW_SAMPLES - len(waveform)) // 2
        window[offset : offset + len(waveform)] = waveform

    if training:
        window = augment(window, is_positive=is_positive)

    return np.clip(window, -1.0, 1.0)


def normalize_peak(waveform: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(waveform))) if len(waveform) else 0.0
    if peak < 0.01:
        return waveform
    return np.clip(waveform * min(0.85 / peak, 8.0), -1.0, 1.0)


def augment(window: np.ndarray, *, is_positive: bool) -> np.ndarray:
    gain = random.uniform(0.65, 1.15) if is_positive else random.uniform(0.45, 1.1)
    noise_level = random.uniform(0.0, 0.012 if is_positive else 0.018)
    noise = np.random.normal(0.0, noise_level, WINDOW_SAMPLES).astype(np.float32)
    shifted = np.roll(window, random.randint(-900, 900))
    return shifted * gain + noise


def create_model() -> tf.keras.Model:
    inputs = tf.keras.Input(shape=(WINDOW_SAMPLES, 1), name="audio")
    x = tf.keras.layers.Conv1D(16, 80, strides=4, padding="same", activation="relu")(inputs)
    x = tf.keras.layers.MaxPooling1D(pool_size=4)(x)
    x = tf.keras.layers.Conv1D(32, 40, strides=2, padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPooling1D(pool_size=4)(x)
    x = tf.keras.layers.Conv1D(64, 20, strides=2, padding="same", activation="relu")(x)
    x = tf.keras.layers.GlobalAveragePooling1D()(x)
    x = tf.keras.layers.Dropout(0.25)(x)
    x = tf.keras.layers.Dense(32, activation="relu")(x)
    outputs = tf.keras.layers.Dense(1, activation="sigmoid", name="score")(x)

    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="binary_crossentropy",
        metrics=[
            tf.keras.metrics.BinaryAccuracy(name="accuracy", threshold=THRESHOLD),
            tf.keras.metrics.Precision(name="precision", thresholds=THRESHOLD),
            tf.keras.metrics.Recall(name="recall", thresholds=THRESHOLD),
        ],
    )
    return model


def convert_to_tflite(model: tf.keras.Model) -> bytes:
    @tf.function(input_signature=[tf.TensorSpec([1, WINDOW_SAMPLES, 1], tf.float32, name="audio")])
    def serve(audio: tf.Tensor) -> tf.Tensor:
        return model(audio, training=False)

    concrete_function = serve.get_concrete_function()
    frozen_function = convert_variables_to_constants_v2(concrete_function)
    converter = tf.lite.TFLiteConverter.from_concrete_functions([frozen_function])
    return converter.convert()


def predict_scores(model: tf.keras.Model, x: np.ndarray) -> np.ndarray:
    return model.predict(x, batch_size=64, verbose=0).reshape(-1)


def evaluate_scores(scores: np.ndarray, y: np.ndarray, threshold: float) -> Metrics:
    predictions = scores >= threshold
    labels = y >= 0.5

    tp = int(np.sum(predictions & labels))
    tn = int(np.sum(~predictions & ~labels))
    fp = int(np.sum(predictions & ~labels))
    fn = int(np.sum(~predictions & labels))
    total = len(y)

    return Metrics(
        accuracy=(tp + tn) / total if total else 0.0,
        precision=tp / (tp + fp) if tp + fp else 0.0,
        recall=tp / (tp + fn) if tp + fn else 0.0,
        false_accept_rate=fp / (fp + tn) if fp + tn else 0.0,
        false_reject_rate=fn / (fn + tp) if fn + tp else 0.0,
        threshold=threshold,
        tp=tp,
        tn=tn,
        fp=fp,
        fn=fn,
    )


def build_threshold_sweep(scores: np.ndarray, y: np.ndarray) -> list[Metrics]:
    thresholds = np.arange(THRESHOLD_SWEEP_START, THRESHOLD_SWEEP_END + THRESHOLD_SWEEP_STEP, THRESHOLD_SWEEP_STEP)
    return [evaluate_scores(scores, y, float(round(threshold, 2))) for threshold in thresholds]


def recommend_threshold(metrics: list[Metrics]) -> float:
    acceptable = [
        metric
        for metric in metrics
        if metric.false_accept_rate <= 0.01 and metric.false_reject_rate <= 0.20
    ]

    if acceptable:
        best = max(acceptable, key=lambda metric: (metric.recall, metric.accuracy, -metric.threshold))
        return best.threshold

    best = min(
        metrics,
        key=lambda metric: (
            metric.false_accept_rate * 3 + metric.false_reject_rate,
            metric.false_accept_rate,
            metric.false_reject_rate,
            -metric.accuracy,
        ),
    )
    return best.threshold


def write_scores(path: Path, scores: np.ndarray, y: np.ndarray) -> None:
    with path.open("w", newline="") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["label", "score"])
        for label, score in zip(y, scores):
            writer.writerow([int(label), f"{float(score):.6f}"])


def write_threshold_sweep(path: Path, metrics: list[Metrics]) -> None:
    with path.open("w", newline="") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow([
            "threshold",
            "accuracy",
            "precision",
            "recall",
            "false_accept_rate",
            "false_reject_rate",
            "tp",
            "tn",
            "fp",
            "fn",
        ])
        for metric in metrics:
            writer.writerow([
                f"{metric.threshold:.2f}",
                f"{metric.accuracy:.6f}",
                f"{metric.precision:.6f}",
                f"{metric.recall:.6f}",
                f"{metric.false_accept_rate:.6f}",
                f"{metric.false_reject_rate:.6f}",
                metric.tp,
                metric.tn,
                metric.fp,
                metric.fn,
            ])


def write_rejected_files(path: Path, rejected_files: list[RejectedFile]) -> None:
    with path.open("w", newline="") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["role", "file", "reasons"])
        for rejected_file in rejected_files:
            writer.writerow([
                rejected_file.role,
                str(rejected_file.path),
                "; ".join(rejected_file.reasons),
            ])


def write_report(
    path: Path,
    *,
    model_version: str,
    base_positive_files: list[Path],
    extra_positive_files: list[Path],
    false_reject_positive_files: list[Path],
    open_negative_files: list[Path],
    hard_negative_files: list[Path],
    rejected_files: list[RejectedFile],
    positive_split: Split,
    negative_split: Split,
    hard_negative_split: Split,
    hard_negative_train_repeats: int,
    train_count: int,
    validation_count: int,
    test_count: int,
    history: dict[str, list[float]],
    recommended_threshold: float,
    validation_metrics: Metrics,
    test_metrics: Metrics,
    threshold_sweep: list[Metrics],
    tflite_path: Path,
    installed_asset_path: Path | None,
    excluded_samples_path: Path,
    excluded_samples_count: int,
) -> None:
    best_epoch = int(np.argmin(history["val_loss"])) + 1 if history.get("val_loss") else 0
    positive_files_count = len(base_positive_files) + len(extra_positive_files) + len(false_reject_positive_files)
    negative_files_count = len(open_negative_files) + len(hard_negative_files)
    lines = [
        "# Haotika Experimental Wake-Word Model",
        "",
        f"- Model version: `{model_version}`",
        f"- Wake phrase: `Хаотика`",
        f"- Input shape: `[1, {WINDOW_SAMPLES}, 1]`",
        f"- Output: single sigmoid score",
        f"- Recommended threshold: `{recommended_threshold:.2f}`",
        f"- TFLite: `{tflite_path}`",
        f"- Android asset: `{installed_asset_path}`" if installed_asset_path else "- Android asset: not installed",
        "",
        "## Data",
        "",
        f"- Positive files: {positive_files_count}",
        f"- Base positive files: {len(base_positive_files)} local Android recordings",
        f"- Real-world true accept files: {len(extra_positive_files)}",
        f"- Real-world false reject positive files: {len(false_reject_positive_files)}",
        f"- Negative files: {negative_files_count}",
        f"- Open negative files: {len(open_negative_files)} from `{MINI_SPEECH_COMMANDS_URL}`",
        f"- Real-world hard negative false accept files: {len(hard_negative_files)}",
        f"- Rejected real-world files by audit/exclusion policy: {len(rejected_files)}",
        f"- Explicit exclusion list: `{excluded_samples_path}` ({excluded_samples_count} rows)",
        f"- Negative license: {MINI_SPEECH_COMMANDS_LICENSE}",
        "- Negative labels: mini Speech Commands words plus real false wake-word accepts",
        "",
        "## Rejected Real-World Files",
        "",
        rejected_files_table(rejected_files),
        "",
        "## Split",
        "",
        f"- Positive train/validation/test files: {len(positive_split.train)} / {len(positive_split.validation)} / {len(positive_split.test)}",
        f"- Negative train/validation/test files: {len(negative_split.train)} / {len(negative_split.validation)} / {len(negative_split.test)}",
        f"- Hard negative train/validation/test files: {len(hard_negative_split.train)} / {len(hard_negative_split.validation)} / {len(hard_negative_split.test)}",
        f"- Hard negative train repeats: {hard_negative_train_repeats}",
        f"- Generated train/validation/test examples: {train_count} / {validation_count} / {test_count}",
        f"- Best epoch by validation loss: {best_epoch}",
        f"- Threshold sweep candidates: {len(threshold_sweep)}",
        "",
        "## Validation Metrics",
        "",
        metrics_table(validation_metrics),
        "",
        "## Test Metrics",
        "",
        metrics_table(test_metrics),
        "",
        "## Limitations",
        "",
        f"- This is an experimental model trained from only {positive_files_count} positive recordings.",
        "- Russian household speech is still underrepresented; false accepts should keep being collected.",
        "- Real-world hard negatives are valuable but still too few for stable production metrics.",
        "- There are too few speakers for a strict speaker-independent split; test metrics are optimistic.",
        "- Do not treat this as production-ready until false accept / false reject are tested on real devices.",
    ]
    path.write_text("\n".join(lines) + "\n")


def metrics_table(metrics: Metrics) -> str:
    return "\n".join(
        [
            "| Metric | Value |",
            "| --- | ---: |",
            f"| Accuracy | {metrics.accuracy:.4f} |",
            f"| Precision | {metrics.precision:.4f} |",
            f"| Recall | {metrics.recall:.4f} |",
            f"| False accept rate | {metrics.false_accept_rate:.4f} |",
            f"| False reject rate | {metrics.false_reject_rate:.4f} |",
            f"| Threshold | {metrics.threshold:.2f} |",
            f"| TP / TN / FP / FN | {metrics.tp} / {metrics.tn} / {metrics.fp} / {metrics.fn} |",
        ]
    )


def rejected_files_table(rejected_files: list[RejectedFile]) -> str:
    if not rejected_files:
        return "None."

    lines = [
        "| Role | File | Reasons |",
        "| --- | --- | --- |",
    ]

    for rejected_file in rejected_files:
        lines.append(
            f"| {rejected_file.role} | `{rejected_file.path}` | {'; '.join(rejected_file.reasons)} |"
        )

    return "\n".join(lines)


def write_asset_manifest(
    manifest_path: Path,
    tflite_path: Path,
    *,
    model_version: str,
    threshold: float,
    base_positive_count: int,
    extra_positive_count: int,
    false_reject_positive_count: int,
    open_negative_count: int,
    hard_negative_count: int,
    rejected_extra_positive_count: int,
    rejected_false_reject_positive_count: int,
    rejected_hard_negative_count: int,
    excluded_samples_count: int,
) -> None:
    manifest = {
        "phraseId": "haotika",
        "displayPhrase": "Хаотика",
        "language": "ru-RU",
        "modelVersion": model_version,
        "modelPath": "wakewords/haotika.tflite",
        "threshold": round(threshold, 2),
        "sampleRate": SAMPLE_RATE,
        "vadEnabled": True,
        "inputShape": [1, WINDOW_SAMPLES, 1],
        "source": "local experimental training with real-world feedback",
        "positiveDataset": {
            "baseAndroidRecordings": base_positive_count,
            "realWorldTrueAccept": extra_positive_count,
            "realWorldFalseReject": false_reject_positive_count,
            "rejectedRealWorldTrueAccept": rejected_extra_positive_count,
            "rejectedRealWorldFalseReject": rejected_false_reject_positive_count,
            "explicitExclusionListRows": excluded_samples_count,
        },
        "negativeDataset": {
            "name": "mini_speech_commands",
            "url": MINI_SPEECH_COMMANDS_URL,
            "license": MINI_SPEECH_COMMANDS_LICENSE,
            "openNegativeFiles": open_negative_count,
            "realWorldFalseAccept": hard_negative_count,
            "rejectedRealWorldFalseAccept": rejected_hard_negative_count,
        },
        "artifactBytes": tflite_path.stat().st_size,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
