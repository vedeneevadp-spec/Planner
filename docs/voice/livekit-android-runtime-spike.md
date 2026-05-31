# LiveKit Android Runtime Spike

## Goal

This spike checks whether a LiveKit Wakeword classifier can be used in the
Android `WakeWordEngine` path without violating the privacy invariant:

```text
raw 16 kHz PCM
→ embedding frontend
→ rolling window features (16, 96)
→ haotika.onnx classifier
→ score
→ threshold
→ WakeWordDetected
```

No audio should leave the device before `WakeWordDetected`.

## Source References

Inspected source: `livekit/livekit-wakeword` at commit
`1ec7f680df30ff4ca0ebae6b5983441e94b10980`.

- Python inference:
  `src/livekit/wakeword/inference/model.py`
  https://github.com/livekit/livekit-wakeword/blob/1ec7f680df30ff4ca0ebae6b5983441e94b10980/src/livekit/wakeword/inference/model.py
- Python listener:
  `src/livekit/wakeword/inference/listener.py`
  https://github.com/livekit/livekit-wakeword/blob/1ec7f680df30ff4ca0ebae6b5983441e94b10980/src/livekit/wakeword/inference/listener.py
- Feature extraction:
  `src/livekit/wakeword/models/feature_extractor.py`
  https://github.com/livekit/livekit-wakeword/blob/1ec7f680df30ff4ca0ebae6b5983441e94b10980/src/livekit/wakeword/models/feature_extractor.py
- ONNX export:
  `src/livekit/wakeword/export/onnx.py`
  https://github.com/livekit/livekit-wakeword/blob/1ec7f680df30ff4ca0ebae6b5983441e94b10980/src/livekit/wakeword/export/onnx.py
- Swift runtime:
  `swift/Sources/LiveKitWakeWord/WakeWordModel.swift`
  https://github.com/livekit/livekit-wakeword/blob/1ec7f680df30ff4ca0ebae6b5983441e94b10980/swift/Sources/LiveKitWakeWord/WakeWordModel.swift
- Public README runtime notes:
  https://github.com/livekit/livekit-wakeword

## Frontend Model Provenance Gate

The Android frontend models for the first parity pass must come from the same
pinned LiveKit source used for this spike:

```text
repository: livekit/livekit-wakeword
commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
resource path: src/livekit/wakeword/resources/
```

Observed resource metadata at that commit:

| File                   |   Size | SHA-256                                                            |
| ---------------------- | -----: | ------------------------------------------------------------------ |
| `melspectrogram.onnx`  | 1.0 MB | `ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f` |
| `embedding_model.onnx` | 1.3 MB | `70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f` |

The repository `LICENSE` at the pinned commit is Apache-2.0. Before committing
or distributing these ONNX files, keep the license/notice decision explicit and
confirm no additional model-provenance restriction applies. Updating LiveKit or
either frontend model requires updating this commit/hash block and rerunning
Android/Python parity.

## Findings

LiveKit training exports only the classifier head. The exported
`haotika.onnx` is not a raw-audio wake-word model.

Classifier contract:

- input name: `embeddings`
- input kind: embedding matrix
- input dtype: `float32`
- input shape: `(batch, 16, 96)` with dynamic batch
- output name: `score`
- output dtype: `float32`
- output shape: `(batch, 1)` with dynamic batch
- score semantics: `0..1` confidence; detection when `score >= threshold`

Frontend contract before classifier:

- raw audio sample rate: 16,000 Hz
- raw audio dtype: `int16` or `float32`
- raw audio channels: mono
- recommended prediction window: about 2 seconds, 32,000 samples
- mel frontend model: bundled `melspectrogram.onnx`
- mel input: `(batch, samples)` float32 at 16 kHz
- mel output: `(batch, time_frames, 32)`
- mel normalization: output is adjusted with `x / 10 + 2`
- embedding model: bundled `embedding_model.onnx`
- embedding input: `(batch, 76, 32, 1)`
- embedding output: `(batch, 96)` after squeezing `(batch, 1, 1, 96)`
- embedding window: 76 mel frames
- embedding stride: 8 mel frames, about 80 ms
- classifier sequence: last 16 embeddings, shape `(batch, 16, 96)`

IO validation gate:

- classifier input/output names are fixed by LiveKit export:
  `embeddings` -> `score`;
- classifier dtype, rank, batch dimension, axis order, and `(16, 96)` embedding
  layout are validated at session load;
- frontend models are loaded like LiveKit Python loads them: exactly one input
  tensor and one output tensor, using the first tensor name from the model;
- frontend dtype, rank, axis order, mel bin count, embedding window, and
  embedding vector size are validated at session load;
- any mismatch returns typed `ModelIoMismatch`, before background inference is
  allowed to run.

