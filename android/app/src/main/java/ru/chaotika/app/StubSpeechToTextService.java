package ru.chaotika.app;

import android.os.Handler;
import android.os.Looper;

final class StubSpeechToTextService implements SpeechToTextService {

    private static final long STUB_TRANSCRIPT_DELAY_MS = 450L;
    private static final String STUB_TRANSCRIPT = "добавь задачу проверить голосового помощника";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingResult;

    @Override
    public void captureShortCommand(Callback callback) {
        stop();
        // TODO: Replace with real short-command STT after wake-word detection.
        // This stub does not capture or upload audio; it only simulates the
        // transcript handoff path into the shared PlannerIntentParser.
        pendingResult = () -> {
            pendingResult = null;
            callback.onTranscript(STUB_TRANSCRIPT);
        };
        handler.postDelayed(pendingResult, STUB_TRANSCRIPT_DELAY_MS);
    }

    @Override
    public void stop() {
        if (pendingResult != null) {
            handler.removeCallbacks(pendingResult);
            pendingResult = null;
        }
    }
}
