package ru.chaotika.app;

final class WakeWordError extends Exception {

    enum Code {
        MISSING_MODEL("missing_model"),
        INVALID_MODEL_MANIFEST("invalid_model_manifest"),
        MICROPHONE_PERMISSION_DENIED("microphone_permission_denied"),
        FOREGROUND_SERVICE_NOT_ALLOWED("foreground_service_not_allowed"),
        TFLITE_RUNTIME_INIT_ERROR("tflite_runtime_init_error"),
        INFERENCE_ERROR("inference_error");

        final String value;

        Code(String value) {
            this.value = value;
        }
    }

    final Code code;

    WakeWordError(Code code, String message) {
        super(message);
        this.code = code;
    }

    WakeWordError(Code code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    static WakeWordError missingModel(String modelPath) {
        return new WakeWordError(Code.MISSING_MODEL, "Wake-word model is missing: " + modelPath);
    }

    static WakeWordError invalidModelManifest(String message, Throwable cause) {
        return new WakeWordError(Code.INVALID_MODEL_MANIFEST, message, cause);
    }

    static WakeWordError microphonePermissionDenied() {
        return new WakeWordError(Code.MICROPHONE_PERMISSION_DENIED, "Microphone permission was denied.");
    }

    static WakeWordError foregroundServiceNotAllowed(Throwable cause) {
        return new WakeWordError(
            Code.FOREGROUND_SERVICE_NOT_ALLOWED,
            "Android did not allow starting the microphone foreground service.",
            cause
        );
    }

    static WakeWordError tfliteRuntimeInitError(Throwable cause) {
        return new WakeWordError(Code.TFLITE_RUNTIME_INIT_ERROR, "Failed to initialize LiteRT runtime.", cause);
    }

    static WakeWordError inferenceError(Throwable cause) {
        return new WakeWordError(Code.INFERENCE_ERROR, "Wake-word inference failed.", cause);
    }
}
