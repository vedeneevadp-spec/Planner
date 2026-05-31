# LiveKit Frontend Assets

Expected files for the Android LiveKit-compatible wake-word frontend:

```text
melspectrogram.onnx
embedding_model.onnx
```

Expected source for the first parity pass:

```text
repository: livekit/livekit-wakeword
commit: 1ec7f680df30ff4ca0ebae6b5983441e94b10980
source path: src/livekit/wakeword/resources/
license observed at that commit: Apache-2.0
```

Observed file metadata from that pinned commit:

```text
melspectrogram.onnx: 1.0 MB, sha256 ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f
embedding_model.onnx: 1.3 MB, sha256 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
```

The selected wake-word classifier remains:

```text
../haotika.onnx
```

Do not commit these model files until the license and rollout packaging
decision are explicitly approved. `LiveKitOnnxWakeWordEngine` returns
`MissingFrontendModel` when either frontend model is absent.

Before any Android closed rollout, regenerate parity fixtures from the same
pinned commit or intentionally update the commit/hash in docs and rerun parity.
