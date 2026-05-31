package ru.chaotika.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PlannerVoiceAssistant",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = PlannerVoiceAssistantPlugin.MICROPHONE),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = PlannerVoiceAssistantPlugin.NOTIFICATIONS)
    }
)
public class PlannerVoiceAssistantPlugin extends Plugin {

    static final String MICROPHONE = "microphone";
    static final String NOTIFICATIONS = "notifications";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final WakeWordMetricsLogger wakeWordMetricsLogger = new WakeWordMetricsLogger();

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "microphonePermissionCallback");
            return;
        }

        storeApiConfig(call);
        if (degradeIfWakeModelMissing()) {
            call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
            return;
        }

        if (
            !PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()) ||
            !PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(getContext())
        ) {
            call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
            return;
        }

        if (!canStartConfiguredWakeWordService()) {
            applyConfiguredStartBlocker();
            call.reject("Wake word background mode is blocked by permissions or model status.");
            return;
        }

        if (!startWakeWordService()) {
            call.reject("Не удалось запустить foreground-сервис микрофона.");
            return;
        }
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PluginMethod
    public void captureCommand(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "captureCommandPermissionCallback");
            return;
        }

        storeApiConfig(call);
        if (!startForegroundServiceCompat(WakeWordService.createCaptureCommandIntent(getContext()))) {
            call.reject("Не удалось запустить запись команды.");
            return;
        }
        call.resolve(createStateResponse(VoiceAssistantState.WAITING_FOR_CONFIRMATION.value));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();

        context.startService(WakeWordService.createStopIntent(context));
        call.resolve(createStateResponse(VoiceAssistantState.IDLE.value));
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PluginMethod
    public void consumePendingCommand(PluginCall call) {
        PendingVoiceCommand command = PlannerVoiceAssistantStorage.consumePendingCommand(getContext());
        JSObject response = new JSObject();

        if (command == null) {
            response.put("command", JSObject.NULL);
        } else {
            JSObject commandValue = new JSObject();
            commandValue.put("id", command.id);
            commandValue.put("capturedAt", command.capturedAt);
            commandValue.put("transcript", command.transcript);
            commandValue.put("errorCode", command.errorCode);
            commandValue.put("errorMessage", command.errorMessage);
            commandValue.put("source", command.source);
            if (command.plannerIntentJson != null) {
                try {
                    commandValue.put("intent", new org.json.JSONObject(command.plannerIntentJson));
                } catch (Exception ignored) {
                    commandValue.put("intent", JSObject.NULL);
                }
            } else {
                commandValue.put("intent", JSObject.NULL);
            }
            response.put("command", commandValue);
        }

        call.resolve(response);
    }

    @PluginMethod
    public void notifyActionResult(PluginCall call) {
        String source = call.getString("source");
        String intent = call.getString("intent");
        String status = call.getString("status");
        boolean requiresUnlock = Boolean.TRUE.equals(call.getBoolean("requiresUnlock"));
        boolean changedData = Boolean.TRUE.equals(call.getBoolean("changedData"));
        boolean shouldPlayDoneCue = VoiceCuePolicy.shouldPlayDoneCue(
            source,
            intent,
            status,
            requiresUnlock,
            changedData
        );
        JSObject response = new JSObject();

        if (shouldPlayDoneCue && PlannerVoiceAssistantStorage.readVoiceCuesEnabled(getContext())) {
            VoiceCuePlayer.playDoneCue(getContext(), mainHandler);
        }

        response.put("doneCuePlayed", shouldPlayDoneCue && PlannerVoiceAssistantStorage.readVoiceCuesEnabled(getContext()));
        call.resolve(response);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(createStatusResponse());
    }

    @PluginMethod
    public void setWakeWordEnabled(PluginCall call) {
        Boolean isEnabled = call.getBoolean("enabled");

        if (isEnabled == null) {
            call.reject("enabled is required.");
            return;
        }

        PlannerVoiceAssistantStorage.storeWakeWordEnabled(getContext(), isEnabled);

        if (!isEnabled) {
            getContext().startService(WakeWordService.createStopIntent(getContext()));
        } else if (degradeIfWakeModelMissing()) {
            call.resolve(new JSObject());
            return;
        } else if (!tryStartConfiguredWakeWordService()) {
            call.reject("Не удалось запустить wake word foreground-сервис.");
            return;
        }

        call.resolve(new JSObject());
    }

    @PluginMethod
    public void setBackgroundWakeWordEnabled(PluginCall call) {
        Boolean isEnabled = call.getBoolean("enabled");

        if (isEnabled == null) {
            call.reject("enabled is required.");
            return;
        }

        if (
            isEnabled &&
            !canStartWakeWordService(
                PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()),
                true
            )
        ) {
            applyConfiguredStartBlocker();
            call.reject("Wake word background mode is blocked by permissions or model status.");
            return;
        }

        PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(getContext(), isEnabled);

        if (!isEnabled) {
            getContext().startService(WakeWordService.createStopIntent(getContext()));
        } else if (!tryStartConfiguredWakeWordService()) {
            call.reject("Не удалось запустить фоновый wake word.");
            return;
        }

        call.resolve(new JSObject());
    }

    @PluginMethod
    public void setWakeWordSensitivity(PluginCall call) {
        WakeWordConfig config = WakeWordConfig.haotika();
        JSObject response = new JSObject();

        PlannerVoiceAssistantStorage.storeWakeWordSensitivity(getContext(), config.threshold);
        response.put("locked", true);
        response.put("sensitivity", readWakeWordManifestThreshold(config));
        call.resolve(response);
    }

    @PluginMethod
    public void setVoiceCuesEnabled(PluginCall call) {
        Boolean isEnabled = call.getBoolean("enabled");

        if (isEnabled == null) {
            call.reject("enabled is required.");
            return;
        }

        PlannerVoiceAssistantStorage.storeVoiceCuesEnabled(getContext(), isEnabled);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (getPermissionState(MICROPHONE) == PermissionState.GRANTED) {
            call.resolve(createPermissionResponse("granted"));
            return;
        }

        requestPermissionForAlias(MICROPHONE, call, "settingsMicrophonePermissionCallback");
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(createPermissionResponse("granted"));
            return;
        }

        if (getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            call.resolve(createPermissionResponse("granted"));
            return;
        }

        requestPermissionForAlias(NOTIFICATIONS, call, "settingsNotificationPermissionCallback");
    }

    @PluginMethod
    public void openSystemAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        getContext().startActivity(intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        getContext().startActivity(intent);
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void simulateWakeWord(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Microphone permission is required.");
            return;
        }

        if (!startForegroundServiceCompat(WakeWordService.createSimulateWakeWordIntent(getContext()))) {
            call.reject("Не удалось запустить foreground-сервис микрофона.");
            return;
        }
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PluginMethod
    public void getWakeWordDiagnostics(PluginCall call) {
        call.resolve(createDiagnosticsResponse());
    }

    @PluginMethod
    public void getWakeWordTrainingCollectionStatus(PluginCall call) {
        call.resolve(createTrainingCollectionResponse());
    }

    @PluginMethod
    public void setWakeWordTrainingCollectionEnabled(PluginCall call) {
        Boolean isEnabled = call.getBoolean("enabled");

        if (isEnabled == null) {
            call.reject("enabled is required.");
            return;
        }

        WakeWordTrainingExampleStore.setCollectionEnabled(getContext(), isEnabled);
        call.resolve(createTrainingCollectionResponse());
    }

    @PluginMethod
    public void reportWakeWordTrueAccept(PluginCall call) {
        resolveWakeWordFeedback(call, true);
    }

    @PluginMethod
    public void reportWakeWordFalseAccept(PluginCall call) {
        resolveWakeWordFeedback(call, false);
    }

    @PluginMethod
    public void skipWakeWordFeedback(PluginCall call) {
        boolean collectionEnabled = WakeWordTrainingExampleStore.isCollectionEnabled(getContext());
        boolean hadPendingExample = WakeWordTrainingExampleStore.hasPendingExample();

        WakeWordTrainingExampleStore.clearPending();

        JSObject response = createDiagnosticsResponse();

        response.put("collectionEnabled", collectionEnabled);
        response.put("hadPendingExample", hadPendingExample);
        response.put("hasPendingExample", false);
        response.put("sampleError", JSObject.NULL);
        response.put("sampleLabel", "skipped");
        response.put("sampleSaved", false);

        call.resolve(response);
    }

    @PluginMethod
    public void reportWakeWordFalseReject(PluginCall call) {
        wakeWordMetricsLogger.falseRejectReported();
        call.resolve(createDiagnosticsResponse());
    }

    @PluginMethod
    public void openWakeWordFalseRejectRecorder(PluginCall call) {
        getContext().startActivity(WakeWordSampleRecorderActivity.createFalseRejectIntent(getContext()));
        call.resolve(createTrainingCollectionResponse());
    }

    @PluginMethod
    public void openWakeWordDebug(PluginCall call) {
        getContext().startActivity(WakeWordDebugActivity.createIntent(getContext()));
        call.resolve(createDiagnosticsResponse());
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Нет доступа к микрофону.");
            return;
        }

        storeApiConfig(call);
        if (degradeIfWakeModelMissing()) {
            call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
            return;
        }

        if (
            !PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()) ||
            !PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(getContext())
        ) {
            call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
            return;
        }

        if (!canStartConfiguredWakeWordService()) {
            applyConfiguredStartBlocker();
            call.reject("Wake word background mode is blocked by permissions or model status.");
            return;
        }

        if (!startWakeWordService()) {
            call.reject("Не удалось запустить foreground-сервис микрофона.");
            return;
        }
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PermissionCallback
    private void captureCommandPermissionCallback(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Нет доступа к микрофону.");
            return;
        }

        storeApiConfig(call);
        if (!startForegroundServiceCompat(WakeWordService.createCaptureCommandIntent(getContext()))) {
            call.reject("Не удалось запустить запись команды.");
            return;
        }
        call.resolve(createStateResponse(VoiceAssistantState.WAITING_FOR_CONFIRMATION.value));
    }

    @PermissionCallback
    private void settingsMicrophonePermissionCallback(PluginCall call) {
        call.resolve(createPermissionResponse(mapPermissionState(getPermissionState(MICROPHONE))));
    }

    @PermissionCallback
    private void settingsNotificationPermissionCallback(PluginCall call) {
        call.resolve(createPermissionResponse(resolveNotificationPermissionStatus()));
    }

    private void storeApiConfig(PluginCall call) {
        PlannerVoiceAssistantStorage.storeApiConfig(
            getContext(),
            new VoiceAssistantApiConfig(
                call.getString("apiBaseUrl"),
                call.getString("accessToken"),
                call.getString("actorUserId"),
                call.getString("workspaceId"),
                Boolean.TRUE.equals(call.getBoolean("wakeWordTrainingModeEnabled"))
            )
        );
    }

    private boolean startWakeWordService() {
        return startForegroundServiceCompat(WakeWordService.createStartIntent(getContext()));
    }

    private boolean tryStartConfiguredWakeWordService() {
        if (canStartConfiguredWakeWordService()) {
            return startWakeWordService();
        }

        return true;
    }

    private boolean canStartConfiguredWakeWordService() {
        return canStartWakeWordService(
            PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()),
            PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(getContext())
        );
    }

    private boolean canStartWakeWordService(boolean wakeWordEnabled, boolean backgroundWakeWordEnabled) {
        return wakeWordEnabled &&
            backgroundWakeWordEnabled &&
            getPermissionState(MICROPHONE) == PermissionState.GRANTED &&
            "granted".equals(resolveNotificationPermissionStatus()) &&
            isWakeWordModelReady();
    }

    private boolean startForegroundServiceCompat(Intent intent) {
        Context context = getContext();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
                return true;
            }

            context.startService(intent);
            return true;
        } catch (SecurityException error) {
            WakeWordDiagnostics.recordError(WakeWordError.foregroundServiceNotAllowed(error));
            AndroidVoiceRuntimeStore.markServiceStartFailed(context, AndroidVoiceRuntimeError.SECURITY_EXCEPTION);
            PlannerVoiceAssistantStorage.storeState(context, VoiceAssistantState.ERROR);
            WakeWordTrainingExampleStore.clearPending();
            return false;
        } catch (IllegalStateException error) {
            WakeWordDiagnostics.recordError(WakeWordError.foregroundServiceNotAllowed(error));
            AndroidVoiceRuntimeStore.markServiceStartFailed(
                context,
                AndroidVoiceRuntimeError.FOREGROUND_SERVICE_NOT_ALLOWED
            );
            PlannerVoiceAssistantStorage.storeState(context, VoiceAssistantState.ERROR);
            WakeWordTrainingExampleStore.clearPending();
            return false;
        }
    }

    private static JSObject createStateResponse(String state) {
        JSObject response = new JSObject();

        response.put("state", state);
        response.put("wakeWord", WakeWordConfig.haotika().displayPhrase);

        return response;
    }

    private JSObject createStatusResponse() {
        enforceRuntimePermissionPolicy();

        WakeWordConfig config = WakeWordConfig.haotika();
        AndroidVoiceRuntimeSnapshot runtimeSnapshot = AndroidVoiceRuntimeStore.snapshot(getContext());
        AndroidVoiceRuntimeSamples runtimeSamples = AndroidVoiceRuntimeSampler.sample(getContext());
        JSObject response = new JSObject();

        response.put("platform", "android");
        response.put("isAndroid", true);
        response.put("wakeWordEnabled", PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()));
        response.put("backgroundWakeWordEnabled", PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(getContext()));
        response.put("foregroundServiceStatus", resolveForegroundServiceStatus());
        response.put("wakePhrase", config.displayPhrase);
        response.put("recognitionLanguage", config.language);
        response.put("confirmationMode", "confirmation_first");
        response.put("wakeWordModelStatus", isWakeWordModelReady() ? "ready" : "missing");
        response.put("wakeWordSensitivity", readWakeWordManifestThreshold(config));
        WakeWordModelManifest manifest = readWakeWordManifest(config);
        response.put("wakeWordProvider", manifest == null ? config.provider.metricValue : manifest.provider.metricValue);
        response.put("wakeWordModelVersion", manifest == null ? "unknown" : manifest.modelVersion);
        response.put("microphonePermission", mapPermissionState(getPermissionState(MICROPHONE)));
        response.put("notificationPermission", resolveNotificationPermissionStatus());
        response.put("voiceCuesEnabled", PlannerVoiceAssistantStorage.readVoiceCuesEnabled(getContext()));
        response.put("runtimeStatus", resolveRuntimeStatusForResponse(runtimeSnapshot).value);
        response.put("runtimeLastError", runtimeSnapshot.lastError == null ? JSObject.NULL : runtimeSnapshot.lastError);
        response.put("runtimeDurationMs", runtimeSnapshot.runtimeDurationMs);
        response.put("pushToTalkFallbackStatus", resolvePushToTalkFallbackStatus());
        response.put("runtimeMetrics", createRuntimeMetricsResponse());
        response.put("batterySample", createBatterySampleResponse(runtimeSamples.battery));
        response.put("cpuSample", createCpuSampleResponse(runtimeSamples.cpu));
        response.put("memorySample", createMemorySampleResponse(runtimeSamples.memory));

        return response;
    }

    private JSObject createPermissionResponse(String status) {
        JSObject response = new JSObject();

        response.put("status", status);

        return response;
    }

    private String resolveForegroundServiceStatus() {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            return "missing_permission";
        }

        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        if (WakeWordError.Code.FOREGROUND_SERVICE_NOT_ALLOWED.value.equals(snapshot.lastError)) {
            return "blocked";
        }

        String state = PlannerVoiceAssistantStorage.readState(getContext());

        if (!VoiceAssistantState.IDLE.value.equals(state) && !VoiceAssistantState.ERROR.value.equals(state)) {
            return "running";
        }

        return "stopped";
    }

    private void enforceRuntimePermissionPolicy() {
        Context context = getContext();

        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.microphonePermissionRevoked();
            PlannerVoiceAssistantStorage.storeWakeWordEnabled(context, degradation.wakeWordEnabled);
            PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(context, false);
            WakeWordTrainingExampleStore.clearPending();
            stopWakeWordServiceSilently();
            WakeWordDiagnostics.recordError(WakeWordError.microphonePermissionDenied());
            AndroidVoiceRuntimeStore.markBlocked(context, degradation.error);
            return;
        }

        if (degradeIfWakeModelMissing()) {
            return;
        }

        if (!"granted".equals(resolveNotificationPermissionStatus())) {
            AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.notificationPermissionRevoked(
                PlannerVoiceAssistantStorage.readWakeWordEnabled(context)
            );
            PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(context, false);
            stopWakeWordServiceSilently();
            AndroidVoiceRuntimeStore.markBlocked(context, degradation.error);
        }
    }

    private void stopWakeWordServiceSilently() {
        try {
            getContext().startService(WakeWordService.createStopIntent(getContext()));
        } catch (RuntimeException ignored) {
            PlannerVoiceAssistantStorage.storeState(getContext(), VoiceAssistantState.IDLE);
        }
    }

    private boolean isWakeWordModelReady() {
        WakeWordConfig config = WakeWordConfig.haotika();
        AndroidWakeWordAssetSource assets = new AndroidWakeWordAssetSource(getContext());
        WakeWordModelManifest manifest = readWakeWordManifest(config);

        if (manifest == null) {
            return false;
        }

        if (
            manifest.provider == WakeWordProvider.CUSTOM_ONNX &&
            manifest.inputKind == WakeWordModelInputKind.EMBEDDING_MATRIX &&
            manifest.frontend == WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD
        ) {
            return assets.exists(manifest.melSpectrogramModelPath) &&
                assets.exists(manifest.embeddingModelPath) &&
                assets.exists(manifest.classifierModelPath);
        }

        return assets.exists(manifest.modelPath);
    }

    private float readWakeWordManifestThreshold(WakeWordConfig config) {
        WakeWordModelManifest manifest = readWakeWordManifest(config);

        return manifest == null ? config.threshold : manifest.threshold;
    }

    private WakeWordModelManifest readWakeWordManifest(WakeWordConfig config) {
        try {
            return WakeWordModelManifest.read(new AndroidWakeWordAssetSource(getContext()), config);
        } catch (WakeWordError error) {
            return null;
        }
    }

    private boolean degradeIfWakeModelMissing() {
        if (isWakeWordModelReady()) {
            return false;
        }

        Context context = getContext();
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.missingWakeModel();

        PlannerVoiceAssistantStorage.storeWakeWordEnabled(context, degradation.wakeWordEnabled);
        PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(context, degradation.backgroundWakeWordEnabled);
        WakeWordTrainingExampleStore.clearPending();
        stopWakeWordServiceSilently();
        AndroidVoiceRuntimeStore.markBlocked(context, degradation.error);

        return true;
    }

    private void applyConfiguredStartBlocker() {
        Context context = getContext();

        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            AndroidVoiceRuntimeStore.markBlocked(context, AndroidVoiceRuntimeError.MISSING_MICROPHONE_PERMISSION);
            return;
        }

        if (!"granted".equals(resolveNotificationPermissionStatus())) {
            PlannerVoiceAssistantStorage.storeBackgroundWakeWordEnabled(context, false);
            AndroidVoiceRuntimeStore.markBlocked(context, AndroidVoiceRuntimeError.MISSING_NOTIFICATION_PERMISSION);
            return;
        }

        if (!isWakeWordModelReady()) {
            degradeIfWakeModelMissing();
        }
    }

    private String resolvePushToTalkFallbackStatus() {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            return "blocked_missing_microphone_permission";
        }

        return "available";
    }

    private AndroidVoiceRuntimeStatus resolveRuntimeStatusForResponse(AndroidVoiceRuntimeSnapshot snapshot) {
        if (
            snapshot.status == AndroidVoiceRuntimeStatus.STOPPED &&
            !PlannerVoiceAssistantStorage.readWakeWordEnabled(getContext()) &&
            !PlannerVoiceAssistantStorage.readBackgroundWakeWordEnabled(getContext())
        ) {
            return AndroidVoiceRuntimeStatus.DISABLED;
        }

        return snapshot.status;
    }

    private JSObject createRuntimeMetricsResponse() {
        JSObject response = new JSObject();

        for (AndroidVoiceRuntimeMetric metric : AndroidVoiceRuntimeMetric.values()) {
            if (AndroidVoiceRuntimeStore.hasMetric(getContext(), metric)) {
                response.put(metric.value, AndroidVoiceRuntimeStore.readMetricValue(getContext(), metric));
            }
        }

        return response;
    }

    private static JSObject createBatterySampleResponse(AndroidVoiceBatterySample sample) {
        JSObject response = new JSObject();

        response.put("levelPercent", sample.levelPercent);
        response.put("isCharging", sample.isCharging);
        response.put("isPowerSaveMode", sample.isPowerSaveMode);

        return response;
    }

    private static JSObject createCpuSampleResponse(AndroidVoiceCpuSample sample) {
        JSObject response = new JSObject();

        response.put("processCpuPercent", sample.processCpuPercent);

        return response;
    }

    private static JSObject createMemorySampleResponse(AndroidVoiceMemorySample sample) {
        JSObject response = new JSObject();

        response.put("usedMb", sample.usedMb);
        response.put("maxMb", sample.maxMb);

        return response;
    }

    private String resolveNotificationPermissionStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }

        return mapPermissionState(getPermissionState(NOTIFICATIONS));
    }

    private static String mapPermissionState(PermissionState state) {
        if (state == PermissionState.GRANTED) {
            return "granted";
        }

        if (state == PermissionState.DENIED) {
            return "denied";
        }

        return "unknown";
    }

    private static JSObject createDiagnosticsResponse() {
        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        JSObject response = new JSObject();

        response.put("phrase", snapshot.phrase);
        response.put("modelVersion", snapshot.modelVersion);
        response.put("provider", snapshot.provider.metricValue);
        response.put("threshold", snapshot.threshold);
        response.put("currentScore", snapshot.currentScore);
        response.put("lastDetectionScore", snapshot.lastDetectionScore);
        response.put("detectionCount", snapshot.detectionCount);
        response.put("lastMetric", snapshot.lastMetric);
        response.put("lastError", snapshot.lastError);

        return response;
    }

    private JSObject createTrainingCollectionResponse() {
        WakeWordTrainingExampleStore.CollectionStatus status = WakeWordTrainingExampleStore.getStatus(getContext());
        JSObject response = new JSObject();

        response.put("falseAcceptCount", status.falseAcceptCount);
        response.put("falseRejectCount", status.falseRejectCount);
        response.put("hasPendingExample", status.hasPendingExample);
        response.put("isEnabled", status.isEnabled);
        response.put("storagePath", WakeWordTrainingExampleStore.getStoragePath(getContext()));
        response.put("trueAcceptCount", status.trueAcceptCount);

        return response;
    }

    private void resolveWakeWordFeedback(PluginCall call, boolean isTrueAccept) {
        String label = isTrueAccept
            ? WakeWordTrainingExampleStore.LABEL_TRUE_ACCEPT
            : WakeWordTrainingExampleStore.LABEL_FALSE_ACCEPT;
        boolean collectionEnabled = WakeWordTrainingExampleStore.isCollectionEnabled(getContext());
        boolean hadPendingExample = WakeWordTrainingExampleStore.hasPendingExample();
        boolean sampleSaved = false;
        String sampleError = null;

        if (isTrueAccept) {
            wakeWordMetricsLogger.trueAcceptReported();
        } else {
            wakeWordMetricsLogger.falseAcceptReported();
        }

        if (collectionEnabled && hadPendingExample) {
            try {
                WakeWordTrainingExampleStore.SaveResult result = WakeWordTrainingExampleStore.savePending(getContext(), label);
                wakeWordMetricsLogger.trainingExampleSaved(result.label);
                sampleSaved = true;
            } catch (Exception error) {
                sampleError = error.getMessage();
            }
        }

        JSObject response = createDiagnosticsResponse();

        response.put("collectionEnabled", collectionEnabled);
        response.put("hadPendingExample", hadPendingExample);
        response.put("hasPendingExample", WakeWordTrainingExampleStore.hasPendingExample());
        response.put("sampleError", sampleError);
        response.put("sampleLabel", label);
        response.put("sampleSaved", sampleSaved);

        call.resolve(response);
    }

}
