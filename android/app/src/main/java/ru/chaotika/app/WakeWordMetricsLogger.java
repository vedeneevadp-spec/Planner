package ru.chaotika.app;

import android.util.Log;

final class WakeWordMetricsLogger {

    static final String WAKE_DETECTED = "wake_detected";
    static final String FALSE_ACCEPT_REPORTED = "false_accept_reported";
    static final String FALSE_REJECT_REPORTED = "false_reject_reported";
    static final String TRUE_ACCEPT_REPORTED = "true_accept_reported";
    static final String TRAINING_EXAMPLE_SAVED = "training_example_saved";
    static final String MODEL_LOADED = "wake_model_loaded";
    static final String MODEL_MISSING = "wake_model_missing";
    static final String LIVEKIT_FRONTEND_LOADED = "livekit_frontend_loaded";
    static final String LIVEKIT_FRONTEND_MISSING = "livekit_frontend_missing";
    static final String LIVEKIT_EMBEDDING_GENERATED = "livekit_embedding_generated";
    static final String LIVEKIT_CLASSIFIER_SCORE_BUCKET = "livekit_classifier_score_bucket";
    static final String LIVEKIT_MODEL_IO_MISMATCH = "livekit_model_io_mismatch";
    static final String LIVEKIT_PARITY_TEST_RESULT = "livekit_parity_test_result";
    static final String SERVICE_START_ERROR = "service_start_error";
    static final String INFERENCE_ERROR = "inference_error";
    static final String SCORE_BUCKET = "wake_score_bucket";

    private static final String TAG = "ChaotikaWakeWord";

    void wakeDetected(WakeWordDetection detection) {
        log(WAKE_DETECTED, "score=" + detection.score + ", phraseId=" + detection.phraseId);
    }

    void modelLoaded(WakeWordModelManifest manifest) {
        log(
            MODEL_LOADED,
            "provider=" + manifest.provider.metricValue + ", modelVersion=" + manifest.modelVersion + ", threshold=" + manifest.threshold
        );
    }

    void scoreBucket(WakeWordProvider provider, float score) {
        log(SCORE_BUCKET, "provider=" + provider.metricValue + ", scoreBucket=" + scoreBucket(score));
    }

    void liveKitFrontendLoaded(WakeWordModelManifest manifest) {
        log(
            LIVEKIT_FRONTEND_LOADED,
            "provider=" + manifest.provider.metricValue + ", modelVersion=" + manifest.modelVersion + ", frontend=" + manifest.frontend.manifestValue
        );
    }

    void liveKitEmbeddingGenerated(WakeWordModelManifest manifest) {
        log(
            LIVEKIT_EMBEDDING_GENERATED,
            "provider=" + manifest.provider.metricValue + ", modelVersion=" + manifest.modelVersion + ", frontend=" + manifest.frontend.manifestValue
        );
    }

    void liveKitClassifierScoreBucket(WakeWordModelManifest manifest, float score) {
        log(
            LIVEKIT_CLASSIFIER_SCORE_BUCKET,
            "provider=" + manifest.provider.metricValue + ", modelVersion=" + manifest.modelVersion + ", scoreBucket=" + scoreBucket(score)
        );
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
            case MISSING_FRONTEND_MODEL -> LIVEKIT_FRONTEND_MISSING;
            case FOREGROUND_SERVICE_NOT_ALLOWED -> SERVICE_START_ERROR;
            case INFERENCE_ERROR, MODEL_LOAD_ERROR, TFLITE_RUNTIME_INIT_ERROR -> INFERENCE_ERROR;
            case MODEL_IO_MISMATCH -> LIVEKIT_MODEL_IO_MISMATCH;
            case FRONTEND_NOT_READY, INVALID_MODEL_MANIFEST, MICROPHONE_PERMISSION_DENIED, UNSUPPORTED_MODEL_INPUT, UNSUPPORTED_PROVIDER, UNSUPPORTED_SAMPLE_RATE -> error.code.value;
        };

        log(event, error.getMessage());
    }

    private static String scoreBucket(float score) {
        if (score < 0.5f) {
            return "low";
        }

        if (score < 0.85f) {
            return "medium";
        }

        return "high";
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
