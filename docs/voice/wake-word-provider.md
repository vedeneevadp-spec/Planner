# Wake-Word Provider

Документ фиксирует Android wake-word provider для голосового помощника
Chaotika Planner.

## Решение

Wake-фраза одна и фиксированная:

```text
Хаотика
```

Пользователь не выбирает wake-фразу и не задает свою. Это оставляет rollout
измеримым: все false accept / false reject относятся к одной и той же фразе.

Provider-aware runtime:

```text
WakeWordEngine
├── MockWakeWordEngine
├── CustomTfliteWakeWordEngine
├── CustomOnnxWakeWordEngine
└── LiveKitOnnxWakeWordEngine
```

Primary path:

```text
LiveKit Wakeword -> haotika.onnx + LiveKit frontend ONNX -> LiveKitOnnxWakeWordEngine
```

Fallback path:

```text
haotika.tflite -> CustomTfliteWakeWordEngine
```

Dev/test path:

```text
MockWakeWordEngine
```

`WakeWordService` зависит только от `WakeWordEngine`. Он не импортирует ONNX
Runtime или LiteRT classes напрямую.

## Providers

Android enum:

```kotlin
enum class WakeWordProvider {
    MOCK,
    CUSTOM_TFLITE,
    CUSTOM_ONNX
}
```

Factory выбирает реализацию по `provider` из manifest:

- `CUSTOM_ONNX` -> `CustomOnnxWakeWordEngine`
- `CUSTOM_TFLITE` -> `CustomTfliteWakeWordEngine`
- `MOCK` -> `MockWakeWordEngine`

For `CUSTOM_ONNX`, the factory also inspects `inputKind` and `frontend`:

- `raw_pcm` + `none` -> `CustomOnnxWakeWordEngine`
- `embedding_matrix` + `livekit_openwakeword` -> `LiveKitOnnxWakeWordEngine`
- unsupported combinations -> typed `UnsupportedModelInput`

Если provider неизвестен, runtime возвращает typed `UnsupportedProvider`, а не
падает.

## Manifest

Manifest является source of truth для provider, model path и threshold:

```json
{
  "phraseId": "haotika",
  "displayPhrase": "Хаотика",
  "language": "ru-RU",
  "modelVersion": "haotika-livekit-0.1.0",
  "provider": "CUSTOM_ONNX",
  "modelPath": "wakewords/haotika.onnx",
  "inputKind": "embedding_matrix",
  "frontend": "livekit_openwakeword",
  "ioContractConfirmedForAndroid": false,
  "threshold": 0.65,
  "sampleRate": 16000,
  "vadEnabled": true,
  "runtime": {
    "frameMs": 80,
    "windowMs": 2000,
    "scoreSmoothing": true
  }
}
```

Обязательные поля:

- `phraseId`
- `displayPhrase`
- `language`
- `modelVersion`
- `provider`
- `modelPath`
- `threshold`
- `sampleRate`
- `vadEnabled`

Optional IO contract fields:

- `inputKind`: `raw_pcm` or `embedding_matrix`;
- `frontend`: `none` or `livekit_openwakeword`;
- `ioContractConfirmedForAndroid`: `true` only after the Android runtime path
  is proven against the model.

For LiveKit models, manifest also declares the three ONNX files:

```json
{
  "models": {
    "melspectrogram": "wakewords/livekit/melspectrogram.onnx",
    "embedding": "wakewords/livekit/embedding_model.onnx",
    "classifier": "wakewords/haotika.onnx"
  },
  "frontendConfig": {
    "embeddingWindowSize": 16,
    "embeddingSize": 96
  }
}
```

Правила:

- threshold берется только из manifest;
- пользовательский override чувствительности не применяется в закрытом rollout;
- approved manifest должен использовать конкретный `modelVersion`, например
  `haotika-livekit-0.1.0`; `pending-trained-model`, `pending` и `unknown`
  запрещены для копирования в Android assets;
- `modelVersion` попадает только в safe diagnostics/metrics;
- отсутствующий model asset возвращает `MissingModel`;
- LiveKit classifier manifest с `inputKind = embedding_matrix` и
  `frontend = livekit_openwakeword` выбирает `LiveKitOnnxWakeWordEngine`;
- если frontend-файлы отсутствуют, runtime возвращает `MissingFrontendModel`;
- невалидный manifest возвращает `InvalidModelManifest`.

## Model IO Contract

Перед approval модели нужно подтвердить ONNX input/output contract:

- input shape
- input dtype
- frame/window size
- sample rate
- normalization
- output score shape
- score interpretation
- threshold semantics

`CustomOnnxWakeWordEngine` поддерживает только raw audio contract: 16 kHz mono
PCM16 из Android `AudioRecord`, conversion в float32 `[-1, 1]`, latest window и
score как первый scalar output. LiveKit export является classifier head с input
`embeddings` `(batch, 16, 96)`, поэтому `WakeWordEngineFactory` выбирает
`LiveKitOnnxWakeWordEngine` для `inputKind = embedding_matrix` +
`frontend = livekit_openwakeword`.

