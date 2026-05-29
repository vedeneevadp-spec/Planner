package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerVoiceAssistantStorage {

    private static final String API_CONFIG_KEY = "planner.voice.api-config";
    private static final String BACKGROUND_WAKE_WORD_ENABLED_KEY = "planner.voice.background-wake-word-enabled";
    private static final String PENDING_COMMAND_KEY = "planner.voice.pending-command";
    private static final String PREFERENCES_NAME = "CapacitorStorage";
    private static final String STATE_KEY = "planner.voice.state";
    private static final String VOICE_CUES_ENABLED_KEY = "planner.voice.voice-cues-enabled";
    private static final String WAKE_WORD_ENABLED_KEY = "planner.voice.wake-word-enabled";
    private static final String WAKE_WORD_REVIEW_MODE_ENABLED_KEY = "planner.voice.wake-word-review-mode-enabled";
    private static final String WAKE_WORD_SENSITIVITY_KEY = "planner.voice.wake-word-sensitivity";

    private PlannerVoiceAssistantStorage() {}

    static void storeState(Context context, VoiceAssistantState state) {
        getPreferences(context).edit().putString(STATE_KEY, state.value).apply();
    }

    static String readState(Context context) {
        return getPreferences(context).getString(STATE_KEY, VoiceAssistantState.IDLE.value);
    }

    static void storeWakeWordEnabled(Context context, boolean isEnabled) {
        getPreferences(context).edit().putBoolean(WAKE_WORD_ENABLED_KEY, isEnabled).apply();
    }

    static boolean readWakeWordEnabled(Context context) {
        return getPreferences(context).getBoolean(WAKE_WORD_ENABLED_KEY, false);
    }

    static void storeBackgroundWakeWordEnabled(Context context, boolean isEnabled) {
        getPreferences(context).edit().putBoolean(BACKGROUND_WAKE_WORD_ENABLED_KEY, isEnabled).apply();
    }

    static boolean readBackgroundWakeWordEnabled(Context context) {
        return getPreferences(context).getBoolean(BACKGROUND_WAKE_WORD_ENABLED_KEY, false);
    }

    static void storeVoiceCuesEnabled(Context context, boolean isEnabled) {
        getPreferences(context).edit().putBoolean(VOICE_CUES_ENABLED_KEY, isEnabled).apply();
    }

    static boolean readVoiceCuesEnabled(Context context) {
        return getPreferences(context).getBoolean(VOICE_CUES_ENABLED_KEY, true);
    }

    static void storeWakeWordReviewModeEnabled(Context context, boolean isEnabled) {
        getPreferences(context).edit().putBoolean(WAKE_WORD_REVIEW_MODE_ENABLED_KEY, isEnabled).apply();
    }

    static boolean readWakeWordReviewModeEnabled(Context context) {
        return getPreferences(context).getBoolean(WAKE_WORD_REVIEW_MODE_ENABLED_KEY, false);
    }

    static void storeWakeWordSensitivity(Context context, float sensitivity) {
        getPreferences(context).edit().putFloat(WAKE_WORD_SENSITIVITY_KEY, clampWakeWordSensitivity(sensitivity)).apply();
    }

    static float readWakeWordSensitivity(Context context) {
        return getPreferences(context).getFloat(WAKE_WORD_SENSITIVITY_KEY, WakeWordConfig.haotika().threshold);
    }

    static void storeApiConfig(Context context, VoiceAssistantApiConfig config) {
        if (config == null || !config.isUsable()) {
            getPreferences(context).edit().remove(API_CONFIG_KEY).apply();
            return;
        }

        JSONObject value = new JSONObject();

        try {
            value.put("apiBaseUrl", config.apiBaseUrl);
            value.put("accessToken", config.accessToken);
            value.put("actorUserId", config.actorUserId);
            value.put("workspaceId", config.workspaceId);
            value.put("wakeWordTrainingModeEnabled", config.wakeWordTrainingModeEnabled);
        } catch (JSONException exception) {
            return;
        }

        getPreferences(context).edit().putString(API_CONFIG_KEY, value.toString()).apply();
    }

    static VoiceAssistantApiConfig readApiConfig(Context context) {
        String rawConfig = getPreferences(context).getString(API_CONFIG_KEY, null);

        if (rawConfig == null) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawConfig);
            VoiceAssistantApiConfig config = new VoiceAssistantApiConfig(
                value.optString("apiBaseUrl", null),
                value.optString("accessToken", null),
                value.optString("actorUserId", null),
                value.optString("workspaceId", null),
                value.optBoolean("wakeWordTrainingModeEnabled", false)
            );

            return config.isUsable() ? config : null;
        } catch (JSONException exception) {
            return null;
        }
    }

    static void storePendingCommand(Context context, SttResult result) {
        String normalizedTranscript = normalizeTranscript(result.transcript);

        if (normalizedTranscript == null) {
            return;
        }

        String capturedAt = formatUtcNow();
        JSONObject command = new JSONObject();

        try {
            command.put("id", "voice-" + capturedAt + "-" + Math.abs(normalizedTranscript.hashCode()));
            command.put("capturedAt", capturedAt);
            command.put("transcript", normalizedTranscript);
            command.put("confidence", result.confidence);
            command.put("provider", result.provider.name());
            command.put("source", result.source.name());
            command.put("durationMs", result.durationMs);
            if (result.plannerIntentJson != null) {
                command.put("intent", new JSONObject(result.plannerIntentJson));
            }
        } catch (JSONException exception) {
            return;
        }

        getPreferences(context).edit().putString(PENDING_COMMAND_KEY, command.toString()).apply();
    }

    static void storePendingError(Context context, SttException error) {
        String capturedAt = formatUtcNow();
        JSONObject command = new JSONObject();

        try {
            command.put("id", "voice-error-" + capturedAt + "-" + Math.abs(error.code.name().hashCode()));
            command.put("capturedAt", capturedAt);
            command.put("errorCode", error.code.name());
            command.put("errorMessage", error.getMessage());
        } catch (JSONException exception) {
            return;
        }

        getPreferences(context).edit().putString(PENDING_COMMAND_KEY, command.toString()).apply();
    }

    static PendingVoiceCommand consumePendingCommand(Context context) {
        SharedPreferences preferences = getPreferences(context);
        String rawCommand = preferences.getString(PENDING_COMMAND_KEY, null);

        if (rawCommand == null) {
            return null;
        }

        preferences.edit().remove(PENDING_COMMAND_KEY).apply();

        try {
            JSONObject command = new JSONObject(rawCommand);
            String id = command.optString("id", "").trim();
            String capturedAt = command.optString("capturedAt", "").trim();
            String transcript = normalizeTranscript(command.optString("transcript", ""));
            String errorCode = command.optString("errorCode", "").trim();
            String errorMessage = command.optString("errorMessage", "").trim();
            String source = command.optString("source", "").trim();
            JSONObject intent = command.optJSONObject("intent");

            if (id.isEmpty() || capturedAt.isEmpty()) {
                return null;
            }

            if (transcript == null && errorMessage.isEmpty()) {
                return null;
            }

            return new PendingVoiceCommand(
                id,
                capturedAt,
                transcript,
                errorCode.isEmpty() ? null : errorCode,
                errorMessage.isEmpty() ? null : errorMessage,
                intent != null ? intent.toString() : null,
                source.isEmpty() ? null : source
            );
        } catch (JSONException exception) {
            return null;
        }
    }

    private static SharedPreferences getPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static float clampWakeWordSensitivity(float sensitivity) {
        if (Float.isNaN(sensitivity) || Float.isInfinite(sensitivity)) {
            return WakeWordConfig.haotika().threshold;
        }

        return Math.max(0.3f, Math.min(0.99f, sensitivity));
    }

    private static String normalizeTranscript(String transcript) {
        if (transcript == null) {
            return null;
        }

        String normalizedTranscript = transcript.trim().replaceAll("\\s+", " ");

        return normalizedTranscript.isEmpty() ? null : normalizedTranscript;
    }

    private static String formatUtcNow() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));

        return formatter.format(new Date());
    }
}

final class PendingVoiceCommand {

    final String capturedAt;
    final String errorCode;
    final String errorMessage;
    final String id;
    final String plannerIntentJson;
    final String source;
    final String transcript;

    PendingVoiceCommand(
        String id,
        String capturedAt,
        String transcript,
        String errorCode,
        String errorMessage,
        String plannerIntentJson,
        String source
    ) {
        this.id = id;
        this.capturedAt = capturedAt;
        this.transcript = transcript;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        this.plannerIntentJson = plannerIntentJson;
        this.source = source;
    }
}
