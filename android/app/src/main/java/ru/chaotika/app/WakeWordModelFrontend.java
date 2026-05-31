package ru.chaotika.app;

enum WakeWordModelFrontend {
    NONE("none"),
    LIVEKIT_OPENWAKEWORD("livekit_openwakeword");

    final String manifestValue;

    WakeWordModelFrontend(String manifestValue) {
        this.manifestValue = manifestValue;
    }

    static WakeWordModelFrontend fromManifestValue(String value) throws WakeWordError {
        for (WakeWordModelFrontend frontend : values()) {
            if (frontend.manifestValue.equals(value)) {
                return frontend;
            }
        }

        throw WakeWordError.invalidModelManifest("Unsupported wake-word model frontend: " + value, null);
    }
}
