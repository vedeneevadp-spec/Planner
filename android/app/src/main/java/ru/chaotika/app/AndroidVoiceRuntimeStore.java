package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;

final class AndroidVoiceRuntimeStore {

    private static final String LAST_DURATION_MS_KEY = "planner.voice.runtime.last-duration-ms";
    private static final String LAST_ERROR_KEY = "planner.voice.runtime.last-error";
    private static final String PREFERENCES_NAME = "CapacitorStorage";
    private static final String STARTED_AT_ELAPSED_MS_KEY = "planner.voice.runtime.started-at-elapsed-ms";
    private static final String STARTED_AT_EPOCH_MS_KEY = "planner.voice.runtime.started-at-epoch-ms";
    private static final String STATUS_KEY = "planner.voice.runtime.status";

    private AndroidVoiceRuntimeStore() {}

    static void markStatus(Context context, AndroidVoiceRuntimeStatus status) {
        getPreferences(context).edit().putString(STATUS_KEY, status.value).apply();
    }

    static void markBlocked(Context context, AndroidVoiceRuntimeError error) {
        getPreferences(context)
            .edit()
            .putString(STATUS_KEY, AndroidVoiceRuntimeStatus.BLOCKED.value)
            .putString(LAST_ERROR_KEY, error.value)
            .apply();
        recordEvent(context, AndroidVoiceRuntimeMetric.GRACEFUL_DEGRADATION_USED);
    }

    static void markError(Context context, AndroidVoiceRuntimeError error) {
        getPreferences(context).edit().putString(LAST_ERROR_KEY, error.value).apply();
    }

    static void markServiceStarting(Context context) {
        long nowElapsed = SystemClock.elapsedRealtime();
        long nowEpoch = System.currentTimeMillis();

        getPreferences(context)
            .edit()
            .putString(STATUS_KEY, AndroidVoiceRuntimeStatus.STARTING.value)
            .putLong(STARTED_AT_ELAPSED_MS_KEY, nowElapsed)
            .putLong(STARTED_AT_EPOCH_MS_KEY, nowEpoch)
            .remove(LAST_ERROR_KEY)
            .apply();
        recordEvent(context, AndroidVoiceRuntimeMetric.WAKE_SERVICE_STARTED);
    }

    static void markServiceStopped(Context context) {
        SharedPreferences preferences = getPreferences(context);
        long durationMs = runtimeDurationMs(preferences);

        preferences
            .edit()
            .putString(STATUS_KEY, AndroidVoiceRuntimeStatus.STOPPED.value)
            .putLong(LAST_DURATION_MS_KEY, durationMs)
            .remove(STARTED_AT_ELAPSED_MS_KEY)
            .remove(STARTED_AT_EPOCH_MS_KEY)
            .remove(LAST_ERROR_KEY)
            .apply();
        recordEvent(context, AndroidVoiceRuntimeMetric.WAKE_SERVICE_STOPPED);
        recordValue(context, AndroidVoiceRuntimeMetric.WAKE_SERVICE_RUNTIME_MINUTES, durationMs / 60_000L);
    }

    static void markServiceStartFailed(Context context, AndroidVoiceRuntimeError error) {
        markBlocked(context, error);
        recordEvent(context, AndroidVoiceRuntimeMetric.WAKE_SERVICE_START_FAILED);
    }

    static void markServiceKilledOrRestarted(Context context) {
        getPreferences(context)
            .edit()
            .putString(STATUS_KEY, AndroidVoiceRuntimeStatus.STOPPED.value)
            .remove(STARTED_AT_ELAPSED_MS_KEY)
            .remove(STARTED_AT_EPOCH_MS_KEY)
            .apply();
        recordEvent(context, AndroidVoiceRuntimeMetric.SERVICE_KILLED_OR_RESTARTED);
    }

    static void reconcileAfterReboot(Context context) {
        SharedPreferences preferences = getPreferences(context);
        AndroidVoiceRuntimeStatus status = AndroidVoiceRuntimeStatus.fromValue(
            preferences.getString(STATUS_KEY, AndroidVoiceRuntimeStatus.STOPPED.value)
        );

        if (!isActiveStatus(status)) {
            return;
        }

        long startedAtElapsedMs = preferences.getLong(STARTED_AT_ELAPSED_MS_KEY, -1L);

        if (startedAtElapsedMs > SystemClock.elapsedRealtime()) {
            markServiceKilledOrRestarted(context);
        }
    }

