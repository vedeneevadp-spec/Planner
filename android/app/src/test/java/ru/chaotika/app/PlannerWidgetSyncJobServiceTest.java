package ru.chaotika.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlannerWidgetSyncJobServiceTest {

    @Test
    public void periodicJobWaitsForItsNextIntervalAfterNetworkFailure() {
        assertFalse(
            PlannerWidgetSyncJobService.shouldRetry(
                PlannerWidgetSyncScheduler.PERIODIC_JOB_ID,
                PlannerWidgetSyncResult.RETRY
            )
        );
    }

    @Test
    public void immediateJobUsesBackoffAfterNetworkFailure() {
        assertTrue(
            PlannerWidgetSyncJobService.shouldRetry(
                PlannerWidgetSyncScheduler.IMMEDIATE_JOB_ID,
                PlannerWidgetSyncResult.RETRY
            )
        );
    }

    @Test
    public void immediateJobDoesNotRetryRejectedAuthentication() {
        assertFalse(
            PlannerWidgetSyncJobService.shouldRetry(
                PlannerWidgetSyncScheduler.IMMEDIATE_JOB_ID,
                PlannerWidgetSyncResult.AUTH_UNAVAILABLE
            )
        );
    }
}
