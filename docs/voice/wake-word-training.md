# Wake-Word Training

This document describes the controlled training path for the fixed wake phrase:

```text
Хаотика
```

## Why LiveKit Wakeword

LiveKit Wakeword is the primary path because it gives us a dedicated wake-word
training workflow and an ONNX export target that can run offline on Android. It
also keeps training outside the mobile app, which preserves a small Android
runtime surface.

## Why ONNX Next To TFLite

`CustomOnnxWakeWordEngine` is the primary runtime for LiveKit-generated
`haotika.onnx`. `CustomTfliteWakeWordEngine` stays in the project as a fallback
for a future `haotika.tflite`. `WakeWordService` remains provider-neutral and
depends only on `WakeWordEngine`.

## Workspace

Training files live here:

```text
tools/wakeword-training/
  data/validation/positive/
  data/validation/negative/
```

Git should contain only:

- README/docs
- config templates
- scripts
- `.gitkeep` placeholders

Do not commit:

- raw `.wav`, `.mp3`, `.ogg`
- generated ONNX/TFLite models
- training output directories

## Train

Template config:

```text
tools/wakeword-training/configs/haotika.livekit.yaml
```

Run:

```bash
cd tools/wakeword-training
./scripts/setup_env.sh
./scripts/train_livekit.sh haotika-livekit-0.1.0
```

Expected LiveKit CLI flow:

```bash
livekit-wakeword setup --config configs/haotika.livekit.yaml
livekit-wakeword run configs/haotika.livekit.yaml
```

Install with Python 3.11+:

```bash
brew install uv
cd tools/wakeword-training
./scripts/setup_env.sh
source .wakeword-venv/bin/activate
```

`setup_env.sh` uses system `python3.11` when available. If it is not installed,
the script installs a uv-managed Python 3.11 and keeps all training packages in
`tools/wakeword-training/.wakeword-venv`.

If package downloads time out on `files.pythonhosted.org`, rerun setup with:

```bash
UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple \
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
./scripts/setup_env.sh
```

The script writes the first candidate to:

```text
tools/wakeword-training/output/haotika-livekit-0.1.0/
```

## First Training Loop: haotika-livekit-0.1.0

Commands:

```bash
cd tools/wakeword-training
./scripts/setup_env.sh
./scripts/train_livekit.sh haotika-livekit-0.1.0
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py \
  --copy \
  --license-confirmed
./scripts/evaluate_model.py \
  --version haotika-livekit-0.1.0 \
  --model output/haotika-livekit-0.1.0/haotika.onnx \
  --positive data/validation/positive \
  --negative data/validation/negative \
  --out output/haotika-livekit-0.1.0
./scripts/copy_to_android_assets.sh haotika-livekit-0.1.0
```

The last command must fail until `approval.json` exists and sets both
`approvedForAndroidClosedRollout` and `ioContractConfirmedForAndroid` to `true`.

## Evaluate

Minimum validation set:

- 20 repeats of `Хаотика` in a quiet room
- 20 repeats in household noise
- 10 repeats from 1-2 meters
- 10 repeats with varied intonation
- hard negatives
- 30 minutes ordinary Russian speech / TV / YouTube
- 10 minutes household noise
- 5 minutes silence

Run:

```bash
tools/wakeword-training/scripts/evaluate_model.py \
  --version haotika-livekit-0.1.0 \
  --model tools/wakeword-training/output/haotika-livekit-0.1.0/haotika.onnx \
  --positive tools/wakeword-training/data/validation/positive \
  --negative tools/wakeword-training/data/validation/negative \
  --out tools/wakeword-training/output/haotika-livekit-0.1.0
```

Reports:

```text
evaluation_report.json
evaluation_report.md
```

Metrics:

- recall
- false accept count
- false reject count
- false positives per hour
- average detection score
- recommended threshold
- modelVersion

## Model IO Contract

Before the first real model is approved, verify the ONNX contract. This is the
main integration risk.

Every approved `evaluation_report.json` must include:

- pinned LiveKit commit
- frontend model file names, sizes, and SHA-256 hashes
- input/output names
- input shape
- input dtype
- axis order
- frame/window size
- sample rate
- normalization
- output score shape
- score interpretation
- threshold semantics

Current confirmed LiveKit contract:

- exported `haotika.onnx` is a classifier head;
- ONNX input name is expected to be `embeddings`;
- ONNX input shape is expected to be `(1, 16, 96)` with dynamic batch;
- ONNX output is a scalar score;
- LiveKit `WakeWordModel` accepts 16 kHz mono int16/float32 audio because it
  loads bundled mel-spectrogram and speech-embedding preprocessors.

Current Android status:

- input audio: 16 kHz mono PCM16 from `AudioRecord`
- LiveKit classifier ONNX expects embeddings, not raw PCM;
- Android now has a `LiveKitOnnxWakeWordEngine` path for
  `melspectrogram.onnx` → `embedding_model.onnx` → `haotika.onnx`;
