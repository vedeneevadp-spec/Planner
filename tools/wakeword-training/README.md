# Wakeword Training Workspace

This workspace is for controlled self-training of the fixed wake phrase:

```text
Хаотика
```

Primary path:

```text
LiveKit Wakeword -> haotika.onnx + LiveKit frontend ONNX -> LiveKitOnnxWakeWordEngine
```

Android does not train models. Android only runs the selected ONNX model
offline through ONNX Runtime. `CustomTfliteWakeWordEngine` remains as a fallback
runtime path for a future `haotika.tflite`.

## Layout

```text
tools/wakeword-training/
  configs/haotika.livekit.yaml
  data/
    positive_real/
    hard_negatives/
    validation/
      positive/
      negative/
    backgrounds/
    rirs/
  scripts/
    setup_env.sh
    train_livekit.sh
    evaluate_model.py
    export_model.sh
    collect_livekit_frontend_artifacts.py
    copy_to_android_assets.sh
  parity/
    input/
    expected/
    scripts/
  output/
```

Only configs, scripts, README files, and `.gitkeep` placeholders belong in git.
Do not commit raw audio, generated models, or evaluation output.

## Data

Positive examples:

- clean repeats of `Хаотика`
- real-world `true_accept`
- real-world `false_reject`

Hard negatives:

- `котика`
- `готика`
- `экзотика`
- `хаос`
- `хаотично`
- `политика`
- `риторика`
- `хаотичная`
- `план на завтра`
- `открой планнер`
- ordinary Russian speech
- TV / YouTube
- kitchen household noise
- silence

Validation examples go into `data/validation/positive` and
`data/validation/negative`. Background noise and room impulse response files for
augmentation go into `data/backgrounds` and `data/rirs`.

Validation minimum before a closed rollout:

- 20 repeats of `Хаотика` in a quiet room
- 20 repeats of `Хаотика` in household noise
- 10 repeats from 1-2 meters
- 10 repeats with different intonation
- hard negatives
- 30 minutes of Russian speech / TV / YouTube
- 10 minutes of household noise
- 5 minutes of silence

## Train

Training must use an isolated Python 3.11+ environment under this workspace.
Do not reuse the repo's Node/Android environment.

Install prerequisites on macOS:

```bash
brew install uv
```

Create the local training environment:

```bash
cd tools/wakeword-training
./scripts/setup_env.sh
source .wakeword-venv/bin/activate
```

`setup_env.sh` creates `tools/wakeword-training/.wakeword-venv` and installs:

```text
livekit-wakeword[train,eval,export,voxcpm]
```

If `python3.11` is not available as a system command, the script installs a
uv-managed Python 3.11 into uv's local Python cache and still keeps the training
packages isolated in `.wakeword-venv`.

If Python package downloads time out on `files.pythonhosted.org`, rerun setup
with an explicit PyPI mirror:

```bash
UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple \
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
./scripts/setup_env.sh
```

It fails fast if `uv` is missing or package installation cannot complete.

Then run:

```bash
cd tools/wakeword-training
./scripts/train_livekit.sh haotika-livekit-0.1.0
```

The expected LiveKit CLI commands are:

```bash
livekit-wakeword setup --config configs/haotika.livekit.yaml
livekit-wakeword run configs/haotika.livekit.yaml
```

The training script writes into
`tools/wakeword-training/output/haotika-livekit-0.1.0/` and must not copy
anything into Android assets automatically.

## Frontend ONNX Artifacts

LiveKit `WakeWordModel` uses two frontend ONNX files before the classifier:

```text
melspectrogram.onnx
embedding_model.onnx
```

Locate and inspect them from the installed package:

```bash
cd tools/wakeword-training
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py
```

Copy them only into ignored local output after reviewing the license/notice
decision:

```bash
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py \
  --copy \
  --license-confirmed
```

This writes local-only files under:

```text
tools/wakeword-training/output/frontend/
  melspectrogram.onnx
  embedding_model.onnx
  livekit_frontend_metadata.json
```

Do not commit these ONNX files without an explicit product/security/license
decision.

## Evaluate

After training, evaluate the candidate:

