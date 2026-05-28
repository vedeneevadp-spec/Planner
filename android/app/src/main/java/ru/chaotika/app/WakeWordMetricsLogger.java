package ru.chaotika.app;

import android.util.Log;

final class WakeWordMetricsLogger {

    static final String WAKE_DETECTED = "wake_detected";
    static final String FALSE_ACCEPT_REPORTED = "false_accept_reported";
    static final String FALSE_REJECT_REPORTED = "false_reject_reported";
    static final String TRUE_ACCEPT_REPORTED = "true_accept_reported";
    static final String TRAINING_EXAMPLE_SAVED = "training_example_saved";
    static final String MODEL_MISSING = "model_missing";
    static final String SERVICE_START_ERROR = "service_start_error";
    static final String INFERENCE_ERROR = "inference_error";

    private static final String TAG = "ChaotikaWakeWord";

    void wakeDetected(WakeWordDetection detection) {
        log(WAKE_DETECTED, "score=" + detection.score + ", phraseId=" + detection.phraseId);
    }

    void falseAcceptReported() {
        log(FALSE_ACCEPT_REPORTED, "reported=true");
    }

    void falseRejectReported() {
        log(FALSE_REJECT_REPORTED, "reported=true");
    }

    void trueAcceptReported() {
        log(TRUE_ACCEPT_REPORTED, "reported=true");
    }

    void trainingExampleSaved(String label) {
        log(TRAINING_EXAMPLE_SAVED, "label=" + label);
    }

    void error(WakeWordError error) {
        String event = switch (error.code) {
            case MISSING_MODEL -> MODEL_MISSING;
            case FOREGROUND_SERVICE_NOT_ALLOWED -> SERVICE_START_ERROR;
            case INFERENCE_ERROR, TFLITE_RUNTIME_INIT_ERROR -> INFERENCE_ERROR;
            case INVALID_MODEL_MANIFEST, MICROPHONE_PERMISSION_DENIED -> error.code.value;
        };

        log(event, error.getMessage());
    }

    void log(String event, String details) {
        WakeWordDiagnostics.recordMetric(event);
        try {
            Log.i(TAG, event + (details == null || details.trim().isEmpty() ? "" : ": " + details));
        } catch (RuntimeException ignored) {
            // Local JVM unit tests do not provide Android Log implementation.
        }
    }
}
