package ru.chaotika.app;

import android.content.Context;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerWidgetBackgroundSync {

    private static final long ACCESS_TOKEN_REFRESH_AHEAD_MILLIS = 90_000L;

    private PlannerWidgetBackgroundSync() {}

    static PlannerWidgetSyncResult run(Context rawContext) {
        Context context = rawContext.getApplicationContext();
        PlannerWidgetSyncConfig config = PlannerWidgetStorage.readSyncConfig(context);

        if (config == null || !PlannerWidgetSyncScheduler.hasAnyWidgets(context)) {
            return PlannerWidgetSyncResult.NOT_CONFIGURED;
        }

        PlannerWidgetStorage.recordSyncAttempt(context);

        try {
            PlannerWidgetAuthSession session = getUsableSession(context, config);

            if (session == null) {
                PlannerWidgetStorage.recordSyncFailure(context, "auth_unavailable");
                return PlannerWidgetSyncResult.AUTH_UNAVAILABLE;
            }

            PlannerWidgetNetworkClient client = new PlannerWidgetNetworkClient(config);
            String dateKey = getTodayKey(config.timeZone);
            PlannerWidgetRemoteData data;

            try {
                data = client.loadWidgetData(session.accessToken, dateKey);
            } catch (PlannerWidgetHttpException exception) {
                if (!exception.isUnauthorized()) {
                    throw exception;
                }

                PlannerWidgetAuthSession refreshedSession = recoverAfterUnauthorized(
                    context,
                    config,
                    session
                );

                if (refreshedSession == null) {
                    PlannerWidgetStorage.recordSyncFailure(context, "auth_rejected");
                    return PlannerWidgetSyncResult.AUTH_UNAVAILABLE;
                }

                data = client.loadWidgetData(refreshedSession.accessToken, dateKey);
            }

            Date generatedAt = new Date();
            String snapshot = PlannerWidgetSnapshotFactory.buildSnapshot(
                data.tasks,
                data.spheres,
                data.selfCareDashboard,
                data.cleaningToday,
                config.timeZone,
                generatedAt
            );
            String generatedAtValue = new JSONObject(snapshot).getString("generatedAt");
            List<String> pendingCompletedTaskIds = PlannerWidgetStorage.readPendingCompletedTaskIds(
                context
            );

            for (String pendingTaskId : pendingCompletedTaskIds) {
                String optimisticSnapshot = PlannerWidgetContract.markTaskDone(
                    snapshot,
                    pendingTaskId,
                    generatedAtValue
                );

                if (optimisticSnapshot != null) {
                    snapshot = optimisticSnapshot;
                }
            }

            if (!PlannerWidgetStorage.writeSnapshot(context, snapshot)) {
                PlannerWidgetStorage.recordSyncFailure(context, "storage_failed");
                return PlannerWidgetSyncResult.RETRY;
            }

            PlannerWidgetStorage.recordSyncSuccess(context);
            PlannerWidgetUpdateDispatcher.updateAllWidgets(context);

            return PlannerWidgetSyncResult.SUCCESS;
        } catch (PlannerWidgetHttpException exception) {
            PlannerWidgetStorage.recordSyncFailure(
                context,
                exception.isUnauthorized() ? "auth_rejected" : "http_" + exception.status
            );
            return exception.isRetryable()
                ? PlannerWidgetSyncResult.RETRY
                : PlannerWidgetSyncResult.AUTH_UNAVAILABLE;
        } catch (IOException exception) {
            PlannerWidgetStorage.recordSyncFailure(context, "network");
            return PlannerWidgetSyncResult.RETRY;
        } catch (JSONException | RuntimeException exception) {
            PlannerWidgetStorage.recordSyncFailure(context, "invalid_data");
            return PlannerWidgetSyncResult.RETRY;
        }
    }

    private static PlannerWidgetAuthSession getUsableSession(
        Context context,
        PlannerWidgetSyncConfig config
    ) throws IOException, JSONException, PlannerWidgetHttpException {
        PlannerWidgetAuthSession session = PlannerWidgetAuthSessionStore.read(context);

        if (session == null) {
            return null;
        }

        if (session.isAccessTokenUsable(new Date(), ACCESS_TOKEN_REFRESH_AHEAD_MILLIS)) {
            return session;
        }

        return refreshSession(context, config, session);
    }

    private static PlannerWidgetAuthSession recoverAfterUnauthorized(
        Context context,
        PlannerWidgetSyncConfig config,
        PlannerWidgetAuthSession failedSession
    ) throws IOException, JSONException, PlannerWidgetHttpException {
        PlannerWidgetAuthSession latestSession = PlannerWidgetAuthSessionStore.read(context);

        if (latestSession == null) {
            return null;
        }

        if (
            !latestSession.accessToken.equals(failedSession.accessToken) &&
            latestSession.isAccessTokenUsable(new Date(), 0)
        ) {
            return latestSession;
        }

        return refreshSession(context, config, latestSession);
    }

    private static PlannerWidgetAuthSession refreshSession(
        Context context,
        PlannerWidgetSyncConfig config,
        PlannerWidgetAuthSession expectedSession
    ) throws IOException, JSONException, PlannerWidgetHttpException {
        PlannerWidgetAuthSession preparedSession = PlannerWidgetAuthSessionStore.prepareForRefresh(
            context,
            expectedSession
        );

        if (preparedSession == null) {
            return null;
        }

        if (
            !preparedSession.refreshToken.equals(expectedSession.refreshToken) &&
            preparedSession.isAccessTokenUsable(new Date(), 0)
        ) {
            return preparedSession;
        }

        String deviceId = PlannerWidgetAuthSessionStore.getOrCreateDeviceId(context);
        JSONObject response = new PlannerWidgetNetworkClient(config).refreshAuthSession(
            preparedSession,
            deviceId
        );
        PlannerWidgetAuthSession refreshedSession = PlannerWidgetAuthSession.fromRefreshResponse(
            response
        );

        if (refreshedSession == null) {
            throw new JSONException("Widget auth refresh response is invalid.");
        }

        return PlannerWidgetAuthSessionStore.commitRefresh(
            context,
            preparedSession,
            refreshedSession
        );
    }

    private static String getTodayKey(String timeZoneId) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd", Locale.US);

        formatter.setTimeZone(resolveTimeZone(timeZoneId));
        return formatter.format(new Date());
    }

    private static TimeZone resolveTimeZone(String timeZoneId) {
        TimeZone timeZone = TimeZone.getTimeZone(timeZoneId);

        return "GMT".equals(timeZone.getID()) && !"GMT".equalsIgnoreCase(timeZoneId)
            ? TimeZone.getDefault()
            : timeZone;
    }
}

enum PlannerWidgetSyncResult {
    AUTH_UNAVAILABLE,
    NOT_CONFIGURED,
    RETRY,
    SUCCESS,
}
