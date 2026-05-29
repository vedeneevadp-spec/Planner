package ru.chaotika.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
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
    private static final long RESUME_WAKE_WORD_DELAY_MS = 1200L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WakeWordEngine wakeWordEngine;
    private WakeWordMetricsLogger metricsLogger;
    private SpeechToTextService speechToTextService;
    private VoiceAssistantState state = VoiceAssistantState.IDLE;
    private boolean isForeground;

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
        setState(VoiceAssistantState.IDLE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopAssistant();
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
            return START_STICKY;
        }

        if (ACTION_CAPTURE_COMMAND.equals(action)) {
            handleManualCommandCapture();
            return START_STICKY;
        }

        if (ACTION_CONTINUE_AFTER_WAKE_REVIEW.equals(action)) {
            handleWakeReviewContinue();
            return START_STICKY;
        }

        if (ACTION_CANCEL_WAKE_REVIEW.equals(action)) {
            handleWakeReviewCancel();
            return START_STICKY;
        }

        startWakeWordDetection();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        wakeWordEngine.stop();
        speechToTextService.stop();
        setState(VoiceAssistantState.IDLE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private WakeWordEngine createWakeWordEngine() {
        return WakeWordEngineFactory.create(this, metricsLogger);
    }

    private void startWakeWordDetection() {
        if (!VoiceAssistantStateMachine.canStartWakeWordDetection(state)) {
            wakeWordEngine.stop();
            return;
        }

        if (wakeWordEngine.isRunning()) {
            return;
        }

        setState(VoiceAssistantState.LISTENING_FOR_WAKE_WORD);
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
    }

    private void handleWakeWordDetected(WakeWordDetection detection) {
        if (!VoiceAssistantStateMachine.canStartWakeWordDetection(state)) {
            wakeWordEngine.stop();
            return;
        }

        wakeWordEngine.stop();

        if (!isWakeWordTrainingModeEnabled()) {
            WakeWordTrainingExampleStore.clearPending();
            beginCommandCapture(SttRequest.afterWakeWord());
            return;
        }

        setState(VoiceAssistantStateMachine.onWakeWordDetected(state));
        WakeWordTrainingExampleStore.capturePendingForReview(detection);
        playActivationFeedback();
        updateNotification(getString(R.string.planner_voice_notification_reviewing));
        openWakeWordReview();
    }

    private void handleManualCommandCapture() {
        if (state == VoiceAssistantState.RECORDING_COMMAND || state == VoiceAssistantState.TRANSCRIBING) {
            return;
        }

        wakeWordEngine.stop();
        beginCommandCapture(SttRequest.pushToTalk());
    }

    private void handleWakeReviewContinue() {
        if (state == VoiceAssistantState.RECORDING_COMMAND || state == VoiceAssistantState.TRANSCRIBING) {
            return;
        }

        wakeWordEngine.stop();
        beginCommandCapture(SttRequest.afterWakeWord());
    }

    private void handleWakeReviewCancel() {
        WakeWordTrainingExampleStore.clearPending();
        setState(VoiceAssistantState.IDLE);
        updateNotification(getString(R.string.planner_voice_notification_listening));
        handler.postDelayed(this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
    }

    private void beginCommandCapture(SttRequest request) {
        playActivationFeedback();
        showListeningOverlay();
        setState(VoiceAssistantState.RECORDING_COMMAND);
        updateNotification(getString(R.string.planner_voice_notification_recording));

        speechToTextService.transcribe(
            request,
            new SpeechToTextService.Callback() {
                @Override
                public void onRecordingStopped(CommandAudio audio) {
                    setState(VoiceAssistantState.TRANSCRIBING);
                    updateNotification(getString(R.string.planner_voice_notification_transcribing));
                }

                @Override
                public void onResult(SttResult result) {
                    PlannerVoiceAssistantStorage.storePendingCommand(WakeWordService.this, result);
                    setState(VoiceAssistantState.WAITING_FOR_CONFIRMATION);
                    updateNotification(getString(R.string.planner_voice_notification_ready));
                    openPlannerForConfirmation();
                    handler.postDelayed(WakeWordService.this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
                }

                @Override
                public void onError(SttException error) {
                    PlannerVoiceAssistantStorage.storePendingError(WakeWordService.this, error);
                    openPlannerForConfirmation();
                    handleAssistantError(WakeWordError.inferenceError(error));
                }
            }
        );
    }

    private void handleAssistantError(WakeWordError error) {
        WakeWordDiagnostics.recordError(error);
        metricsLogger.error(error);
        setState(VoiceAssistantState.ERROR);
        updateNotification(getString(R.string.planner_voice_notification_error));
        handler.postDelayed(this::startWakeWordDetection, RESUME_WAKE_WORD_DELAY_MS);
    }

    private void stopAssistant() {
        handler.removeCallbacksAndMessages(null);
        wakeWordEngine.stop();
        speechToTextService.stop();
        setState(VoiceAssistantState.IDLE);
        stopForeground(true);
        stopSelf();
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
            return true;
        } catch (RuntimeException error) {
            handleAssistantError(WakeWordError.foregroundServiceNotAllowed(error));
            return false;
        }
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
            .setSmallIcon(R.mipmap.ic_launcher)
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

    private void playActivationFeedback() {
        ToneGenerator toneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
        toneGenerator.startTone(ToneGenerator.TONE_PROP_ACK, 90);
        handler.postDelayed(toneGenerator::release, 150L);

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
