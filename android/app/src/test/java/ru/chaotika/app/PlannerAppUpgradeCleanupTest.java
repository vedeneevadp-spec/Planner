package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class PlannerAppUpgradeCleanupTest {

    @Test
    public void removesLegacyRuntimeAndPendingCommandsWithoutTouchingAuthWidgetsOrOfflineData() {
        Map<String, Object> preserved = Map.of(
            "planner.auth.planner.auth.session", "encrypted-session",
            "planner.auth.deviceId", "device-id",
            "planner.widget.today.snapshot", "snapshot",
            "planner.widget.pending-completed-task-ids", Set.of("task-1"),
            "planner.widget.sync.config", "widget-config",
            "planner.offline.outbox", "pending-edits",
            "planner.settings.theme", "dark",
            "planner.voiceAssistantOtherFeature", "unrelated-prefix"
        );
        PreferenceFixture fixture = new PreferenceFixture(preserved);
        fixture.values.put("planner.voice.api-config", "encrypted-voice-config");
        fixture.values.put("planner.voice.pending-command", "must-not-execute");
        fixture.values.put("planner.voice.wake-word-enabled", true);
        fixture.values.put("planner.voice.background-wake-word-enabled", true);
        fixture.values.put("planner.voice.runtime.metric.started.count", 42L);

        assertTrue(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertEquals(preserved, fixture.values);
        assertEquals(1, fixture.commits);

        assertTrue(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertEquals(preserved, fixture.values);
        assertEquals(1, fixture.commits);
    }

    @Test
    public void removesVoiceCiphertextWithoutDecryptingOrReplacingSharedAuthCredentials() {
        PreferenceFixture fixture = new PreferenceFixture(Map.of(
            "planner.auth.planner.auth.session", "v1:auth:opaque-ciphertext",
            "planner.auth.deviceId", "v1:device:opaque-ciphertext",
            "planner.voice.api-config", "malformed-old-ciphertext",
            "planner.voice.pending-command", "v1:pending:opaque-ciphertext"
        ));

        assertTrue(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertEquals(Map.of(
            "planner.auth.planner.auth.session", "v1:auth:opaque-ciphertext",
            "planner.auth.deviceId", "v1:device:opaque-ciphertext"
        ), fixture.values);
    }

    @Test
    public void failedCommitLeavesDataAvailableForAnIdempotentRetry() {
        PreferenceFixture fixture = new PreferenceFixture(Map.of(
            "planner.voice.pending-command", "old-command",
            "planner.auth.deviceId", "device-id"
        ));
        fixture.commitSucceeds = false;

        assertFalse(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertTrue(fixture.values.containsKey("planner.voice.pending-command"));

        fixture.commitSucceeds = true;
        assertTrue(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertEquals(Map.of("planner.auth.deviceId", "device-id"), fixture.values);
    }

    @Test
    public void removesOnlyTheKnownTrainingOptInAndCanRunAgain() {
        PreferenceFixture fixture = new PreferenceFixture(Map.of(
            "wake-word-training-opt-in", true,
            "unrelated-preference", "preserve"
        ));

        assertTrue(PlannerAppUpgradeCleanup.removeTrainingOptIn(fixture.preferences));
        assertTrue(PlannerAppUpgradeCleanup.removeTrainingOptIn(fixture.preferences));
        assertEquals(Map.of("unrelated-preference", "preserve"), fixture.values);
        assertEquals(1, fixture.commits);
    }

    @Test
    public void freshInstallDoesNotWriteEmptyPreferenceFiles() {
        PreferenceFixture fixture = new PreferenceFixture(Map.of());

        assertTrue(PlannerAppUpgradeCleanup.removeVoiceKeys(fixture.preferences));
        assertTrue(PlannerAppUpgradeCleanup.removeTrainingOptIn(fixture.preferences));
        assertEquals(0, fixture.commits);
    }

    private static final class PreferenceFixture {

        final Map<String, Object> values;
        final SharedPreferences preferences;
        boolean commitSucceeds = true;
        int commits;

        PreferenceFixture(Map<String, Object> initialValues) {
            values = new HashMap<>(initialValues);
            preferences = (SharedPreferences) Proxy.newProxyInstance(
                SharedPreferences.class.getClassLoader(),
                new Class<?>[] { SharedPreferences.class },
                (proxy, method, arguments) -> {
                    switch (method.getName()) {
                        case "getAll":
                            return new HashMap<>(values);
                        case "contains":
                            return values.containsKey(arguments[0]);
                        case "edit":
                            return editor();
                        default:
                            throw new AssertionError("Unexpected preferences access: " + method.getName());
                    }
                }
            );
        }

        private SharedPreferences.Editor editor() {
            Set<String> removedKeys = new HashSet<>();
            return (SharedPreferences.Editor) Proxy.newProxyInstance(
                SharedPreferences.Editor.class.getClassLoader(),
                new Class<?>[] { SharedPreferences.Editor.class },
                (proxy, method, arguments) -> {
                    switch (method.getName()) {
                        case "remove":
                            removedKeys.add((String) arguments[0]);
                            return proxy;
                        case "commit":
                            commits += 1;
                            if (commitSucceeds) {
                                removedKeys.forEach(values::remove);
                            }
                            return commitSucceeds;
                        default:
                            throw new AssertionError("Cleanup must only remove individual keys: " + method.getName());
                    }
                }
            );
        }
    }
}
