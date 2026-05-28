package ru.chaotika.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
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
    permissions = @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = PlannerVoiceAssistantPlugin.MICROPHONE)
)
public class PlannerVoiceAssistantPlugin extends Plugin {

    static final String MICROPHONE = "microphone";
    private final WakeWordMetricsLogger wakeWordMetricsLogger = new WakeWordMetricsLogger();

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "microphonePermissionCallback");
            return;
        }

        startWakeWordService();
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PluginMethod
    public void captureCommand(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            requestPermissionForAlias(MICROPHONE, call, "captureCommandPermissionCallback");
            return;
        }

        startForegroundServiceCompat(WakeWordService.createCaptureCommandIntent(getContext()));
        call.resolve(createStateResponse(VoiceAssistantState.RECORDING_COMMAND.value));
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
            response.put("command", commandValue);
        }

        call.resolve(response);
    }

    @PluginMethod
    public void simulateWakeWord(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Microphone permission is required.");
            return;
        }

        startForegroundServiceCompat(WakeWordService.createSimulateWakeWordIntent(getContext()));
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

        startWakeWordService();
        call.resolve(createStateResponse(PlannerVoiceAssistantStorage.readState(getContext())));
    }

    @PermissionCallback
    private void captureCommandPermissionCallback(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            call.reject("Нет доступа к микрофону.");
            return;
        }

        startForegroundServiceCompat(WakeWordService.createCaptureCommandIntent(getContext()));
        call.resolve(createStateResponse(VoiceAssistantState.RECORDING_COMMAND.value));
    }

    private void startWakeWordService() {
        startForegroundServiceCompat(WakeWordService.createStartIntent(getContext()));
    }

    private void startForegroundServiceCompat(Intent intent) {
        Context context = getContext();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
            return;
        }

        context.startService(intent);
    }

    private static JSObject createStateResponse(String state) {
        JSObject response = new JSObject();

        response.put("state", state);
        response.put("wakeWord", WakeWordConfig.haotika().displayPhrase);

        return response;
    }

    private static JSObject createDiagnosticsResponse() {
        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        JSObject response = new JSObject();

        response.put("phrase", snapshot.phrase);
        response.put("modelVersion", snapshot.modelVersion);
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
