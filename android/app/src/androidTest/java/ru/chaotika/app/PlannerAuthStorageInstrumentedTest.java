package ru.chaotika.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.PluginCall;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.CountDownLatch;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerAuthStorageInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();
    private static final String KEY = "planner.auth.planner.auth.session";
    private static final String GROUP = "CapacitorStorage";

    @Before @After public void clearSession() {
        assertTrue(PlannerSecureStorage.remove(context, KEY, GROUP));
        assertTrue(PlannerSecureStorage.remove(context, KEY + ".loggedOut", GROUP));
    }

    private PlannerWidgetAuthSession session(String token) {
        return new PlannerWidgetAuthSession("access", "test@example.test", "2026-11-15T00:00:00Z", token, null, "test-user");
    }

    @Test public void concurrentPreparationPersistsOneRetryMarkerAndStaleCommitCannotOverwrite() throws Exception {
        PlannerWidgetAuthSession original = session("original");
        assertTrue(PlannerWidgetAuthSessionStore.setSession(context, original.toJson().toString()));
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<PlannerWidgetAuthSession> first = executor.submit(() -> PlannerWidgetAuthSessionStore.prepareForRefresh(context, original));
            Future<PlannerWidgetAuthSession> second = executor.submit(() -> PlannerWidgetAuthSessionStore.prepareForRefresh(context, original));
            PlannerWidgetAuthSession prepared = first.get();
            assertNotNull(prepared.refreshRotationRequestId);
            assertEquals(prepared.refreshRotationRequestId, second.get().refreshRotationRequestId);
            assertEquals(prepared.refreshRotationRequestId, PlannerWidgetAuthSessionStore.read(context).refreshRotationRequestId);
            assertEquals("newer", PlannerWidgetAuthSessionStore.commitRefresh(context, prepared, session("newer")).refreshToken);
            assertEquals("newer", PlannerWidgetAuthSessionStore.commitRefresh(context, prepared, session("stale")).refreshToken);
            assertTrue(PlannerWidgetAuthSessionStore.removeSession(context));
            assertNull(PlannerWidgetAuthSessionStore.commitRefresh(context, prepared, session("must-not-resurrect")));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test public void logoutWinsConcurrentRefreshAndBlocksLeftoverCredentialsUntilNewSignIn() throws Exception {
        PlannerWidgetAuthSession original = session("original");
        assertTrue(PlannerWidgetAuthSessionStore.setSession(context, original.toJson().toString()));
        PlannerWidgetAuthSession prepared = PlannerWidgetAuthSessionStore.prepareForRefresh(context, original);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<?> refresh = executor.submit(() -> {
                start.await();
                return PlannerWidgetAuthSessionStore.commitRefresh(context, prepared, session("rotated"));
            });
            Future<Boolean> logout = executor.submit(() -> {
                start.await();
                return PlannerWidgetAuthSessionStore.removeSession(context);
            });
            start.countDown();
            refresh.get();
            assertTrue(logout.get());
            assertNull(PlannerWidgetAuthSessionStore.read(context));
            // Simulate a failed credential deletion after the marker was durable.
            assertTrue(PlannerSecureStorage.putString(context, KEY, original.toJson().toString(), GROUP));
            assertNull(PlannerWidgetAuthSessionStore.readRaw(context));
            assertNull(PlannerWidgetAuthSessionStore.prepareForRefresh(context, original));
            assertNull(PlannerWidgetAuthSessionStore.commitRefresh(context, prepared, session("late")));
            assertTrue(PlannerWidgetAuthSessionStore.setSession(context, session("new-login").toJson().toString()));
            assertEquals("new-login", PlannerWidgetAuthSessionStore.read(context).refreshToken);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test public void secureStoragePluginExposesEveryRequiredBridgeMethod() throws Exception {
        for (String name : new String[] {"get", "set", "remove", "prepareRefresh", "commitRefresh"}) {
            assertNotNull(PlannerAuthStoragePlugin.class.getMethod(name, PluginCall.class));
        }
    }
}
