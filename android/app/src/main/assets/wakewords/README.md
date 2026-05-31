# Wakeword Assets

This directory is reserved for the Android wake-word model and provider-aware
manifest.

Primary closed-rollout model:

```text
haotika.onnx
```

Fallback model path retained for future experiments:

```text
haotika.tflite
```

Model files are intentionally not committed. `CustomTfliteWakeWordEngine` and
raw-PCM `CustomOnnxWakeWordEngine` manifests must return `MissingModel` when
the manifest points to an absent asset. `CustomOnnxWakeWordEngine` must return
`UnsupportedModelInput` for LiveKit classifier manifests until the Android
`livekit_openwakeword` frontend is implemented.
