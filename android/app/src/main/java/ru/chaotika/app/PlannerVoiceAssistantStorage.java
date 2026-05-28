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

    private static final String PENDING_COMMAND_KEY = "planner.voice.pending-command";
    private static final String PREFERENCES_NAME = "CapacitorStorage";
    private static final String STATE_KEY = "planner.voice.state";

    private PlannerVoiceAssistantStorage() {}

    static void storeState(Context context, VoiceAssistantState state) {
        getPreferences(context).edit().putString(STATE_KEY, state.value).apply();
    }

    static String readState(Context context) {
        return getPreferences(context).getString(STATE_KEY, VoiceAssistantState.IDLE.value);
    }

    static void storePendingCommand(Context context, String transcript) {
        String normalizedTranscript = normalizeTranscript(transcript);

        if (normalizedTranscript == null) {
            return;
        }

        String capturedAt = formatUtcNow();
        JSONObject command = new JSONObject();

        try {
            command.put("id", "voice-" + capturedAt + "-" + Math.abs(normalizedTranscript.hashCode()));
            command.put("capturedAt", capturedAt);
            command.put("transcript", normalizedTranscript);
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

            if (id.isEmpty() || capturedAt.isEmpty() || transcript == null) {
                return null;
            }

            return new PendingVoiceCommand(id, capturedAt, transcript);
        } catch (JSONException exception) {
            return null;
        }
    }

    private static SharedPreferences getPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
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
    final String id;
    final String transcript;

    PendingVoiceCommand(String id, String capturedAt, String transcript) {
        this.id = id;
        this.capturedAt = capturedAt;
        this.transcript = transcript;
    }
}
