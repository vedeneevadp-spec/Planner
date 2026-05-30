package ru.chaotika.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.Locale;
import org.junit.Test;

public class AndroidVoiceRuntimeModelTest {

    @Test
    public void exposesStableRuntimeStatuses() {
        assertArrayEquals(
            new String[] {
                "disabled",
                "starting",
                "running_foreground",
                "listening_wake_word",
                "paused_for_command",
                "playing_listening_cue",
                "recording_command",
                "stopping",
                "stopped",
                "blocked",
            },
            Arrays.stream(AndroidVoiceRuntimeStatus.values()).map((status) -> status.value).toArray(String[]::new)
        );
    }

    @Test
    public void exposesStableRuntimeErrors() {
        assertArrayEquals(
            new String[] {
                "missing_microphone_permission",
                "missing_notification_permission",
                "missing_wake_model",
                "foreground_service_not_allowed",
                "battery_restricted",
                "security_exception",
                "wake_engine_error",
                "audio_cue_error",
                "recorder_error",
            },
            Arrays.stream(AndroidVoiceRuntimeError.values()).map((error) -> error.value).toArray(String[]::new)
        );
    }

    @Test
    public void exposesSafeRuntimeMetricNamesOnly() {
        assertArrayEquals(
            new String[] {
                "wake_service_started",
                "wake_service_stopped",
                "wake_service_start_failed",
                "wake_service_runtime_minutes",
                "wake_engine_started",
                "wake_engine_stopped",
                "wake_engine_error",
                "wake_detection_latency_ms",
                "command_recorder_start_latency_ms",
                "audio_cue_duration_ms",
                "audio_cue_to_recorder_delay_ms",
                "battery_sample",
                "cpu_sample",
                "memory_sample",
                "service_killed_or_restarted",
                "graceful_degradation_used",
            },
            Arrays.stream(AndroidVoiceRuntimeMetric.values()).map((metric) -> metric.value).toArray(String[]::new)
        );

        for (AndroidVoiceRuntimeMetric metric : AndroidVoiceRuntimeMetric.values()) {
            String value = metric.value.toLowerCase(Locale.US);

            assertFalse(value.contains("transcript"));
            assertFalse(value.contains("title"));
            assertFalse(value.contains("shopping"));
            assertFalse(value.contains("agenda"));
            assertFalse(value.contains("candidate"));
            assertFalse(value.contains("raw"));
        }
    }

    @Test
    public void missingWakeModelDisablesWakeWordButKeepsPushToTalkAvailable() {
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.missingWakeModel();

        assertEquals(AndroidVoiceRuntimeStatus.BLOCKED, degradation.status);
        assertEquals(AndroidVoiceRuntimeError.MISSING_WAKE_MODEL, degradation.error);
        assertFalse(degradation.wakeWordEnabled);
        assertFalse(degradation.backgroundWakeWordEnabled);
        assertTrue(degradation.pushToTalkAvailable);
        assertFalse(degradation.recorderBlocked);
        assertTrue(degradation.manualTextInputAvailable);
    }

    @Test
    public void microphoneRevokeBlocksRecorderAndPushToTalkUntilPermissionRestored() {
        AndroidVoiceRuntimePolicy.Degradation degradation = AndroidVoiceRuntimePolicy.microphonePermissionRevoked();

        assertEquals(AndroidVoiceRuntimeError.MISSING_MICROPHONE_PERMISSION, degradation.error);
        assertFalse(degradation.wakeWordEnabled);
        assertFalse(degradation.backgroundWakeWordEnabled);
        assertFalse(degradation.pushToTalkAvailable);
        assertTrue(degradation.recorderBlocked);
        assertTrue(degradation.manualTextInputAvailable);
    }

    @Test
    public void notificationRevokeBlocksOnlyBackgroundWakeWord() {
        AndroidVoiceRuntimePolicy.Degradation degradation =
            AndroidVoiceRuntimePolicy.notificationPermissionRevoked(true);

        assertEquals(AndroidVoiceRuntimeError.MISSING_NOTIFICATION_PERMISSION, degradation.error);
        assertTrue(degradation.wakeWordEnabled);
        assertFalse(degradation.backgroundWakeWordEnabled);
        assertTrue(degradation.pushToTalkAvailable);
        assertFalse(degradation.recorderBlocked);
    }

    @Test
    public void foregroundServiceSecurityExceptionMapsToTypedError() {
        AndroidVoiceRuntimePolicy.Degradation degradation =
            AndroidVoiceRuntimePolicy.serviceStartFailure(new SecurityException("blocked"));

        assertEquals(AndroidVoiceRuntimeStatus.BLOCKED, degradation.status);
        assertEquals(AndroidVoiceRuntimeError.SECURITY_EXCEPTION, degradation.error);
        assertTrue(degradation.pushToTalkAvailable);
    }

    @Test
    public void commandTimingKeepsCueMetadataOutOfRequestContent() {
        SttRequest request = SttRequest.afterWakeWord().withRuntimeTiming(100L, 400L, 280);

        assertEquals(SttSource.ANDROID_SHORT_CLIP, request.source);
        assertTrue(request.wakeWordDetected);
        assertEquals(100L, request.captureRequestedAtElapsedMs);
        assertEquals(400L, request.cueCompletedAtElapsedMs);
        assertEquals(280, request.audioCueDurationMs);
    }

    @Test
    public void wakeEngineClearsRingBufferOnStop() throws Exception {
        CustomTfliteWakeWordEngine engine = new CustomTfliteWakeWordEngine(
            WakeWordConfig.haotika(),
            new EmptyWakeWordAssetSource(),
            new WakeWordMetricsLogger()
        );

        setField(engine, "ringBuffer", new float[] { 0.2f, -0.3f, 0.4f });
        setField(engine, "ringWriteIndex", 2);
        setField(engine, "ringSamplesAvailable", 3);

        engine.stop();

        assertEquals(0, engine.bufferedSampleCountForTesting());
        assertEquals(3, engine.ringBufferCapacityForTesting());
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static final class EmptyWakeWordAssetSource implements WakeWordAssetSource {

        @Override
        public boolean exists(String path) {
            return false;
        }

        @Override
        public byte[] read(String path) {
            return new byte[0];
        }
    }
}
