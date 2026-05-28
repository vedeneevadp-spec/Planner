# Wakeword Assets

This directory is reserved for the Android wake-word model.

Expected production model:

```text
haotika.tflite
```

The model is intentionally not committed until a real trained model is
available. `CustomTfliteWakeWordEngine` must return a `MissingModel` error when
`wakewords/haotika.tflite` is absent.
