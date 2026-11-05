package ru.chaotika.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;

final class PlannerIncomingDraftQueue {
    private static final int MAX_PENDING = 20;
    private final String key;
    private final String legacyPreferences;

    PlannerIncomingDraftQueue(String key, String legacyPreferences) {
        this.key = key;
        this.legacyPreferences = legacyPreferences;
    }

    synchronized void add(Context context, JSObject draft) {
        try {
            JSONArray pending = read(context);
            while (pending.length() >= MAX_PENDING) pending.remove(0);
            pending.put(draft);
            if (!PlannerSecureStorage.putString(context, key, pending.toString(), legacyPreferences)) {
                throw new IllegalStateException("Could not write draft queue");
            }
        } catch (Exception exception) {
            android.util.Log.e("PlannerIncoming", "Could not retain incoming draft.");
        }
    }

    synchronized JSObject peek(Context context) throws Exception {
        JSONArray pending = read(context);
        return pending.length() == 0 ? null : new JSObject(pending.getJSONObject(0).toString());
    }

    synchronized void acknowledge(Context context, String requestId) throws Exception {
        JSONArray pending = read(context);
        for (int index = 0; index < pending.length(); index++) {
            JSONObject draft = pending.getJSONObject(index);
            if (requestId.equals(draft.optString("requestId"))) {
                pending.remove(index);
                boolean stored = pending.length() == 0
                    ? PlannerSecureStorage.remove(context, key, legacyPreferences)
                    : PlannerSecureStorage.putString(context, key, pending.toString(), legacyPreferences);
                if (!stored) throw new IllegalStateException("Could not dismiss incoming draft");
                return;
            }
        }
    }

    private JSONArray read(Context context) throws Exception {
        String value = PlannerSecureStorage.getString(context, key, legacyPreferences);
        return value == null ? new JSONArray() : new JSONArray(value);
    }
}
