package ru.chaotika.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicBoolean;

public class PlannerWidgetSyncJobService extends JobService {

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final String LOG_TAG = "PlannerWidgetSync";
    private static final AtomicBoolean SYNC_RUNNING = new AtomicBoolean(false);
    private Future<?> activeJob;

    @Override
    public boolean onStartJob(JobParameters parameters) {
        if (!SYNC_RUNNING.compareAndSet(false, true)) {
            Log.i(LOG_TAG, "Background widget sync skipped: already running");
            return false;
        }

        FutureTask<Void> job = new FutureTask<Void>(() -> {
            PlannerWidgetSyncResult result = PlannerWidgetBackgroundSync.run(this);
            boolean shouldRetry = shouldRetry(parameters.getJobId(), result);

            Log.i(LOG_TAG, "Background widget sync finished: " + result.name());
            jobFinished(parameters, shouldRetry);
            return null;
        }) {
            @Override
            protected void done() {
                SYNC_RUNNING.set(false);
            }
        };

        activeJob = job;
        EXECUTOR.execute(job);

        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        Future<?> job = activeJob;

        if (job != null) {
            job.cancel(true);
        }

        return parameters.getJobId() == PlannerWidgetSyncScheduler.IMMEDIATE_JOB_ID;
    }

    static boolean shouldRetry(int jobId, PlannerWidgetSyncResult result) {
        return (
            jobId == PlannerWidgetSyncScheduler.IMMEDIATE_JOB_ID &&
            result == PlannerWidgetSyncResult.RETRY
        );
    }
}
