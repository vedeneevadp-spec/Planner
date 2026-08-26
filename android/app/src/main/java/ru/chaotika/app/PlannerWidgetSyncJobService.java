package ru.chaotika.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class PlannerWidgetSyncJobService extends JobService {

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final String LOG_TAG = "PlannerWidgetSync";
    private Future<?> activeJob;

    @Override
    public boolean onStartJob(JobParameters parameters) {
        activeJob = EXECUTOR.submit(() -> {
            PlannerWidgetSyncResult result = PlannerWidgetBackgroundSync.run(this);
            boolean shouldRetry = result == PlannerWidgetSyncResult.RETRY;

            Log.i(LOG_TAG, "Background widget sync finished: " + result.name());
            jobFinished(parameters, shouldRetry);
        });

        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        Future<?> job = activeJob;

        if (job != null) {
            job.cancel(true);
        }

        return true;
    }
}
