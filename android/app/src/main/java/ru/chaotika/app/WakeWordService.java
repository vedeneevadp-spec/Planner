package ru.chaotika.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.widget.Toast;

public class WakeWordService extends Service {

    static final String ACTION_SIMULATE_WAKE_WORD = "ru.chaotika.app.action.SIMULATE_WAKE_WORD";
    static final String ACTION_CAPTURE_COMMAND = "ru.chaotika.app.action.CAPTURE_COMMAND";
    static final String ACTION_CONTINUE_AFTER_WAKE_REVIEW = "ru.chaotika.app.action.CONTINUE_AFTER_WAKE_REVIEW";
    static final String ACTION_CANCEL_WAKE_REVIEW = "ru.chaotika.app.action.CANCEL_WAKE_REVIEW";
    static final String ACTION_START = "ru.chaotika.app.action.START_WAKE_WORD";
    static final String ACTION_STOP = "ru.chaotika.app.action.STOP_WAKE_WORD";

    private static final String NOTIFICATION_CHANNEL_ID = "planner-voice-assistant";
    private static final int NOTIFICATION_ID = 1208;
    private static final long COMMAND_CAPTURE_WATCHDOG_TIMEOUT_MS = 40_000L;
    private static final long RESUME_WAKE_WORD_DELAY_MS = 1200L;
    private static final long RESOURCE_BUDGET_SAMPLE_INTERVAL_MS = 60_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable resourceBudgetSampler = this::sampleAndEnforceResourceBudget;
    private WakeWordEngine wakeWordEngine;
    private WakeWordMetricsLogger metricsLogger;
    private SpeechToTextService speechToTextService;
    private AudioFeedbackPlayer audioFeedbackPlayer;
    private VoiceAssistantState state = VoiceAssistantState.IDLE;
    private Runnable commandCaptureWatchdog;
    private int commandCaptureGeneration;
    private boolean isForeground;
    private boolean serviceStartLogged;
    private boolean stopRequested;
    private int sustainedHighCpuSampleCount;