Rolling semantics:

- Python listener captures 1,280-sample frames, 80 ms at 16 kHz.
- It keeps 25 frames, about 2 seconds, before calling `WakeWordModel.predict`.
- `WakeWordModel` itself is stateless. The caller owns the rolling audio
  buffer.
- Python `WakeWordModel` builds embeddings in chronological order, then passes
  `embeddings[-16:]` to the classifier.
- Android `RollingEmbeddingBuffer` must preserve the same order:
  oldest-to-newest among the latest 16 embeddings.
- After a detection, the listener pauses and clears the rolling buffer.

Metrics gate:

- raw audio, transcripts, text, full buffers, raw mel values, and raw embeddings
  are forbidden in telemetry;
- embeddings are internal inference buffers only;
- only provider, modelVersion, frontend, threshold, scoreBucket, errorCode, and
  timing fields are allowed.

## Android Options

### Option A: Java/Kotlin ONNX frontend

Implement LiveKit/openWakeWord preprocessing directly in
`CustomOnnxWakeWordEngine`:

```text
AudioRecord PCM16
→ float32 [-1, 1]
→ melspectrogram.onnx
→ x / 10 + 2
→ 76-frame windows, stride 8
→ embedding_model.onnx
→ last 16 embeddings
→ haotika.onnx
```

Pros:

- stays inside the existing Android `WakeWordEngine` abstraction;
- uses the ONNX Runtime Android dependency already scoped to Android;
- no JNI build/release pipeline;
- easiest path to preserve no-audio-before-wake privacy.

Risks:

- must ship two extra frontend ONNX assets, about 2.3 MB combined in the
  inspected source tree;
- must verify all three ONNX models run with ONNX Runtime Android;
- must exactly match LiveKit windowing and mel normalization;
- needs golden parity tests against Python `WakeWordModel`.

### Option B: Rust/JNI runtime

Use the `livekit-wakeword` Rust crate behind a JNI wrapper.

Pros:

- public README says the Rust crate exposes `WakeWordModel::new` and
  `predict(&audio_chunk)`;
- README says mel and embedding frontend models are compiled into the binary;
- avoids reimplementing preprocessing in Java.

Risks:

- the cloned `livekit/livekit-wakeword` repository did not include Rust source
  files for audit in this spike;
- Android JNI, ABI packaging, crash reporting, and native build caching add a
  new operational surface;
- ONNX Runtime/native dependency handling must be checked per ABI;
- harder to debug than the existing Java engine.

### Option C: Android-friendly TFLite KWS pipeline

Keep LiveKit as training/evaluation only, and use a different Android-friendly
raw-PCM KWS model format for runtime.

Pros:

- can target a single mobile model with raw PCM or simple features;
- avoids a three-stage ONNX chain on Android;
- may be easier to quantize and profile.

Risks:

- loses direct compatibility with LiveKit `haotika.onnx`;
- requires a separate training/export pipeline;
- does not reuse the current LiveKit evaluation reports one-to-one.

## Current Runtime Guard

Manifest now expresses model IO:

```json
{
  "inputKind": "embedding_matrix",
  "frontend": "livekit_openwakeword",
  "ioContractConfirmedForAndroid": false
}
```

`CustomOnnxWakeWordEngine` only supports:

```json
{
  "inputKind": "raw_pcm",
  "frontend": "none"
}
```

If manifest declares `inputKind = embedding_matrix` with
`frontend = livekit_openwakeword`, `WakeWordEngineFactory` routes to
`LiveKitOnnxWakeWordEngine`. That engine runs:

```text
melspectrogram.onnx
→ embedding_model.onnx
→ haotika.onnx
```

If either frontend model is missing, it returns `MissingFrontendModel`. If the
classifier is missing, it returns `MissingModel`. If any model's shape/dtype does
not match the documented contract, it returns `ModelIoMismatch`.

The engine also rejects a loaded ONNX whose first input looks like a LiveKit
classifier, either by input name `embeddings` or shape `(batch, 16, 96)`.

## Recommendation

Recommended next step: Option A.

Build a small Android frontend prototype with three ONNX sessions and a parity
test against Python `WakeWordModel` before any closed rollout approval. The
first acceptance target should be deterministic offline scoring parity on a
small WAV corpus, not background listening.

Keep Option B as a fallback if Android ONNX Runtime cannot execute the frontend
models reliably. Use Option C only if LiveKit-compatible runtime remains too
heavy or unstable for Android.

The Java/Kotlin ONNX frontend path now exists, but `ioContractConfirmedForAndroid`
must remain `false` until [livekit-android-parity.md](livekit-android-parity.md)
passes against Python `WakeWordModel`. `haotika.onnx` must not be treated as an
approved Android model before that parity check.
