package ru.chaotika.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.json.JSONException;
import org.json.JSONObject;

public class PlannerTaskNotificationJobService extends JobService {
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private Future<?> running;

    @Override
    public boolean onStartJob(JobParameters parameters) {
        running = EXECUTOR.submit(() -> {
            boolean retry = false;
            try {
                int processed = 0;
                for (PlannerTaskNotification entry : PlannerTaskNotificationStore.read(this)) {
                    if (Thread.currentThread().isInterrupted()) return;
                    if (!PlannerTaskNotification.PENDING.equals(entry.state())) continue;
                    if (++processed > 4) { retry = true; break; }
                    retry |= !complete(entry);
                }
                for (PlannerTaskNotification entry : PlannerTaskNotificationStore.read(this)) {
                    retry |= PlannerTaskNotification.PENDING.equals(entry.state());
                }
            } catch (RuntimeException exception) {
                retry = true;
                android.util.Log.e("PlannerNotifications", "Notification action will be retried.");
            }
            if (!Thread.currentThread().isInterrupted()) jobFinished(parameters, retry);
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        if (running != null) running.cancel(true);
        return true;
    }

    private boolean complete(PlannerTaskNotification original) {
        PlannerTaskNotification entry = original;
        try {
            if (!entry.belongsTo(PlannerWidgetAuthSessionStore.read(this))) {
                discard(entry);
                return true;
            }
            PlannerWidgetSyncConfig currentConfig = PlannerWidgetStorage.readSyncConfig(this);
            if (currentConfig == null || !entry.apiBaseUrl().equals(currentConfig.apiBaseUrl)) {
                fail(entry);
                return true;
            }
            PlannerWidgetSyncConfig config = new PlannerWidgetSyncConfig(currentConfig.apiBaseUrl, entry.workspaceId(), currentConfig.timeZone);
            PlannerWidgetAuthSession session = PlannerWidgetBackgroundSync.getUsableSession(this, config);
            if (!entry.belongsTo(session)) { discard(entry); return true; }
            PlannerWidgetNetworkClient client = new PlannerWidgetNetworkClient(config);
            JSONObject task;
            try {
                task = client.loadTask(session.accessToken, entry.taskId());
            } catch (PlannerWidgetHttpException exception) {
                if (!exception.isUnauthorized()) throw exception;
                session = PlannerWidgetBackgroundSync.recoverAfterUnauthorized(this, config, session);
                if (!entry.belongsTo(session)) { discard(entry); return true; }
                task = client.loadTask(session.accessToken, entry.taskId());
            }
            PlannerTaskCompletion.Decision decision = PlannerTaskCompletion.decide(task, entry.expectedVersion());
            if (decision == PlannerTaskCompletion.Decision.ALREADY_DONE) { discard(entry); PlannerTaskNotifications.notifyTaskChanged(); return true; }
            if (decision != PlannerTaskCompletion.Decision.COMPLETE) { fail(entry); return true; }
            if (entry.expectedVersion() == 0) {
                PlannerTaskNotification next = entry.withExpectedVersion(task.getInt("version"));
                if (!PlannerTaskNotificationStore.replace(this, entry, next)) return true;
                entry = next;
            }
            // Check the durable account again immediately before the mutation.
            if (Thread.currentThread().isInterrupted()) return false;
            if (!entry.belongsTo(PlannerWidgetAuthSessionStore.read(this))) { discard(entry); return true; }
            client.completeTask(session.accessToken, entry.taskId(), entry.expectedVersion());
            discard(entry);
            PlannerTaskNotifications.notifyTaskChanged();
            PlannerWidgetSyncScheduler.schedule(this, true);
            return true;
        } catch (PlannerWidgetHttpException exception) {
            if (exception.isRetryable()) return false;
            if (exception.status == 404) discard(entry); else fail(entry);
            return true;
        } catch (IOException exception) {
            return false;
        } catch (JSONException exception) {
            fail(entry);
            return true;
        }
    }

    private void discard(PlannerTaskNotification entry) {
        if (PlannerTaskNotificationStore.replace(this, entry, null)) PlannerTaskNotifications.cancel(this, entry);
    }

    private void fail(PlannerTaskNotification entry) {
        PlannerTaskNotification next = entry.withState(PlannerTaskNotification.ERROR, 0);
        if (PlannerTaskNotificationStore.replace(this, entry, next)) PlannerTaskNotifications.show(this, next, true);
    }
}
