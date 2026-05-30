package ru.chaotika.app;

enum AndroidVoiceRuntimeMetric {
    WAKE_SERVICE_STARTED("wake_service_started"),
    WAKE_SERVICE_STOPPED("wake_service_stopped"),
    WAKE_SERVICE_START_FAILED("wake_service_start_failed"),
    WAKE_SERVICE_RUNTIME_MINUTES("wake_service_runtime_minutes"),
    WAKE_ENGINE_STARTED("wake_engine_started"),
    WAKE_ENGINE_STOPPED("wake_engine_stopped"),
    WAKE_ENGINE_ERROR("wake_engine_error"),
    WAKE_DETECTION_LATENCY_MS("wake_detection_latency_ms"),
    COMMAND_RECORDER_START_LATENCY_MS("command_recorder_start_latency_ms"),
    AUDIO_CUE_DURATION_MS("audio_cue_duration_ms"),
    AUDIO_CUE_TO_RECORDER_DELAY_MS("audio_cue_to_recorder_delay_ms"),
    BATTERY_SAMPLE("battery_sample"),
    CPU_SAMPLE("cpu_sample"),
    MEMORY_SAMPLE("memory_sample"),
    SERVICE_KILLED_OR_RESTARTED("service_killed_or_restarted"),
    GRACEFUL_DEGRADATION_USED("graceful_degradation_used");

    final String value;

    AndroidVoiceRuntimeMetric(String value) {
        this.value = value;
    }
}
