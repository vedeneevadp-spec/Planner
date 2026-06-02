package ru.chaotika.app;

import android.util.Log;

final class SttMetricsLogger {

    private static final String TAG = "PlannerStt";

    void recordingStarted() {
        log("stt_recording_started");
    }

    void recordingStopped(CommandAudio audio) {
        log(
            "stt_recording_stopped durationMs=" +
            audio.durationMs +
            " recordingDurationMs=" +
            audio.recordingDurationMs +
            " prebufferMs=" +
            audio.preBufferMs +
            " byteLength=" +
            audio.byteLength()
        );
    }

    void localValidationFailed(SttException error) {
        log("stt_local_validation_failed code=" + error.code);

        if (error.code == SttError.NO_SPEECH) {
            log("stt_upload_skipped_no_speech");
        } else if (error.code == SttError.TOO_SHORT) {
            log("stt_upload_skipped_too_short");
        } else if (error.code == SttError.TOO_QUIET) {
            log("stt_upload_skipped_too_quiet");
        } else if (error.code == SttError.PRIVACY_BLOCKED) {
            log("voice_audio_upload_blocked");
        }
    }

    void uploadStarted(CommandAudio audio) {
        log("stt_upload_started durationMs=" + audio.durationMs + " byteLength=" + audio.byteLength());
    }

    void uploadCompleted(SttResult result) {
        log("stt_upload_completed provider=" + result.provider + " durationMs=" + result.durationMs);
        log("stt_billable_request_estimated seconds=" + Math.max(1, (int) Math.ceil(result.durationMs / 1000d)));
    }

    void error(SttException error) {
        log("stt_error code=" + error.code);
    }

    void lowConfidence(SttResult result) {
        log("stt_low_confidence confidence=" + result.confidence);
    }

    void fallbackUsed(SttProvider provider) {
        log("stt_fallback_used provider=" + provider);
    }

    private void log(String message) {
        Log.i(TAG, message);
    }
}
