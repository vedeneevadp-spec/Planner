package ru.chaotika.app;

enum WakeWordProvider {
    MOCK("MOCK", "mock"),
    CUSTOM_TFLITE("CUSTOM_TFLITE", "custom_tflite"),
    CUSTOM_ONNX("CUSTOM_ONNX", "custom_onnx");

    final String manifestValue;
    final String metricValue;

    WakeWordProvider(String manifestValue, String metricValue) {
        this.manifestValue = manifestValue;
        this.metricValue = metricValue;
    }

    static WakeWordProvider fromManifestValue(String value) throws WakeWordError {
        for (WakeWordProvider provider : values()) {
            if (provider.manifestValue.equals(value)) {
                return provider;
            }
        }

        throw WakeWordError.unsupportedProvider(value);
    }
}
