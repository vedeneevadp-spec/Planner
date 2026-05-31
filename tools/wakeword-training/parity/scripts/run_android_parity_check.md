# Run Android LiveKit Parity Check

This is a local-only check. It must not commit ONNX models, WAV fixtures,
expected score JSON, generated embeddings, or copied Android test assets.

## Prerequisites

Set up the training environment first:

```bash
cd tools/wakeword-training
./scripts/setup_env.sh
```

Required local files:

```text
tools/wakeword-training/output/haotika-livekit-0.1.0/haotika.onnx
tools/wakeword-training/parity/input/sample_haotika.wav
tools/wakeword-training/parity/input/sample_negative_kotika.wav
tools/wakeword-training/parity/input/sample_silence_or_noise.wav
```

Required frontend models come from the pinned LiveKit source:

```text
livekit/livekit-wakeword commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
resources:
  melspectrogram.onnx
  embedding_model.onnx
```

Use the installed Python package to locate the frontend models:

```bash
.wakeword-venv/bin/python - <<'PY'
from livekit.wakeword.resources import get_embedding_model_path, get_mel_model_path

print(get_mel_model_path())
print(get_embedding_model_path())
PY
```

## 1. Generate Python Expected Fixtures

```bash
cd tools/wakeword-training
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py \
  --copy \
  --license-confirmed

.wakeword-venv/bin/python parity/scripts/generate_python_parity_fixtures.py \
  --model output/haotika-livekit-0.1.0/haotika.onnx \
  --model-version haotika-livekit-0.1.0 \
  --frontend-dir output/frontend \
  --input parity/input \
  --out parity/expected
```

This fails intentionally if `livekit-wakeword`, `onnxruntime`, the classifier,
or WAV fixtures are missing.

## 2. Copy Local-Only Android Assets

Copy frontend and classifier models into ignored Android assets:

```bash
mkdir -p ../../android/app/src/main/assets/wakewords/livekit
cp output/frontend/melspectrogram.onnx ../../android/app/src/main/assets/wakewords/livekit/melspectrogram.onnx
cp output/frontend/embedding_model.onnx ../../android/app/src/main/assets/wakewords/livekit/embedding_model.onnx
cp output/haotika-livekit-0.1.0/haotika.onnx ../../android/app/src/main/assets/wakewords/haotika.onnx
```

Copy parity WAV/expected files into ignored Android test assets:

```bash
mkdir -p ../../android/app/src/androidTest/assets/wakeword-parity/input
mkdir -p ../../android/app/src/androidTest/assets/wakeword-parity/expected
cp parity/input/*.wav ../../android/app/src/androidTest/assets/wakeword-parity/input/
cp parity/expected/*_score.json ../../android/app/src/androidTest/assets/wakeword-parity/expected/
cp parity/parity.config.json ../../android/app/src/androidTest/assets/wakeword-parity/parity.config.json
```

## 3. Run Device Parity

Use a connected Android device or emulator:

```bash
cd ../../android
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.wakewordParity=true \
  -Pandroid.testInstrumentationRunnerArguments.class=ru.chaotika.app.LiveKitAndroidParityInstrumentedTest
```

If the phone already has `ru.chaotika.app` installed from another signing key,
run the parity test under a debug-only application id suffix instead of
uninstalling the user's app:

```bash
cd ../../android
./gradlew :app:connectedDebugAndroidTest \
  -PwakewordParityApplicationIdSuffix=.parity \
  -Pandroid.testInstrumentationRunnerArguments.wakewordParity=true \
  -Pandroid.testInstrumentationRunnerArguments.class=ru.chaotika.app.LiveKitAndroidParityInstrumentedTest
```

Without `wakewordParity=true`, the test is skipped with instructions. With the
flag enabled, missing fixtures or missing model assets fail the test.

## Pass/Fail Rules

Config source:

```text
tools/wakeword-training/parity/parity.config.json
```

Pass requires:

- Android score within `scoreTolerance` of Python expected score;
- classifier input/output names and dtypes match fixture metadata;
- classifier shape is exactly `(1, 16, 96)` to `(1, 1)`;
- generated embedding size is 96 and at least 16 embeddings are available;
- rolling order is latest 16 embeddings, oldest-to-newest;
- silence/noise fixture stays below the selected threshold;
- no raw audio, raw mel values, raw embeddings, transcript, or full buffers are
  logged or uploaded.

Do not set `ioContractConfirmedForAndroid` to `true` until this check passes on
positive, hard-negative, and silence/noise fixtures.
