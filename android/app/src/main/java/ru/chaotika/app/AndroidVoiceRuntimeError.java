package ru.chaotika.app;

enum AndroidVoiceRuntimeError {
    MISSING_MICROPHONE_PERMISSION("missing_microphone_permission"),
    MISSING_NOTIFICATION_PERMISSION("missing_notification_permission"),
    MISSING_WAKE_MODEL("missing_wake_model"),
    FOREGROUND_SERVICE_NOT_ALLOWED("foreground_service_not_allowed"),
    BATTERY_RESTRICTED("battery_restricted"),
    SECURITY_EXCEPTION("security_exception"),
    WAKE_ENGINE_ERROR("wake_engine_error"),
    AUDIO_CUE_ERROR("audio_cue_error"),
    RECORDER_ERROR("recorder_error");

    final String value;

    AndroidVoiceRuntimeError(String value) {
        this.value = value;
    }

    static AndroidVoiceRuntimeError fromWakeWordError(WakeWordError error) {
        return switch (error.code) {
            case MISSING_MODEL -> MISSING_WAKE_MODEL;
            case MICROPHONE_PERMISSION_DENIED -> MISSING_MICROPHONE_PERMISSION;
            case FOREGROUND_SERVICE_NOT_ALLOWED -> FOREGROUND_SERVICE_NOT_ALLOWED;
            case INFERENCE_ERROR, INVALID_MODEL_MANIFEST, TFLITE_RUNTIME_INIT_ERROR -> WAKE_ENGINE_ERROR;
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