```bash
tools/wakeword-training/scripts/evaluate_model.py \
  --version haotika-livekit-0.1.0 \
  --model tools/wakeword-training/output/haotika-livekit-0.1.0/haotika.onnx \
  --positive tools/wakeword-training/data/validation/positive \
  --negative tools/wakeword-training/data/validation/negative \
  --out tools/wakeword-training/output/haotika-livekit-0.1.0
```

The evaluator writes:

```text
evaluation_report.json
evaluation_report.md
```

Track at least:

- recall
- false accept count
- false reject count
- false positives per hour
- average detection score
- recommended threshold
- modelVersion

`evaluation_report.json` must also contain `modelIoContract`. This is the main
pre-copy risk check. Before approving a model, verify that Android runtime and
the exported ONNX model agree on:

- input shape
- input dtype
- input/output names
- axis order
- frame/window size
- sample rate
- normalization
- output score shape
- score interpretation
- threshold semantics

LiveKit exports a classifier head. Its ONNX input is embeddings, typically
`(1, 16, 96)`, not raw PCM. The LiveKit runtime `WakeWordModel` accepts 16 kHz
audio because it loads bundled mel/embedding preprocessors. Android approval is
blocked until `LiveKitOnnxWakeWordEngine` proves the same preprocessing path
against Python fixtures. The generated manifest keeps
`inputKind: "embedding_matrix"`, `frontend: "livekit_openwakeword"`, and
`ioContractConfirmedForAndroid: false` until that runtime path is proven.
It also declares frontend files `wakewords/livekit/melspectrogram.onnx`,
`wakewords/livekit/embedding_model.onnx`, and classifier
`wakewords/haotika.onnx`.

Local parity instructions:

```text
parity/scripts/run_android_parity_check.md
```

Parity requires positive, hard-negative, and silence/noise WAV fixtures. It
generates Python expected score JSON, then an opt-in Android instrumented test
compares the same WAV through `LiveKitOnnxOfflineScorer`.

## Versioning

Use monotonic model versions:

```text
haotika-livekit-0.1.0
haotika-livekit-0.2.0
haotika-livekit-0.3.0
```

Each version should have:

- `haotika.onnx`
- `haotika_manifest.json`
- `evaluation_report.md`
- `evaluation_report.json`
- `approval.json` if approved
- `notes.md`
- training config version
- notes about false accepts and false rejects

## Copy To Android

Only after manual approval:

```bash
tools/wakeword-training/scripts/copy_to_android_assets.sh haotika-livekit-0.1.0
```

This copies the selected model, manifest, and LiveKit frontend assets into:

```text
android/app/src/main/assets/wakewords/haotika.onnx
android/app/src/main/assets/wakewords/haotika_manifest.json
android/app/src/main/assets/wakewords/livekit/melspectrogram.onnx
android/app/src/main/assets/wakewords/livekit/embedding_model.onnx
```

Do not commit model files unless a product/security decision explicitly allows
that closed-rollout artifact.

The copy script refuses to copy unless the version directory contains:

- `haotika.onnx`
- `haotika_manifest.json`
- `evaluation_report.json`
- `evaluation_report.md`
- `approval.json`

For LiveKit classifier models, `haotika_manifest.json` must also set
`ioContractConfirmedForAndroid: true`. The generated manifest keeps it `false`
until Android has a compatible `livekit_openwakeword` frontend and parity has
passed for the exact classifier/frontend hashes being copied.

`approval.json` must be created manually after evaluation:

```json
{
  "modelVersion": "haotika-livekit-0.1.0",
  "approvedForAndroidClosedRollout": true,
  "ioContractConfirmedForAndroid": true,
  "approvedBy": "owner",
  "date": "2026-06-01",
  "threshold": 0.5,
  "rolloutStage": "bootstrap_collection",
  "notes": "Bootstrap collection model for gathering real false_accept and false_reject samples. Not production-quality."
}
```

The approved manifest must use a concrete model version such as
`haotika-livekit-0.1.0`. Do not approve `pending-trained-model`, `pending`, or
`unknown`.

Approved `.onnx` assets are not committed by default. Copy them into Android
assets locally before a closed-rollout build, or make an explicit
product/security decision to track the approved model file.
