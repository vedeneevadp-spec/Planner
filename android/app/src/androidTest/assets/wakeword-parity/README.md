# Android Wake-Word Parity Test Assets

This directory is intentionally empty in git.

For local `connectedDebugAndroidTest` parity runs, copy only local fixtures:

```text
input/*.wav
expected/*_score.json
parity.config.json
```

Do not commit real audio, expected score JSON, generated embeddings, or ONNX
model files without an explicit data decision.
