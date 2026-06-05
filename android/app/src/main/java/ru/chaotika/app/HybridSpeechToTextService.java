package ru.chaotika.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

final class HybridSpeechToTextService implements SpeechToTextService {

    private final Context context;
    private final RecordedSpeechToTextProvider backendProvider;
    private final CommandAudioRecorder recorder;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final RecordedSpeechToTextProvider localProvider;
    private final SttMetricsLogger metricsLogger = new SttMetricsLogger();
    private final Object transcriptionLock = new Object();
    private ExecutorService executor = createExecutor();
    private Future<?> activeTask;
    private int transcriptionGeneration;

    HybridSpeechToTextService(
        Context context,
        CommandAudioRecorder recorder,
        RecordedSpeechToTextProvider backendProvider,
        RecordedSpeechToTextProvider localProvider
    ) {
        this.context = context.getApplicationContext();
        this.recorder = recorder;
        this.backendProvider = backendProvider;
        this.localProvider = localProvider;
    }

    @Override
    public void transcribe(SttRequest request, Callback callback) {
        int generation;

        synchronized (transcriptionLock) {
            generation = ++transcriptionGeneration;
            activeTask = executor.submit(() -> runTranscription(generation, request, callback));
        }
    }

    @Override
    public void stop() {
        recorder.stop();
        backendProvider.cancel();
        localProvider.cancel();

        synchronized (transcriptionLock) {
            transcriptionGeneration++;

            if (activeTask != null) {
                activeTask.cancel(true);
                activeTask = null;
            }

            executor.shutdownNow();
            executor = createExecutor();
        }
    }

    private void runTranscription(int generation, SttRequest request, Callback callback) {
        try {
            metricsLogger.recordingStarted();
            CommandAudio audio = recorder.recordBlocking(
                request,
                (startedAtElapsedMs) -> recordRuntimeRecorderTiming(request, startedAtElapsedMs)
            );

            if (!isActiveTranscription(generation)) {
                return;
            }

            metricsLogger.recordingStopped(audio);
            recordRuntimeRecordingMetrics(audio);
            postRecordingStopped(generation, callback, audio);

            RecordedSpeechToTextProvider provider = selectProvider();
            if (provider == localProvider) {
                metricsLogger.fallbackUsed(SttProvider.LOCAL_STUB);
            }

            if (provider == backendProvider) {
                metricsLogger.uploadStarted(audio);
            }

            SttResult result = provider.transcribe(audio, request);

            if (!isActiveTranscription(generation)) {
                return;
            }

            if (result.confidence < 0.55d) {
                metricsLogger.lowConfidence(result);
            }

            if (provider == backendProvider) {
                metricsLogger.uploadCompleted(result);
            }

            postResult(generation, callback, result);
        } catch (SttException error) {
            if (!isActiveTranscription(generation)) {
                return;
            }

            if (
                error.code == SttError.NO_SPEECH ||
                error.code == SttError.TOO_SHORT ||
                error.code == SttError.TOO_QUIET ||
                error.code == SttError.TOO_LONG ||
                error.code == SttError.UNSUPPORTED_AUDIO_FORMAT ||
                error.code == SttError.PRIVACY_BLOCKED
            ) {
                metricsLogger.localValidationFailed(error);
            } else {
                metricsLogger.error(error);
            }
            postError(generation, callback, error);
        } finally {
            clearActiveTask(generation);
        }
    }

    private boolean isActiveTranscription(int generation) {
        synchronized (transcriptionLock) {
            return transcriptionGeneration == generation && !Thread.currentThread().isInterrupted();
        }
    }

    private void clearActiveTask(int generation) {
        synchronized (transcriptionLock) {
            if (transcriptionGeneration == generation) {
                activeTask = null;
            }
        }
    }

    private static ExecutorService createExecutor() {
        return Executors.newSingleThreadExecutor();
    }

    private RecordedSpeechToTextProvider selectProvider() throws SttException {
        if (isNetworkAvailable() && backendProvider.isAvailable()) {
            return backendProvider;
        }

        if (localProvider.isAvailable()) {
            return localProvider;
        }

        if (!isNetworkAvailable()) {
            throw new SttException(
                SttError.LOCAL_STT_UNAVAILABLE,
                "Нет интернета, а локальный STT пока недоступен. Можно ввести команду вручную."
            );
        }

        throw new SttException(
            SttError.SERVER_STT_UNAVAILABLE,
            "Backend STT не настроен. Можно ввести команду вручную."
        );
    }

    private void recordRuntimeRecorderTiming(SttRequest request, long recorderStartedAtElapsedMs) {
        if (request.captureRequestedAtElapsedMs > 0L) {
            AndroidVoiceRuntimeStore.recordValue(
                context,
                AndroidVoiceRuntimeMetric.COMMAND_RECORDER_START_LATENCY_MS,
                recorderStartedAtElapsedMs - request.captureRequestedAtElapsedMs
            );
        }

        if (request.wakeWordDetected && request.captureRequestedAtElapsedMs > 0L) {
            AndroidVoiceRuntimeStore.recordValue(
                context,
                AndroidVoiceRuntimeMetric.WAKE_DETECTED_TO_RECORDER_START_MS,
                recorderStartedAtElapsedMs - request.captureRequestedAtElapsedMs
            );
            AndroidVoiceRuntimeStore.recordValue(
                context,
                AndroidVoiceRuntimeMetric.WAKE_TO_RECORDING_STARTED_MS,
                recorderStartedAtElapsedMs - request.captureRequestedAtElapsedMs
            );
        }

        if (request.audioSignalCompletedAtElapsedMs > 0L) {
            AndroidVoiceRuntimeStore.recordValue(
                context,
                AndroidVoiceRuntimeMetric.AUDIO_SIGNAL_TO_RECORDER_DELAY_MS,
                recorderStartedAtElapsedMs - request.audioSignalCompletedAtElapsedMs
            );
        }

        if (request.audioSignalDurationMs > 0) {
            AndroidVoiceRuntimeStore.recordValue(
                context,
                AndroidVoiceRuntimeMetric.START_SIGNAL_DURATION_MS,
                request.audioSignalDurationMs
            );
        }
    }

    private void recordRuntimeRecordingMetrics(CommandAudio audio) {
        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.RECORDING_DURATION_MS,
            audio.recordingDurationMs
        );
        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.PREBUFFER_MS,
            audio.preBufferMs
        );
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager connectivityManager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);

        if (connectivityManager == null) {
            return false;
        }

        android.net.Network activeNetwork = connectivityManager.getActiveNetwork();

        if (activeNetwork == null) {
            return false;
        }

        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(activeNetwork);

        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void postRecordingStopped(int generation, Callback callback, CommandAudio audio) {
        mainHandler.post(() -> {
            if (isActiveTranscription(generation)) {
                callback.onRecordingStopped(audio);
            }
        });
    }

    private void postResult(int generation, Callback callback, SttResult result) {
        mainHandler.post(() -> {
            if (isActiveTranscription(generation)) {
                callback.onResult(result);
            }
        });
    }

    private void postError(int generation, Callback callback, SttException error) {
        mainHandler.post(() -> {
            if (isActiveTranscription(generation)) {
                callback.onError(error);
            }
        });
    }
}