    static void recordEvent(Context context, AndroidVoiceRuntimeMetric metric) {
        SharedPreferences preferences = getPreferences(context);
        long count = preferences.getLong(metricCountKey(metric), 0L);

        preferences.edit().putLong(metricCountKey(metric), count + 1L).apply();
    }

    static void recordValue(Context context, AndroidVoiceRuntimeMetric metric, long value) {
        getPreferences(context).edit().putLong(metricValueKey(metric), Math.max(0L, value)).apply();
    }

    static long readMetricValue(Context context, AndroidVoiceRuntimeMetric metric) {
        SharedPreferences preferences = getPreferences(context);
        String valueKey = metricValueKey(metric);

        if (preferences.contains(valueKey)) {
            return preferences.getLong(valueKey, 0L);
        }

        return preferences.getLong(metricCountKey(metric), 0L);
    }

    static boolean hasMetric(Context context, AndroidVoiceRuntimeMetric metric) {
        SharedPreferences preferences = getPreferences(context);

        return preferences.contains(metricValueKey(metric)) || preferences.contains(metricCountKey(metric));
    }

    static AndroidVoiceRuntimeSnapshot snapshot(Context context) {
        reconcileAfterReboot(context);

        SharedPreferences preferences = getPreferences(context);
        AndroidVoiceRuntimeStatus status = AndroidVoiceRuntimeStatus.fromValue(
            preferences.getString(STATUS_KEY, AndroidVoiceRuntimeStatus.STOPPED.value)
        );
        String lastError = preferences.getString(LAST_ERROR_KEY, null);

        return new AndroidVoiceRuntimeSnapshot(
            status,
            lastError == null || lastError.trim().isEmpty() ? null : lastError,
            runtimeDurationMs(preferences),
            preferences.getLong(STARTED_AT_EPOCH_MS_KEY, 0L)
        );
    }

    static boolean isActiveStatus(AndroidVoiceRuntimeStatus status) {
        return status == AndroidVoiceRuntimeStatus.STARTING ||
            status == AndroidVoiceRuntimeStatus.RUNNING_FOREGROUND ||
            status == AndroidVoiceRuntimeStatus.LISTENING_WAKE_WORD ||
            status == AndroidVoiceRuntimeStatus.PAUSED_FOR_COMMAND ||
            status == AndroidVoiceRuntimeStatus.PLAYING_START_SIGNAL ||
            status == AndroidVoiceRuntimeStatus.RECORDING_COMMAND ||
            status == AndroidVoiceRuntimeStatus.STOPPING;
    }

    private static long runtimeDurationMs(SharedPreferences preferences) {
        long startedAtElapsedMs = preferences.getLong(STARTED_AT_ELAPSED_MS_KEY, -1L);

        if (startedAtElapsedMs <= 0L) {
            return preferences.getLong(LAST_DURATION_MS_KEY, 0L);
        }

        return Math.max(0L, SystemClock.elapsedRealtime() - startedAtElapsedMs);
    }

    private static SharedPreferences getPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static String metricCountKey(AndroidVoiceRuntimeMetric metric) {
        return "planner.voice.runtime.metric." + metric.value + ".count";
    }

    private static String metricValueKey(AndroidVoiceRuntimeMetric metric) {
        return "planner.voice.runtime.metric." + metric.value + ".value";
    }
}

final class AndroidVoiceRuntimeSnapshot {

    final String lastError;
    final long runtimeDurationMs;
    final long startedAtEpochMs;
    final AndroidVoiceRuntimeStatus status;

    AndroidVoiceRuntimeSnapshot(
        AndroidVoiceRuntimeStatus status,
        String lastError,
        long runtimeDurationMs,
        long startedAtEpochMs
    ) {
        this.status = status;
        this.lastError = lastError;
        this.runtimeDurationMs = runtimeDurationMs;
        this.startedAtEpochMs = startedAtEpochMs;
    }
}
