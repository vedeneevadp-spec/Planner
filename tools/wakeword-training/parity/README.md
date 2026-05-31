# LiveKit Android Parity Fixtures

This directory is for generating parity fixtures between Python
`livekit.wakeword.WakeWordModel` and Android `LiveKitOnnxWakeWordEngine`.

Do not commit real audio samples or generated embeddings/scores without an
explicit data decision.

Pinned source for the first parity baseline:

```text
livekit/livekit-wakeword commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
melspectrogram.onnx sha256: ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f
embedding_model.onnx sha256: 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
```

Expected local layout:

```text
input/
  sample_haotika.wav
  sample_negative_kotika.wav
  sample_silence_or_noise.wav
expected/
  livekit_frontend_metadata.json
  sample_haotika_embeddings.npy
  sample_haotika_score.json
  sample_negative_kotika_score.json
  sample_silence_or_noise_score.json
parity.config.json
scripts/
  generate_python_parity_fixtures.py
  run_android_parity_check.md
```

Generation command:

```bash
cd tools/wakeword-training
.wakeword-venv/bin/python parity/scripts/generate_python_parity_fixtures.py \
  --model output/haotika-livekit-0.1.0/haotika.onnx \
  --model-version haotika-livekit-0.1.0 \
  --frontend-dir output/frontend \
  --input parity/input \
  --out parity/expected
```

The script uses the same Python path as LiveKit runtime:

```text
PCM16 16 kHz
→ melspectrogram.onnx
→ embedding_model.onnx
→ last 16 embeddings
→ haotika.onnx classifier score
```

Each generated score JSON records the pinned commit, frontend/classifier IO
metadata, and rolling window semantics. Android parity must compare against the
same names, dtypes, shapes, axis order, hashes, and oldest-to-newest latest-16
embedding order.

Android parity instructions live in:

```text
scripts/run_android_parity_check.md
```

The Android parity test is opt-in. It skips by default, and fails with clear
instructions when explicitly enabled but WAV/model/expected fixtures are
missing.
