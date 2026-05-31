# LiveKit Android Parity

Android closed rollout requires a parity check against Python
`livekit.wakeword.WakeWordModel` before `ioContractConfirmedForAndroid` can be
set to `true`.

Use the pinned LiveKit source unless this document is intentionally updated:

```text
livekit/livekit-wakeword commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
frontend resources: src/livekit/wakeword/resources/
```

The generated parity metadata must record frontend model file names, sizes,
SHA-256 hashes, input/output names, dtypes, and shapes. Do not compare an Android
score against Python fixtures generated from a different LiveKit commit or
different frontend model hashes.

Expected frontend artifacts for the first parity pass:

```text
melspectrogram.onnx
  source: src/livekit/wakeword/resources/melspectrogram.onnx
  observed size: 1.0 MB
  sha256: ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f

embedding_model.onnx
  source: src/livekit/wakeword/resources/embedding_model.onnx
  observed size: 1.3 MB
  sha256: 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
```

The pinned repository license is Apache-2.0, but do not commit or distribute
frontend ONNX files until the license/notice decision is explicit.

## Current Local Result

Status on 2026-05-31: Android/Python parity passed locally for
`haotika-livekit-0.1.0` with the pinned LiveKit commit and these local-only
artifacts:

```text
haotika.onnx
  sha256: 25f70409b16f86a979e751c83932c6d592a374014f96fb40802e09050558b8e3

melspectrogram.onnx
  sha256: ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f

embedding_model.onnx
  sha256: 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
```

Python expected scores:

```text
sample_haotika.wav:        0.9089248180389404
sample_negative_hard.wav:  0.46149030327796936
sample_silence.wav:        0.16630414128303528
```

Android instrumented parity passed on a connected Samsung SM-S938B with
`scoreTolerance = 0.03`. The first install attempt conflicted with an existing
`ru.chaotika.app` package in Samsung Secure Folder, so the successful parity run
used a debug-only application id suffix:

```bash
cd android
./gradlew :app:connectedDebugAndroidTest \
  -PwakewordParityApplicationIdSuffix=.parity \
  -Pandroid.testInstrumentationRunnerArguments.wakewordParity=true \
  -Pandroid.testInstrumentationRunnerArguments.class=ru.chaotika.app.LiveKitAndroidParityInstrumentedTest
```

This confirms the Android frontend/classifier IO path for those exact local
artifacts. On 2026-06-01 the same model was accepted only as a bootstrap
collection model with threshold `0.50`, so it can collect real
`false_accept`/`false_reject` samples. It is not production-quality approval:
ONNX files and WAV fixtures remain ignored/local-only unless a separate
delivery decision tracks the approved binary artifacts.

## How To Obtain Frontend ONNX Artifacts

Set up the isolated training environment:

```bash
cd tools/wakeword-training
./scripts/setup_env.sh
```

Inspect installed LiveKit frontend artifacts:

```bash
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py
```

Copy them into ignored local output only after manual license/notice review:

```bash
.wakeword-venv/bin/python scripts/collect_livekit_frontend_artifacts.py \
  --copy \
  --license-confirmed
```

The local output is:

```text
tools/wakeword-training/output/frontend/
  melspectrogram.onnx
  embedding_model.onnx
  livekit_frontend_metadata.json
```

## Fixture Flow

Use local WAV samples only:

```text
tools/wakeword-training/parity/input/
  sample_haotika.wav
  sample_negative_kotika.wav
  sample_silence_or_noise.wav
```

Generate Python expected values:

```bash
cd tools/wakeword-training
.wakeword-venv/bin/python parity/scripts/generate_python_parity_fixtures.py \
  --model output/haotika-livekit-0.1.0/haotika.onnx \
  --model-version haotika-livekit-0.1.0 \
  --frontend-dir output/frontend \
  --input parity/input \
  --out parity/expected
```

Generated files:

```text
expected/
  livekit_frontend_metadata.json
  sample_haotika_embeddings.npy
  sample_haotika_score.json
  sample_negative_kotika_embeddings.npy
  sample_negative_kotika_score.json
```

Do not commit real audio or generated embeddings/scores without an explicit data
decision.

Tolerance and strictness config:

```text
tools/wakeword-training/parity/parity.config.json
```

Defaults:

- `scoreTolerance`: `0.03`
- shapes: exact match required
- dtypes: exact match required
- axis order: exact match required
- rolling order: latest 16 embeddings, oldest-to-newest

## Android Check

Manual runner instructions:

```text
tools/wakeword-training/parity/scripts/run_android_parity_check.md
```

For each WAV, the Android instrumented parity test:

1. Load the same 16 kHz mono PCM16 audio.
2. Run Android `LiveKitOnnxWakeWordEngine` frontend:
   `melspectrogram.onnx` → `embedding_model.onnx`.
3. Verify model IO names/dtypes/shapes/axis order match the fixture metadata.
4. Run `haotika.onnx`.
5. Compare Android score to Python score with a small tolerance.
6. Verify the rolling buffer passes the latest 16 embeddings in chronological
   oldest-to-newest order, matching Python `embeddings[-16:]`.
7. Verify threshold semantics: `score >= manifest.threshold` means detected.

Acceptance:

- Android score is close to Python score;
- classifier input shape matches `(1, 16, 96)`;
- classifier input name is `embeddings`, output name is `score`;
- classifier/frontend dtypes match exactly;
- frontend model hashes match the pinned metadata;
- positive sample reaches threshold;
- hard-negative sample is close to Python and stays below threshold when Python
  says it should;
- silence/noise sample is close to Python and does not trigger;
- no audio, embeddings, transcript, or full buffers are sent to backend or
  metrics.

If fixtures are missing, the Android parity test is skipped by default with
instructions. If it is explicitly enabled with `wakewordParity=true`, missing
fixtures or missing ONNX assets fail the run.

Until this passes, keep:

```json
{
  "ioContractConfirmedForAndroid": false
}
```