`LiveKitOnnxWakeWordEngine` запускает `melspectrogram.onnx`,
`embedding_model.onnx` и затем `haotika.onnx`. Если frontend-файлов нет, runtime
возвращает `MissingFrontendModel`; если classifier отсутствует - `MissingModel`;
если shape/dtype не совпадают - `ModelIoMismatch`.

Pinned first parity source:

```text
livekit/livekit-wakeword commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
```

Classifier names are fixed by LiveKit export: input `embeddings`, output
`score`. Frontend model input/output names are read from the ONNX files like the
Python runtime does, but parity fixtures must record those names, dtypes, shapes,
axis order, and hashes before rollout.

Подробности spike: [livekit-android-runtime-spike.md](livekit-android-runtime-spike.md).
Parity protocol: [livekit-android-parity.md](livekit-android-parity.md).

## Runtime Flow

Production flow не меняется:

```text
WakeWordService
→ WakeWordEngine
→ WakeWordDetected
→ pause wake listening
→ short local start signal + haptic + overlay “Слушаю”
→ CommandAudioRecorder
→ local validation
→ backend STT
→ PlannerIntent
→ confirmation UI
→ action layer
→ visual result
```

До `WakeWordDetected` аудио не отправляется на backend. Wake-word engine
обрабатывает 16 kHz mono audio локально, хранит рабочий ring buffer только в
памяти и не пишет аудио в metrics.

## Assets

Tracked files:

```text
android/app/src/main/assets/wakewords/README.md
android/app/src/main/assets/wakewords/haotika_manifest.json
```

Generated model files are ignored by default:

```text
android/app/src/main/assets/wakewords/haotika.onnx
android/app/src/main/assets/wakewords/haotika.tflite
android/app/src/main/assets/wakewords/livekit/melspectrogram.onnx
android/app/src/main/assets/wakewords/livekit/embedding_model.onnx
```

Only copy an approved closed-rollout model into assets locally after evaluation.
If a chosen rollout model must be committed, that needs an explicit
product/security decision.

## Errors

Wake-word errors are typed:

- `MissingModel`
- `MissingFrontendModel`
- `ModelLoadError`
- `ModelIoMismatch`
- `InvalidModelManifest`
- `InferenceError`
- `FrontendNotReady`
- `UnsupportedSampleRate`
- `UnsupportedModelInput`
- `UnsupportedProvider`
- `MicrophonePermissionDenied`
- `ForegroundServiceNotAllowed`
- `TfliteRuntimeInitError`

Wake-word errors must not execute a user command. If wake word is unavailable,
push-to-talk remains available when microphone permission exists.

## Safe Metrics

Allowed wake-word runtime events:

- `wake_engine_started`
- `wake_engine_stopped`
- `wake_engine_error`
- `wake_detection_latency_ms`
- `wake_model_loaded`
- `wake_model_missing`
- `wake_score_bucket`
- `livekit_frontend_loaded`
- `livekit_frontend_missing`
- `livekit_embedding_generated`
- `livekit_classifier_score_bucket`
- `livekit_model_io_mismatch`
- `livekit_parity_test_result`

Allowed fields:

- `provider`
- `modelVersion`
- `threshold`
- `frontend`
- `scoreBucket`
- `errorCode`
- `durationMs`

Forbidden fields:

- raw audio
- transcript
- raw text
- raw embeddings
- raw mel values
- task title
- shopping item
- agenda item
- full audio buffer

## Real-World Sample Collection

Opt-in sample collection is local to Android app-specific storage:

```text
/sdcard/Android/data/ru.chaotika.app/files/wakeword/haotika/real-world/
```

Mapping for training:

- `true_accept` -> positive samples
- `false_reject` -> positive samples
- `false_accept` -> hard negative samples
- skipped samples -> not used

After every successful phone pull into timestamp staging and successful local
`rsync --ignore-existing`, copied recordings should be deleted from the phone so
the next training run contains only new examples. Do not delete phone recordings
if pull or rsync failed.

## Training

Training lives outside Android runtime:

```text
tools/wakeword-training/
```

See [wake-word-training.md](wake-word-training.md) for LiveKit config,
evaluation protocol, hard negatives, versioning, and copy-to-assets workflow.

Android does not train. Android only runs the selected local model offline.

## Tests

Minimum coverage:

- `CUSTOM_ONNX` manifest parses correctly;
- provider factory creates `CustomOnnxWakeWordEngine` for `raw_pcm` ONNX;
- provider factory creates `LiveKitOnnxWakeWordEngine` for
  `embedding_matrix` + `livekit_openwakeword`;
- missing `haotika.onnx` returns `MissingModel`;
- missing LiveKit frontend model returns `MissingFrontendModel`;
- unsupported LiveKit frontend combination returns `UnsupportedModelInput`;
- `WakeWordService` depends on `WakeWordEngine`;
- `CUSTOM_TFLITE` still maps to `CustomTfliteWakeWordEngine`;
- `MOCK` still works for tests/dev;
- threshold is read from manifest;
- safe diagnostics expose `modelVersion` and provider;
- no upload occurs before `WakeWordDetected`;
- push-to-talk remains available if model is missing.
