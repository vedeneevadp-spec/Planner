package ru.chaotika.app;

enum AndroidVoiceRuntimeError {
    MISSING_MICROPHONE_PERMISSION("missing_microphone_permission"),
    MISSING_NOTIFICATION_PERMISSION("missing_notification_permission"),
    MISSING_WAKE_MODEL("missing_wake_model"),
    UNSUPPORTED_WAKE_MODEL_INPUT("unsupported_wake_model_input"),
    FOREGROUND_SERVICE_NOT_ALLOWED("foreground_service_not_allowed"),
    BATTERY_RESTRICTED("battery_restricted"),
    SECURITY_EXCEPTION("security_exception"),
    WAKE_ENGINE_ERROR("wake_engine_error"),
    AUDIO_SIGNAL_ERROR("audio_signal_error"),
    RECORDER_ERROR("recorder_error");

    final String value;

    AndroidVoiceRuntimeError(String value) {
        this.value = value;
    }

    static AndroidVoiceRuntimeError fromWakeWordError(WakeWordError error) {
        return switch (error.code) {
            case MISSING_MODEL -> MISSING_WAKE_MODEL;
            case MISSING_FRONTEND_MODEL -> MISSING_WAKE_MODEL;
            case UNSUPPORTED_MODEL_INPUT -> UNSUPPORTED_WAKE_MODEL_INPUT;
            case MICROPHONE_PERMISSION_DENIED -> MISSING_MICROPHONE_PERMISSION;
            case FOREGROUND_SERVICE_NOT_ALLOWED -> FOREGROUND_SERVICE_NOT_ALLOWED;
            case FRONTEND_NOT_READY, INFERENCE_ERROR, INVALID_MODEL_MANIFEST, MODEL_IO_MISMATCH, MODEL_LOAD_ERROR, TFLITE_RUNTIME_INIT_ERROR, UNSUPPORTED_PROVIDER, UNSUPPORTED_SAMPLE_RATE -> WAKE_ENGINE_ERROR;
        };
    }

    static AndroidVoiceRuntimeError fromSttError(SttException error) {
        if (error.code == SttError.PERMISSION_DENIED) {
            return MISSING_MICROPHONE_PERMISSION;
        }

        return RECORDER_ERROR;
    }

    static AndroidVoiceRuntimeError fromServiceStartFailure(Throwable error) {
        if (error instanceof SecurityException) {
            return SECURITY_EXCEPTION;
        }

        return FOREGROUND_SERVICE_NOT_ALLOWED;
    }
}