- `ioContractConfirmedForAndroid` must remain `false` until that runtime path
  has a parity test against Python `WakeWordModel`.

Do not treat threshold tuning as a substitute for this contract match.

Pinned source for the first Android parity pass:

```text
livekit/livekit-wakeword commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
melspectrogram.onnx sha256: ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f
embedding_model.onnx sha256: 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
```

If LiveKit or either frontend model changes, regenerate parity fixtures and keep
`ioContractConfirmedForAndroid: false` until Android scores match Python again.
The rolling embedding order must match Python exactly: last 16 embeddings,
oldest-to-newest.

## How To Obtain Frontend ONNX Artifacts

After `./scripts/setup_env.sh`, inspect the frontend models from the installed
LiveKit package:

```bash
cd tools/wakeword-training
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py
```

The script prints source path, size, SHA-256, and ONNX input/output metadata for:

- `melspectrogram.onnx`
- `embedding_model.onnx`

It refuses to copy files unless license/notice review is acknowledged:

```bash
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py \
  --copy \
  --license-confirmed
```

Copied files go only to ignored local output:

```text
tools/wakeword-training/output/frontend/
```

See [livekit-android-runtime-spike.md](livekit-android-runtime-spike.md) for
the exact LiveKit classifier and frontend contract.
See [livekit-android-parity.md](livekit-android-parity.md) for the required
Android/Python parity process.

## Android/Python Parity

Before setting `ioContractConfirmedForAndroid: true`, run the local-only parity
loop:

```text
tools/wakeword-training/parity/scripts/run_android_parity_check.md
```

The parity check uses:

- positive WAV: `Хаотика`;
- hard negative WAV: `котика`;
- silence/noise WAV;
- Python expected score JSON from `WakeWordModel`;
- Android instrumented scorer using the same 2-second normalized WAV window.

Missing fixtures are not a pass. The Android test skips by default, and fails
when explicitly enabled without the required local files.

## Hard Negatives

Put hard negatives under:

```text
tools/wakeword-training/data/hard_negatives/
```

Required categories:

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

## Versioning

Use:

```text
haotika-livekit-0.1.0
haotika-livekit-0.2.0
haotika-livekit-0.3.0
```

Each model version needs:

- model file
- manifest
- evaluation report
- approval file, if approved
- notes
- selected threshold
- training config version
- notes for false accepts / false rejects

Output example:

```text
tools/wakeword-training/output/haotika-livekit-0.1.0/
  haotika.onnx
  haotika_manifest.json
  evaluation_report.md
  evaluation_report.json
  approval.json
  notes.md
```

## Copy To Android

Only after manual approval:

```bash
tools/wakeword-training/scripts/copy_to_android_assets.sh haotika-livekit-0.1.0
```

It copies:

```text
android/app/src/main/assets/wakewords/haotika.onnx
android/app/src/main/assets/wakewords/haotika_manifest.json
android/app/src/main/assets/wakewords/livekit/melspectrogram.onnx
android/app/src/main/assets/wakewords/livekit/embedding_model.onnx
```

The copy script requires all version artifacts:

- `haotika.onnx`
- `haotika_manifest.json`
- `evaluation_report.json`
- `evaluation_report.md`
- `approval.json`

For LiveKit classifier models, the manifest must also set
`ioContractConfirmedForAndroid: true`. The generated first-loop manifest keeps
it `false` until closed-rollout approval updates the manifest for the exact
model/frontend hashes being shipped. A local Android/Python parity run passed on
2026-05-31 for `haotika-livekit-0.1.0`, but that does not by itself approve the
candidate model or copy ONNX files into Android assets.

The first accepted Android asset use is a bootstrap collection model, not a
production-quality model. It uses threshold `0.50` to collect real
`false_accept` and `false_reject` samples while reducing the risk from the
hardest negative seen at `0.46149`.

`approval.json` appears only after manual approval:

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

The copy script checks that manifest/report/approval `modelVersion` equals the
requested version, that provider is `CUSTOM_ONNX`, that threshold matches
approval, that `modelVersion` is not a pending value, and that LiveKit
`modelIoContract` records the pinned commit, classifier IO names, frontend
hashes, frontend IO metadata, and latest-16 chronological embedding order.

Approved `.onnx` files are not committed by default. Copy them into Android
assets locally before a closed-rollout build unless a product/security decision
explicitly allows tracking the approved model file in git.

## Closed Rollout Feedback

Use real-world labels as follows:

- `true_accept`: keep as positive
- `false_reject`: keep as positive
- `false_accept`: add as hard negative

After every successful pull into timestamp staging and successful
`rsync --ignore-existing` into local training folders, delete copied recordings
from the phone. Do not delete phone recordings after failed pull/rsync.