    static Intent createStartIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_START);
    }

    static Intent createStopIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_STOP);
    }

    static Intent createSimulateWakeWordIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_SIMULATE_WAKE_WORD);
    }

    static Intent createCaptureCommandIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_CAPTURE_COMMAND);
    }

    static Intent createContinueAfterWakeReviewIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_CONTINUE_AFTER_WAKE_REVIEW);
    }

    static Intent createCancelWakeReviewIntent(Context context) {
        return new Intent(context, WakeWordService.class).setAction(ACTION_CANCEL_WAKE_REVIEW);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        metricsLogger = new WakeWordMetricsLogger();
        wakeWordEngine = createWakeWordEngine();
        speechToTextService = SpeechToTextServiceFactory.create(this);
        audioFeedbackPlayer = new AudioFeedbackPlayer(this, handler);
        audioFeedbackPlayer.setEnabled(PlannerVoiceAssistantStorage.readVoiceCuesEnabled(this));
        setState(VoiceAssistantState.IDLE);
        AndroidVoiceRuntimeSnapshot previousRuntime = AndroidVoiceRuntimeStore.snapshot(this);
        if (AndroidVoiceRuntimeStore.isActiveStatus(previousRuntime.status)) {
            AndroidVoiceRuntimeStore.markServiceKilledOrRestarted(this);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            boolean preserveBlockedStatus =
                AndroidVoiceRuntimeStore.snapshot(this).status == AndroidVoiceRuntimeStatus.BLOCKED;
            if (!preserveBlockedStatus) {
                AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.STOPPING);
            }
            stopAssistant(preserveBlockedStatus);
            return START_NOT_STICKY;
        }

        markServiceStartedIfNeeded();

        if (!ensureRuntimePermissions(action)) {
            return START_NOT_STICKY;
        }

        if (!ensureForegroundSafely()) {
            return START_NOT_STICKY;
        }

        if (ACTION_SIMULATE_WAKE_WORD.equals(action)) {
            if (!wakeWordEngine.isRunning()) {
                startWakeWordDetection();
            }
            if (wakeWordEngine instanceof MockWakeWordEngine mockWakeWordEngine) {
                mockWakeWordEngine.simulateWakeWord();
            }
            return START_NOT_STICKY;
        }

        if (ACTION_CAPTURE_COMMAND.equals(action)) {
            handleManualCommandCapture();
            return START_NOT_STICKY;
        }

        if (ACTION_CONTINUE_AFTER_WAKE_REVIEW.equals(action)) {
            handleWakeReviewContinue();
            return START_NOT_STICKY;
        }

        if (ACTION_CANCEL_WAKE_REVIEW.equals(action)) {
            handleWakeReviewCancel();
            return START_NOT_STICKY;
        }

        startWakeWordDetection();

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        clearRuntimeBuffers();
        if (!stopRequested && AndroidVoiceRuntimeStore.isActiveStatus(AndroidVoiceRuntimeStore.snapshot(this).status)) {
            AndroidVoiceRuntimeStore.markServiceKilledOrRestarted(this);
        }
        setState(VoiceAssistantState.IDLE);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        AndroidVoiceRuntimeStore.markServiceKilledOrRestarted(this);
        clearRuntimeBuffers();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private WakeWordEngine createWakeWordEngine() {
        return WakeWordEngineFactory.create(this, metricsLogger);
    }

    private void markServiceStartedIfNeeded() {
        if (serviceStartLogged) {
            return;
        }

        serviceStartLogged = true;
        AndroidVoiceRuntimeStore.markServiceStarting(this);
    }

    private void startWakeWordDetection() {
        if (!VoiceAssistantStateMachine.canStartWakeWordDetection(state)) {
            stopWakeWordEngine();
            return;
        }

        if (
            !VoiceAssistantStateMachine.canResumeWakeWordDetection(
                state,
                PlannerVoiceAssistantStorage.readWakeWordEnabled(this),
                PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(this)
            )
        ) {
            stopWakeWordEngine();
            stopAssistant(false);
            return;
        }

        if (wakeWordEngine.isRunning()) {
            return;
        }

        setState(VoiceAssistantState.LISTENING_FOR_WAKE_WORD);
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.LISTENING_WAKE_WORD);
        updateNotification(getString(R.string.planner_voice_notification_listening));
        wakeWordEngine.start(
            new WakeWordListener() {
                @Override
                public void onWakeWordDetected(WakeWordDetection detection) {
                    handler.post(() -> handleWakeWordDetected(detection));
                }

                @Override
                public void onScore(float score) {
                    WakeWordDiagnostics.updateCurrentScore(score);
                }

                @Override
                public void onError(WakeWordError error) {
                    handler.post(() -> handleAssistantError(error));
                }
            }
        );

        if (wakeWordEngine.isRunning()) {
            AndroidVoiceRuntimeStore.recordEvent(this, AndroidVoiceRuntimeMetric.WAKE_ENGINE_STARTED);
            sampleAndEnforceResourceBudget();
        }
    }

    private void handleWakeWordDetected(WakeWordDetection detection) {
        if (!VoiceAssistantStateMachine.canStartWakeWordDetection(state)) {
            stopWakeWordEngine();
            return;
        }

        AndroidVoiceRuntimeStore.recordValue(
            this,
            AndroidVoiceRuntimeMetric.WAKE_DETECTION_LATENCY_MS,
            System.currentTimeMillis() - detection.detectedAtEpochMillis
        );
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND);
        CommandAudioPreBuffer preBuffer = wakeWordEngine.latestCommandPreBuffer(
            CommandRecordingConfig.VOICE_PREBUFFER_MS
        );
        stopWakeWordEngine();

        if (!isWakeWordTrainingModeEnabled()) {
            WakeWordTrainingExampleStore.clearPending();
            beginCommandCapture(SttRequest.afterWakeWord(preBuffer));
            return;
        }

        setState(VoiceAssistantStateMachine.onWakeWordDetected(state));
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND);
        WakeWordTrainingExampleStore.capturePendingForReview(detection);
        playActivationHaptic();
        updateNotification(getString(R.string.planner_voice_notification_reviewing));
        openWakeWordReview();
    }

    private void handleManualCommandCapture() {
        if (state == VoiceAssistantState.RECORDING_COMMAND || state == VoiceAssistantState.TRANSCRIBING) {
            cancelActiveCommandCaptureForManualRestart();
        }

        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND);
        stopWakeWordEngine();
        beginCommandCapture(SttRequest.pushToTalk());
    }

    private void handleWakeReviewContinue() {
        if (state == VoiceAssistantState.RECORDING_COMMAND || state == VoiceAssistantState.TRANSCRIBING) {
            return;
        }

        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND);
        stopWakeWordEngine();
        beginCommandCapture(SttRequest.afterWakeWord());
    }

    private void handleWakeReviewCancel() {
        WakeWordTrainingExampleStore.clearPending();
        setState(VoiceAssistantState.IDLE);
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.RUNNING_FOREGROUND);
        updateNotification(getString(R.string.planner_voice_notification_listening));
        handler.postDelayed(this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
    }

    private void beginCommandCapture(SttRequest request) {
        long captureRequestedAtElapsedMs = SystemClock.elapsedRealtime();
        int captureGeneration = scheduleCommandCaptureWatchdog();
        setState(VoiceAssistantState.RECORDING_COMMAND);
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.RECORDING_COMMAND);
        updateNotification(getString(R.string.planner_voice_notification_recording));
        AudioSignalPlayback playback = audioFeedbackPlayer.playStartSignalNow();
        recordStartCueTiming(request, captureRequestedAtElapsedMs, playback);
        if (!playback.played && AudioFeedbackPlayer.shouldUseVibrationFallback(this)) {
            playActivationHaptic();
        }
        showListeningOverlay();

        SttRequest timedRequest = request.withAudioSignalTiming(
            captureRequestedAtElapsedMs,
            playback.startedAtElapsedMs,
            playback.completedAtElapsedMs,
            playback.durationMs,
            playback.played
        );
        startCommandTranscription(timedRequest, captureGeneration);
    }

    private void startCommandTranscription(SttRequest request, int captureGeneration) {
        if (!isCurrentCommandCapture(captureGeneration)) {
            return;
        }

        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.RECORDING_COMMAND);
        speechToTextService.transcribe(
            request,
            new SpeechToTextService.Callback() {
                @Override
                public void onRecordingStopped(CommandAudio audio) {
                    if (!isCurrentCommandCapture(captureGeneration)) {
                        return;
                    }

                    setState(VoiceAssistantState.TRANSCRIBING);
                    AndroidVoiceRuntimeStore.markStatus(WakeWordService.this, AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND);
                    updateNotification(getString(R.string.planner_voice_notification_transcribing));
                }

                @Override
                public void onResult(SttResult result) {
                    if (!isCurrentCommandCapture(captureGeneration)) {
                        return;
                    }

                    cancelCommandCaptureWatchdog();
                    PlannerVoiceAssistantStorage.storePendingCommand(WakeWordService.this, result);
                    setState(VoiceAssistantState.WAITING_FOR_CONFIRMATION);
                    speechToTextService.stop();
                    AndroidVoiceRuntimeStore.recordTextValue(
                        WakeWordService.this,
                        AndroidVoiceRuntimeMetric.VOICE_SESSION_RESULT,
                        "success"
                    );
                    AndroidVoiceRuntimeStore.markStatus(WakeWordService.this, AndroidVoiceRuntimeStatus.RUNNING_FOREGROUND);
                    updateNotification(getString(R.string.planner_voice_notification_ready));
                    openPlannerForConfirmation();
                    handler.postDelayed(WakeWordService.this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
                }

                @Override
                public void onError(SttException error) {
                    if (!isCurrentCommandCapture(captureGeneration)) {
                        return;
                    }

                    cancelCommandCaptureWatchdog();
                    PlannerVoiceAssistantStorage.storePendingError(WakeWordService.this, error);
                    AndroidVoiceRuntimeStore.recordTextValue(
                        WakeWordService.this,
                        AndroidVoiceRuntimeMetric.VOICE_SESSION_RESULT,
                        "error"
                    );
                    openPlannerForConfirmation();
                    handleCommandCaptureError(error);
                }
            }
        );
    }

    private int scheduleCommandCaptureWatchdog() {
        cancelCommandCaptureWatchdog();
        int captureGeneration = ++commandCaptureGeneration;

        commandCaptureWatchdog = () -> {
            if (
                !isCurrentCommandCapture(captureGeneration) ||
                (
                    state != VoiceAssistantState.RECORDING_COMMAND &&
                    state != VoiceAssistantState.TRANSCRIBING
                )
            ) {
                return;
            }

            commandCaptureWatchdog = null;
            commandCaptureGeneration++;

            SttException error = new SttException(
                SttError.NETWORK_ERROR,
                "Распознавание зависло дольше 40 секунд. Я остановила обработку, попробуй ещё раз."
            );

            PlannerVoiceAssistantStorage.storePendingError(this, error);
            openPlannerForConfirmation();
            handleCommandCaptureError(error);
        };
        handler.postDelayed(commandCaptureWatchdog, COMMAND_CAPTURE_WATCHDOG_TIMEOUT_MS);

        return captureGeneration;
    }

    private void cancelCommandCaptureWatchdog() {
        Runnable watchdog = commandCaptureWatchdog;
        commandCaptureWatchdog = null;

        if (watchdog != null) {
            handler.removeCallbacks(watchdog);
        }
    }

    private boolean isCurrentCommandCapture(int captureGeneration) {
        return commandCaptureGeneration == captureGeneration;
    }

    private void handleCommandCaptureError(SttException error) {
        AndroidVoiceRuntimeStore.markError(this, AndroidVoiceRuntimeError.fromSttError(error));
        if (error.code == SttError.PERMISSION_DENIED) {
            handlePermissionRevoked(error);
            return;
        }

        speechToTextService.stop();
        setState(VoiceAssistantState.ERROR);
        AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.RUNNING_FOREGROUND);
        updateNotification(getString(R.string.planner_voice_notification_error));
        handler.postDelayed(this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
    }

    private void handleAssistantError(WakeWordError error) {
        audioFeedbackPlayer.release();
        WakeWordDiagnostics.recordError(error);
        metricsLogger.error(error);
        AndroidVoiceRuntimeStore.recordEvent(this, AndroidVoiceRuntimeMetric.WAKE_ENGINE_ERROR);
        AndroidVoiceRuntimeError runtimeError = AndroidVoiceRuntimeError.fromWakeWordError(error);
        AndroidVoiceRuntimeStore.markError(this, runtimeError);
        setState(VoiceAssistantState.ERROR);
        updateNotification(getString(R.string.planner_voice_notification_error));

        if (isWakeModelUnavailable(error)) {
            PlannerVoiceAssistantStorage.storeWakeWordEnabled(this, false);
            PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(this, false);
            AndroidVoiceRuntimeStore.recordTextValue(
                this,
                AndroidVoiceRuntimeMetric.VOICE_SESSION_RESULT,
                "unsupported"
            );
            AndroidVoiceRuntimeStore.markBlocked(this, runtimeError);
            return;
        }

        if (error.code == WakeWordError.Code.MICROPHONE_PERMISSION_DENIED) {
            handlePermissionRevoked(new SttException(SttError.PERMISSION_DENIED, "Нет доступа к микрофону.", error));
            return;
        }

        AndroidVoiceRuntimeStore.markBlocked(this, runtimeError);
    }

    private static boolean isWakeModelUnavailable(WakeWordError error) {
        return error.code == WakeWordError.Code.MISSING_MODEL ||
            error.code == WakeWordError.Code.MISSING_FRONTEND_MODEL ||
            error.code == WakeWordError.Code.MODEL_IO_MISMATCH ||
            error.code == WakeWordError.Code.UNSUPPORTED_MODEL_INPUT ||
            error.code == WakeWordError.Code.UNSUPPORTED_SAMPLE_RATE;
    }

    private void stopAssistant(boolean preserveBlockedStatus) {
        stopRequested = true;
        handler.removeCallbacksAndMessages(null);
        commandCaptureWatchdog = null;
        commandCaptureGeneration++;
        recordCancelledVoiceSessionIfNeeded();
        clearRuntimeBuffers();
        setState(VoiceAssistantState.IDLE);
        if (preserveBlockedStatus) {
            AndroidVoiceRuntimeStore.recordEvent(this, AndroidVoiceRuntimeMetric.WAKE_SERVICE_STOPPED);
        } else {
            AndroidVoiceRuntimeStore.markServiceStopped(this);
        }
        stopForeground(true);
        stopSelf();
    }

    private void recordCancelledVoiceSessionIfNeeded() {
        if (state != VoiceAssistantState.RECORDING_COMMAND && state != VoiceAssistantState.TRANSCRIBING) {
            return;
        }

        AndroidVoiceRuntimeStore.recordTextValue(
            this,
            AndroidVoiceRuntimeMetric.VOICE_SESSION_RESULT,
            "cancelled"
        );
    }

    private void cancelActiveCommandCaptureForManualRestart() {
        cancelCommandCaptureWatchdog();
        commandCaptureGeneration++;
        recordCancelledVoiceSessionIfNeeded();

        if (speechToTextService != null) {
            speechToTextService.stop();
        }

        setState(VoiceAssistantState.IDLE);
    }

    private void setState(VoiceAssistantState nextState) {
        state = nextState;
        PlannerVoiceAssistantStorage.storeState(this, nextState);
    }

    private boolean ensureForegroundSafely() {
        try {
            createNotificationChannel();

            if (isForeground) {
                return true;
            }

            Notification notification = buildNotification(getString(R.string.planner_voice_notification_listening));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            isForeground = true;
            AndroidVoiceRuntimeStore.markStatus(this, AndroidVoiceRuntimeStatus.RUNNING_FOREGROUND);
            return true;
        } catch (SecurityException error) {
            handleForegroundServiceStartError(error);
            return false;
        } catch (RuntimeException error) {
            handleForegroundServiceStartError(error);
            return false;
        }
    }

    private boolean ensureRuntimePermissions(String action) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            handlePermissionRevoked(new SttException(SttError.PERMISSION_DENIED, "Нет доступа к микрофону."));
            return false;
        }

        if (
            !ACTION_CAPTURE_COMMAND.equals(action) &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(this, false);
            AndroidVoiceRuntimeStore.markBlocked(this, AndroidVoiceRuntimeError.MISSING_NOTIFICATION_PERMISSION);
            clearRuntimeBuffers();
            setState(VoiceAssistantState.ERROR);
            stopForeground(true);
            stopSelf();
            return false;
        }

        return true;
    }

    private void handlePermissionRevoked(SttException error) {
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.microphonePermissionRevoked();
        PlannerVoiceAssistantStorage.storeWakeWordEnabled(this, degradation.wakeWordEnabled);
        PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(this, degradation.backgroundWakeWordEnabled);
        WakeWordTrainingExampleStore.clearPending();
        clearRuntimeBuffers();
        PlannerVoiceAssistantStorage.storePendingError(this, error);
        setState(VoiceAssistantState.ERROR);
        AndroidVoiceRuntimeStore.markBlocked(this, degradation.error);
        stopForeground(true);
        stopSelf();
    }

    private void handleForegroundServiceStartError(RuntimeException error) {
        WakeWordError wakeWordError = WakeWordError.foregroundServiceNotAllowed(error);
        WakeWordDiagnostics.recordError(wakeWordError);
        metricsLogger.error(wakeWordError);
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.serviceStartFailure(error);
        PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(this, degradation.backgroundWakeWordEnabled);
        AndroidVoiceRuntimeStore.markServiceStartFailed(this, degradation.error);
        WakeWordTrainingExampleStore.clearPending();
        setState(VoiceAssistantState.ERROR);
    }

    private void sampleAndEnforceResourceBudget() {
        if (
            state != VoiceAssistantState.LISTENING_FOR_WAKE_WORD ||
            wakeWordEngine == null ||
            !wakeWordEngine.isRunning()
        ) {
            return;
        }

        AndroidVoiceRuntimeSamples samples = AndroidVoiceRuntimeSampler.sample(this);
        if (AndroidVoiceRuntimePolicy.isCpuOverSustainedLimit(samples)) {
            sustainedHighCpuSampleCount += 1;
        } else {
            sustainedHighCpuSampleCount = 0;
        }

        if (AndroidVoiceRuntimePolicy.shouldStopBackgroundWakeWord(samples, sustainedHighCpuSampleCount)) {
            handleResourceBudgetRestricted();
            return;
        }

        handler.removeCallbacks(resourceBudgetSampler);
        handler.postDelayed(resourceBudgetSampler, RESOURCE_BUDGET_SAMPLE_INTERVAL_MS);
    }

    private void handleResourceBudgetRestricted() {
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.batteryRestricted();

        PlannerVoiceAssistantStorage.storeWakeWordEnabled(this, degradation.wakeWordEnabled);
        PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(this, degradation.backgroundWakeWordEnabled);
        WakeWordTrainingExampleStore.clearPending();
        handler.removeCallbacks(resourceBudgetSampler);
        clearRuntimeBuffers();
        setState(VoiceAssistantState.ERROR);
        AndroidVoiceRuntimeStore.markBlocked(this, degradation.error);
        stopForeground(true);
        stopSelf();
    }

    private void stopWakeWordEngine() {
        boolean wasRunning = wakeWordEngine != null && wakeWordEngine.isRunning();

        handler.removeCallbacks(resourceBudgetSampler);
        sustainedHighCpuSampleCount = 0;

        if (wakeWordEngine != null) {
            wakeWordEngine.stop();
        }

        if (wasRunning) {
            AndroidVoiceRuntimeStore.recordEvent(this, AndroidVoiceRuntimeMetric.WAKE_ENGINE_STOPPED);
        }
    }

    private void clearRuntimeBuffers() {
        cancelCommandCaptureWatchdog();
        commandCaptureGeneration++;

        if (audioFeedbackPlayer != null) {
            audioFeedbackPlayer.release();
        }

        stopWakeWordEngine();

        if (speechToTextService != null) {
            speechToTextService.stop();
        }

        WakeWordTrainingExampleStore.clearPending();
    }

    private void recordStartCueTiming(
        SttRequest request,
        long captureRequestedAtElapsedMs,
        AudioSignalPlayback playback
    ) {
        if (!request.wakeWordDetected || captureRequestedAtElapsedMs <= 0L || !playback.played) {
            return;
        }

        AndroidVoiceRuntimeStore.recordValue(
            this,
            AndroidVoiceRuntimeMetric.WAKE_TO_START_CUE_MS,
            playback.startedAtElapsedMs - captureRequestedAtElapsedMs
        );
    }

    private void updateNotification(String contentText) {
        if (!isForeground) {
            return;
        }

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (notificationManager != null) {
            notificationManager.notify(NOTIFICATION_ID, buildNotification(contentText));
        }
    }

    private Notification buildNotification(String contentText) {
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent simulatePendingIntent = PendingIntent.getService(
            this,
            1,
            createSimulateWakeWordIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this,
            2,
            createStopIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent debugPendingIntent = PendingIntent.getActivity(
            this,
            3,
            WakeWordDebugActivity.createIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent trainingExamplesPendingIntent = PendingIntent.getActivity(
            this,
            6,
            WakeWordTrainingExamplesActivity.createIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setSmallIcon(R.drawable.ic_stat_chaotika)
            .setColor(getColor(R.color.colorPrimary))
            .setContentTitle(getString(R.string.planner_voice_notification_title))
            .setContentText(contentText)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setShowWhen(false)
            .addAction(
                android.R.drawable.ic_btn_speak_now,
                getString(R.string.planner_voice_notification_test_action),
                simulatePendingIntent
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                getString(R.string.planner_voice_notification_stop_action),
                stopPendingIntent
            )
            .addAction(
                android.R.drawable.ic_menu_upload,
                getString(R.string.planner_voice_notification_training_action),
                trainingExamplesPendingIntent
            );

        if (WakeWordEngineFactory.isDebuggable(this)) {
            builder.addAction(
                android.R.drawable.ic_menu_info_details,
                getString(R.string.planner_voice_notification_debug_action),
                debugPendingIntent
            );
        }

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (notificationManager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.planner_voice_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.planner_voice_notification_channel_description));

        notificationManager.createNotificationChannel(channel);
    }

    private void openPlannerForConfirmation() {
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        startActivity(intent);
    }

    private void openWakeWordReview() {
        startActivity(WakeWordTriggerReviewActivity.createIntent(this));
    }

    private boolean isWakeWordTrainingModeEnabled() {
        VoiceAssistantApiConfig config = PlannerVoiceAssistantStorage.readApiConfig(this);

        return config != null && config.wakeWordTrainingModeEnabled;
    }

    private void playActivationHaptic() {
        Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(80L, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(80L);
        }
    }

    private void showListeningOverlay() {
        Toast.makeText(this, R.string.planner_voice_overlay_listening, Toast.LENGTH_SHORT).show();
    }
}
