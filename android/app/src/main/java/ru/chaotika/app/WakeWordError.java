package ru.chaotika.app;

final class WakeWordError extends Exception {

    enum Code {
        MISSING_MODEL("missing_model"),
        MISSING_FRONTEND_MODEL("missing_frontend_model"),
        INVALID_MODEL_MANIFEST("invalid_model_manifest"),
        MODEL_LOAD_ERROR("model_load_error"),
        MODEL_IO_MISMATCH("model_io_mismatch"),
        MICROPHONE_PERMISSION_DENIED("microphone_permission_denied"),
        FOREGROUND_SERVICE_NOT_ALLOWED("foreground_service_not_allowed"),
        FRONTEND_NOT_READY("frontend_not_ready"),
        TFLITE_RUNTIME_INIT_ERROR("tflite_runtime_init_error"),
        INFERENCE_ERROR("inference_error"),
        UNSUPPORTED_SAMPLE_RATE("unsupported_sample_rate"),
        UNSUPPORTED_MODEL_INPUT("unsupported_model_input"),
        UNSUPPORTED_PROVIDER("unsupported_provider");

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

    static WakeWordError missingFrontendModel(String modelPath) {
        return new WakeWordError(Code.MISSING_FRONTEND_MODEL, "Wake-word frontend model is missing: " + modelPath);
    }

    static WakeWordError invalidModelManifest(String message, Throwable cause) {
        return new WakeWordError(Code.INVALID_MODEL_MANIFEST, message, cause);
    }

    static WakeWordError modelLoadError(String provider, Throwable cause) {
        return new WakeWordError(Code.MODEL_LOAD_ERROR, "Failed to load " + provider + " wake-word model.", cause);
    }

    static WakeWordError modelIoMismatch(String message) {
        return new WakeWordError(Code.MODEL_IO_MISMATCH, message);
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

    static WakeWordError frontendNotReady(String message) {
        return new WakeWordError(Code.FRONTEND_NOT_READY, message);
    }

    static WakeWordError unsupportedSampleRate(int sampleRate) {
        return new WakeWordError(Code.UNSUPPORTED_SAMPLE_RATE, "Unsupported wake-word sample rate: " + sampleRate);
    }

    static WakeWordError unsupportedModelInput(String message) {
        return new WakeWordError(Code.UNSUPPORTED_MODEL_INPUT, message);
    }

    static WakeWordError unsupportedProvider(String provider) {
        return new WakeWordError(Code.UNSUPPORTED_PROVIDER, "Unsupported wake-word provider: " + provider);
    }
}
