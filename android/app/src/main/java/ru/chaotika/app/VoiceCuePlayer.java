package ru.chaotika.app;

import android.content.Context;
import android.media.MediaPlayer;
import android.os.Handler;
import java.util.concurrent.atomic.AtomicBoolean;

final class VoiceCuePlayer {

    private static final long CUE_TIMEOUT_PADDING_MS = 250L;
    private static final long FALLBACK_CUE_DELAY_MS = 650L;

    private final Context context;
    private final Handler handler;
    private boolean isEnabled = true;
    private MediaPlayer activePlayer;
    private Runnable activeTimeoutRunnable;
    private int playbackGeneration;

    VoiceCuePlayer(Context context, Handler handler) {
        this.context = context.getApplicationContext();
        this.handler = handler;
    }

    static void playDoneCue(Context context, Handler handler) {
        new VoiceCuePlayer(context, handler).playDoneCue();
    }

    void playListeningCueBefore(Runnable afterCue) {
        if (!isEnabled) {
            handler.post(afterCue);
            return;
        }

        playRawResource(R.raw.voice_cue_listening_ru, afterCue);
    }

    void playDoneCue() {
        if (!isEnabled) {
            return;
        }

        playRawResource(R.raw.voice_cue_done_ru, null);
    }

    void setEnabled(boolean isEnabled) {
        this.isEnabled = isEnabled;

        if (!isEnabled) {
            release();
        }
    }

    void release() {
        releaseActivePlayer();
    }

    private void playRawResource(int rawResourceId, Runnable afterCue) {
        releaseActivePlayer();

        MediaPlayer player = MediaPlayer.create(context, rawResourceId);

        if (player == null) {
            finishAfterFallbackDelay(afterCue);
            return;
        }

        activePlayer = player;
        int generation = playbackGeneration;
        AtomicBoolean isFinished = new AtomicBoolean(false);
        Runnable finishPlayback = () -> {
            if (generation != playbackGeneration || !isFinished.compareAndSet(false, true)) {
                return;
            }

            if (activeTimeoutRunnable != null) {
                handler.removeCallbacks(activeTimeoutRunnable);
                activeTimeoutRunnable = null;
            }

            if (activePlayer == player) {
                activePlayer = null;
            }

            releasePlayer(player);

            if (afterCue != null) {
                afterCue.run();
            }
        };

        player.setOnCompletionListener((ignored) -> finishPlayback.run());
        player.setOnErrorListener((ignoredPlayer, ignoredWhat, ignoredExtra) -> {
            finishPlayback.run();
            return true;
        });

        activeTimeoutRunnable = finishPlayback;
        handler.postDelayed(finishPlayback, resolveCueTimeoutMs(player));

        try {
            player.start();
        } catch (IllegalStateException ignored) {
            finishPlayback.run();
        }
    }

    private void finishAfterFallbackDelay(Runnable afterCue) {
        if (afterCue == null) {
            return;
        }

        int generation = playbackGeneration;
        activeTimeoutRunnable = () -> {
            if (generation != playbackGeneration) {
                return;
            }

            activeTimeoutRunnable = null;
            afterCue.run();
        };
        handler.postDelayed(activeTimeoutRunnable, FALLBACK_CUE_DELAY_MS);
    }

    private long resolveCueTimeoutMs(MediaPlayer player) {
        try {
            int durationMs = player.getDuration();

            if (durationMs > 0) {
                return durationMs + CUE_TIMEOUT_PADDING_MS;
            }
        } catch (IllegalStateException ignored) {
            // Fall back to a short static delay if the decoder cannot report duration.
        }

        return FALLBACK_CUE_DELAY_MS;
    }

    private void releaseActivePlayer() {
        playbackGeneration++;

        if (activeTimeoutRunnable != null) {
            handler.removeCallbacks(activeTimeoutRunnable);
            activeTimeoutRunnable = null;
        }

        MediaPlayer player = activePlayer;
        activePlayer = null;

        if (player != null) {
            releasePlayer(player);
        }
    }

    private static void releasePlayer(MediaPlayer player) {
        player.setOnCompletionListener(null);
        player.setOnErrorListener(null);
        player.release();
    }
}
