package ru.chaotika.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.SoundPool;
import android.os.Handler;
import android.os.SystemClock;

final class AudioFeedbackPlayer {

    static final int START_SIGNAL_DURATION_MS = 70;
    static final int SUCCESS_SIGNAL_DURATION_MS = 110;
    private static final long RELEASE_PADDING_MS = 250L;
    private static final long START_SIGNAL_LOAD_GRACE_MS = 40L;
    private static final long SUCCESS_SIGNAL_LOAD_GRACE_MS = 500L;
    private static final float SIGNAL_VOLUME = 0.38f;

    private final Context context;
    private final Handler handler;
    private final SoundPool soundPool;
    private final int startSignalId;
    private final int successSignalId;
    private boolean isEnabled = true;
    private boolean isReleased;
    private int playbackGeneration;
    private PendingStartSignal pendingStartSignal;
    private PendingSuccessSignal pendingSuccessSignal;
    private boolean startSignalLoaded;
    private boolean successSignalLoaded;

    AudioFeedbackPlayer(Context context, Handler handler) {
        this.context = context.getApplicationContext();
        this.handler = handler;
        soundPool = new SoundPool.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .build()
            )
            .setMaxStreams(2)
            .build();
        soundPool.setOnLoadCompleteListener(this::handleLoadComplete);
        startSignalId = soundPool.load(this.context, R.raw.voice_signal_start, 1);
        successSignalId = soundPool.load(this.context, R.raw.voice_signal_success, 1);
    }

    static void playSuccessSignal(Context context, Handler handler, AudioSignalCallback afterSignal) {
        AudioFeedbackPlayer player = new AudioFeedbackPlayer(context, handler);
        player.playSuccessSignal((playback) -> {
            afterSignal.onComplete(playback);
            handler.postDelayed(player::release, SUCCESS_SIGNAL_DURATION_MS + RELEASE_PADDING_MS);
        });
    }

    void playStartSignalBefore(AudioSignalCallback afterSignal) {
        if (!isEnabled || isReleased || shouldSuppressAudioCue(context)) {
            recordSuppressed(context);
            completeSignal(afterSignal, false, false, 0, SystemClock.elapsedRealtime());
            return;
        }

        if (startSignalLoaded) {
            playLoadedStartSignal(afterSignal);
            return;
        }

        cancelPendingStartSignal();
        int generation = playbackGeneration;
        long requestedAtElapsedMs = SystemClock.elapsedRealtime();
        PendingStartSignal pending = new PendingStartSignal(afterSignal, generation, requestedAtElapsedMs);

        pending.timeout = () -> {
            if (pendingStartSignal != pending || generation != playbackGeneration) {
                return;
            }

            pendingStartSignal = null;
            recordSignalError(context);
            afterSignal.onComplete(
                new AudioSignalPlayback(
                    false,
                    true,
                    0,
                    requestedAtElapsedMs,
                    SystemClock.elapsedRealtime()
                )
            );
        };
        pendingStartSignal = pending;
        handler.postDelayed(pending.timeout, START_SIGNAL_LOAD_GRACE_MS);
    }

    AudioSignalPlayback playStartSignalNow() {
        long requestedAtElapsedMs = SystemClock.elapsedRealtime();

        if (!isEnabled || isReleased || shouldSuppressAudioCue(context)) {
            recordSuppressed(context);
            return new AudioSignalPlayback(false, false, 0, requestedAtElapsedMs, requestedAtElapsedMs);
        }

        if (!startSignalLoaded) {
            recordSignalError(context);
            return new AudioSignalPlayback(false, true, 0, requestedAtElapsedMs, requestedAtElapsedMs);
        }

        long startedAtElapsedMs = SystemClock.elapsedRealtime();
        boolean played = playSignal(startSignalId);

        if (!played) {
            recordSignalError(context);
            return new AudioSignalPlayback(false, true, 0, startedAtElapsedMs, startedAtElapsedMs);
        }

        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_START_PLAYED);
        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.START_SIGNAL_DURATION_MS,
            START_SIGNAL_DURATION_MS
        );

        return new AudioSignalPlayback(
            true,
            false,
            START_SIGNAL_DURATION_MS,
            startedAtElapsedMs,
            startedAtElapsedMs + START_SIGNAL_DURATION_MS
        );
    }

    void playSuccessSignal(AudioSignalCallback afterSignal) {
        long requestedAtElapsedMs = SystemClock.elapsedRealtime();

        if (!isEnabled || isReleased || shouldSuppressAudioCue(context)) {
            recordSuppressed(context);
            completeSignal(afterSignal, false, false, 0, requestedAtElapsedMs);
            return;
        }

        if (successSignalLoaded) {
            playLoadedSuccessSignal(afterSignal);
            return;
        }

        cancelPendingSuccessSignal();
        int generation = playbackGeneration;
        PendingSuccessSignal pending = new PendingSuccessSignal(afterSignal, generation, requestedAtElapsedMs);

        pending.timeout = () -> {
            if (pendingSuccessSignal != pending || generation != playbackGeneration) {
                return;
            }

            pendingSuccessSignal = null;
            recordSignalError(context);
            completeSignal(afterSignal, false, true, 0, requestedAtElapsedMs);
        };
        pendingSuccessSignal = pending;
        handler.postDelayed(pending.timeout, SUCCESS_SIGNAL_LOAD_GRACE_MS);
    }

    void setEnabled(boolean isEnabled) {
        this.isEnabled = isEnabled;

        if (!isEnabled) {
            cancelPendingStartSignal();
            cancelPendingSuccessSignal();
        }
    }

    void release() {
        if (isReleased) {
            return;
        }

        playbackGeneration++;
        cancelPendingStartSignal();
        cancelPendingSuccessSignal();
        isReleased = true;
        soundPool.release();
    }

    private void handleLoadComplete(SoundPool ignoredSoundPool, int sampleId, int status) {
        if (isReleased) {
            return;
        }

        boolean loaded = status == 0;

        if (sampleId == startSignalId) {
            startSignalLoaded = loaded;
            handleStartSignalLoaded(loaded);
            return;
        }

        if (sampleId == successSignalId) {
            successSignalLoaded = loaded;
            handleSuccessSignalLoaded(loaded);
        }
    }

    private void handleStartSignalLoaded(boolean loaded) {
        PendingStartSignal pending = pendingStartSignal;

        if (pending == null) {
            if (!loaded) {
                recordSignalError(context);
            }
            return;
        }

        pendingStartSignal = null;
        handler.removeCallbacks(pending.timeout);

        if (!loaded || pending.generation != playbackGeneration || !isEnabled) {
            recordSignalError(context);
            pending.callback.onComplete(
                new AudioSignalPlayback(
                    false,
                    true,
                    0,
                    pending.requestedAtElapsedMs,
                    SystemClock.elapsedRealtime()
                )
            );
            return;
        }

        playLoadedStartSignal(pending.callback);
    }

    private void handleSuccessSignalLoaded(boolean loaded) {
        PendingSuccessSignal pending = pendingSuccessSignal;

        if (pending == null) {
            if (!loaded) {
                recordSignalError(context);
            }
            return;
        }

        pendingSuccessSignal = null;
        handler.removeCallbacks(pending.timeout);

        if (!loaded || pending.generation != playbackGeneration || !isEnabled) {
            recordSignalError(context);
            completeSignal(
                pending.callback,
                false,
                true,
                0,
                pending.requestedAtElapsedMs
            );
            return;
        }

        playLoadedSuccessSignal(pending.callback);
    }

    private void playLoadedStartSignal(AudioSignalCallback afterSignal) {
        int generation = playbackGeneration;
        long startedAtElapsedMs = SystemClock.elapsedRealtime();
        boolean played = playSignal(startSignalId);

        if (!played) {
            recordSignalError(context);
            completeSignal(afterSignal, false, true, 0, startedAtElapsedMs);
            return;
        }

        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_START_PLAYED);
        handler.postDelayed(
            () -> {
                if (generation != playbackGeneration) {
                    return;
                }

                AndroidVoiceRuntimeStore.recordValue(
                    context,
                    AndroidVoiceRuntimeMetric.START_SIGNAL_DURATION_MS,
                    START_SIGNAL_DURATION_MS
                );
                completeSignal(afterSignal, true, false, START_SIGNAL_DURATION_MS, startedAtElapsedMs);
            },
            START_SIGNAL_DURATION_MS
        );
    }

    private void playLoadedSuccessSignal(AudioSignalCallback afterSignal) {
        long startedAtElapsedMs = SystemClock.elapsedRealtime();
        boolean played = playSignal(successSignalId);

        if (!played) {
            recordSignalError(context);
            completeSignal(afterSignal, false, true, 0, startedAtElapsedMs);
            return;
        }

        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_SUCCESS_PLAYED);
        completeSignal(afterSignal, true, false, SUCCESS_SIGNAL_DURATION_MS, startedAtElapsedMs);
    }

    private boolean playSignal(int signalId) {
        return soundPool.play(signalId, SIGNAL_VOLUME, SIGNAL_VOLUME, 1, 0, 1.0f) != 0;
    }

    private void completeSignal(
        AudioSignalCallback afterSignal,
        boolean played,
        boolean failed,
        int durationMs,
        long startedAtElapsedMs
    ) {
        afterSignal.onComplete(
            new AudioSignalPlayback(
                played,
                failed,
                durationMs,
                startedAtElapsedMs,
                SystemClock.elapsedRealtime()
            )
        );
    }

    private void cancelPendingStartSignal() {
        PendingStartSignal pending = pendingStartSignal;
        pendingStartSignal = null;

        if (pending != null) {
            handler.removeCallbacks(pending.timeout);
        }
    }

    private void cancelPendingSuccessSignal() {
        PendingSuccessSignal pending = pendingSuccessSignal;
        pendingSuccessSignal = null;

        if (pending != null) {
            handler.removeCallbacks(pending.timeout);
        }
    }

    private static void recordSuppressed(Context context) {
        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_SUPPRESSED);
    }

    private static void recordSignalError(Context context) {
        AndroidVoiceRuntimeStore.markError(context, AndroidVoiceRuntimeError.AUDIO_SIGNAL_ERROR);
        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_ERROR);
        AndroidVoiceRuntimeStore.recordEvent(context, AndroidVoiceRuntimeMetric.GRACEFUL_DEGRADATION_USED);
    }

    static boolean shouldUseVibrationFallback(Context context) {
        return shouldSuppressAudioCue(context);
    }

    private static boolean shouldSuppressAudioCue(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);

        if (audioManager == null) {
            return false;
        }

        return audioManager.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
    }

    private static final class PendingStartSignal {

        final AudioSignalCallback callback;
        final int generation;
        final long requestedAtElapsedMs;
        Runnable timeout;

        PendingStartSignal(AudioSignalCallback callback, int generation, long requestedAtElapsedMs) {
            this.callback = callback;
            this.generation = generation;
            this.requestedAtElapsedMs = requestedAtElapsedMs;
        }
    }

    private static final class PendingSuccessSignal {

        final AudioSignalCallback callback;
        final int generation;
        final long requestedAtElapsedMs;
        Runnable timeout;

        PendingSuccessSignal(AudioSignalCallback callback, int generation, long requestedAtElapsedMs) {
            this.callback = callback;
            this.generation = generation;
            this.requestedAtElapsedMs = requestedAtElapsedMs;
        }
    }
}
