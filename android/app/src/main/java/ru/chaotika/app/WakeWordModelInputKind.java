package ru.chaotika.app;

enum WakeWordModelInputKind {
    RAW_PCM("raw_pcm"),
    EMBEDDING_MATRIX("embedding_matrix");

    final String manifestValue;

    WakeWordModelInputKind(String manifestValue) {
        this.manifestValue = manifestValue;
    }

    static WakeWordModelInputKind fromManifestValue(String value) throws WakeWordError {
        for (WakeWordModelInputKind kind : values()) {
            if (kind.manifestValue.equals(value)) {
                return kind;
            }
        }

        throw WakeWordError.invalidModelManifest("Unsupported wake-word model inputKind: " + value, null);
    }
}
