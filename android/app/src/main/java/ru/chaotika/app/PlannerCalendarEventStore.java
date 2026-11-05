package ru.chaotika.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.CalendarContract;
import com.getcapacitor.JSObject;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

final class PlannerCalendarEventStore {
    private static final String KEY = "planner.calendar.pending-events.v1";
    private static final String LEGACY_PREFERENCES = "planner_calendar_events";
    private static final String EVENT_DIRECTORY_MIME_TYPE = "vnd.android.cursor.dir/event";
    private static final String EVENT_ITEM_MIME_TYPE = "vnd.android.cursor.item/event";
    private static final int MAX_PENDING = 20;

    private PlannerCalendarEventStore() {}

    static boolean isCalendarInsert(Intent intent) {
        if (intent == null || (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        if (!Intent.ACTION_INSERT.equals(intent.getAction()) && !Intent.ACTION_INSERT_OR_EDIT.equals(intent.getAction())) return false;
        String type = intent.getType();
        return EVENT_DIRECTORY_MIME_TYPE.equals(type)
            || EVENT_ITEM_MIME_TYPE.equals(type)
            || CalendarContract.Events.CONTENT_URI.equals(intent.getData());
    }

    static JSObject parse(Intent intent) {
        if (!isCalendarInsert(intent)) return null;
        try {
            Bundle extras = intent.getExtras();
            JSObject event = new JSObject();
            event.put("requestId", UUID.randomUUID().toString());
            event.put("title", text(extras, CalendarContract.Events.TITLE, 240));
            event.put("description", text(extras, CalendarContract.Events.DESCRIPTION, 10000));
            event.put("location", text(extras, CalendarContract.Events.EVENT_LOCATION, 2000));
            Long begin = timestamp(extras, CalendarContract.EXTRA_EVENT_BEGIN_TIME);
            Long end = timestamp(extras, CalendarContract.EXTRA_EVENT_END_TIME);
            event.put("beginTime", begin == null ? JSONObject.NULL : begin);
            event.put("endTime", begin != null && end != null && end > begin ? end : JSONObject.NULL);
            event.put("allDay", extras != null && Boolean.TRUE.equals(extras.get(CalendarContract.EXTRA_EVENT_ALL_DAY)));
            return event;
        } catch (RuntimeException exception) {
            // Another app controls the parcel. Never log its contents or crash the planner.
            return null;
        }
    }

    static synchronized void receive(Context context, Intent intent) {
        JSObject event = parse(intent);
        if (event == null) return;
        try {
            JSONArray previous = read(context);
            JSONArray next = new JSONArray();
            for (int index = Math.max(0, previous.length() - MAX_PENDING + 1); index < previous.length(); index++) {
                next.put(previous.getJSONObject(index));
            }
            next.put(event);
            if (!PlannerSecureStorage.putString(context, KEY, next.toString(), LEGACY_PREFERENCES)) {
                throw new IllegalStateException("Could not store calendar draft");
            }
        } catch (Exception exception) {
            android.util.Log.e("PlannerCalendar", "Could not retain incoming calendar draft.");
        }
    }

    static synchronized JSObject peek(Context context) throws Exception {
        JSONArray pending = read(context);
        if (pending.length() == 0) return null;
        return new JSObject(pending.getJSONObject(0).toString());
    }

    static synchronized void acknowledge(Context context, String requestId) throws Exception {
        JSONArray pending = read(context);
        JSONArray remaining = new JSONArray();
        for (int index = 0; index < pending.length(); index++) {
            JSONObject event = pending.getJSONObject(index);
            if (!requestId.equals(event.optString("requestId"))) remaining.put(event);
        }
        boolean stored = remaining.length() == 0
            ? PlannerSecureStorage.remove(context, KEY, LEGACY_PREFERENCES)
            : PlannerSecureStorage.putString(context, KEY, remaining.toString(), LEGACY_PREFERENCES);
        if (!stored) throw new IllegalStateException("Could not consume calendar draft");
    }

    private static JSONArray read(Context context) throws Exception {
        String value = PlannerSecureStorage.getString(context, KEY, LEGACY_PREFERENCES);
        return value == null ? new JSONArray() : new JSONArray(value);
    }

    private static String text(Bundle extras, String key, int maxLength) {
        Object value = extras == null ? null : extras.get(key);
        if (!(value instanceof CharSequence)) return "";
        String text = value.toString().trim();
        return text.substring(0, Math.min(text.length(), maxLength));
    }

    private static Long timestamp(Bundle extras, String key) {
        Object value = extras == null ? null : extras.get(key);
        if (!(value instanceof Long) && !(value instanceof Integer)) return null;
        long millis = ((Number) value).longValue();
        return millis >= 0 && millis <= 253402300799999L ? millis : null;
    }
}
