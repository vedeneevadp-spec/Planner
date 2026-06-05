package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.lang.reflect.Field;
import java.util.Locale;
import org.junit.Test;

public class CommandAudioTest {

    @Test
    public void validatesPcm16MonoShortClip() throws Exception {
        CommandAudio audio = CommandAudio.fromPcm16Le(
            createVoiceAudio(600, 2800),
            createVoiceAudio(600, 2800).length,
            CommandRecordingConfig.defaultConfig()
        );

        assertEquals(16000, audio.sampleRateHertz);
        assertEquals(1, audio.channelCount);
        assertEquals(16, audio.bitsPerSample);
        assertEquals("pcm_s16le", audio.encoding);
        assertTrue(audio.hasVoiceActivity);
    }

    @Test
    public void rejectsTooShortAudioLocally() {
        assertValidationError(createVoiceAudio(200, 2800), SttError.TOO_SHORT);
    }

    @Test
    public void rejectsTooLongAudioLocally() {
        assertValidationError(
            createVoiceAudio(CommandRecordingConfig.DEFAULT_MAX_DURATION_MS + 500, 2800),
            SttError.TOO_LONG
        );
    }

    @Test
    public void rejectsSilenceLocally() {
        assertValidationError(new byte[16000], SttError.NO_SPEECH);
    }

    @Test
    public void rejectsTooQuietAudioLocally() {
        byte[] audio = new byte[16000 * 2];
        short sample = 800;

        audio[0] = (byte) (sample & 0xff);
        audio[1] = (byte) ((sample >> 8) & 0xff);

        assertValidationError(audio, SttError.TOO_QUIET);
    }

    @Test
    public void voiceActivitySeparatesSinglePeakFromSilence() {
        byte[] audio = new byte[16000 * 2];
        short sample = 800;

        audio[0] = (byte) (sample & 0xff);
        audio[1] = (byte) ((sample >> 8) & 0xff);

        Pcm16AudioActivity.Result activity = Pcm16AudioActivity.analyzeRange(audio, 0, audio.length);

        assertFalse(activity.isSilent);
        assertTrue(activity.isTooQuiet);
        assertFalse(activity.hasVoiceActivity);
    }

    @Test
    public void voiceActivityIgnoresSingleNoisePeak() {
        byte[] frame = new byte[(CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ * 40 * 2) / 1000];
        short sample = 900;

        frame[0] = (byte) (sample & 0xff);
        frame[1] = (byte) ((sample >> 8) & 0xff);

        Pcm16AudioActivity.Result activity = Pcm16AudioActivity.analyzeRange(frame, 0, frame.length);

        assertTrue(activity.peak >= 700);
        assertTrue(!activity.hasVoiceActivity);
    }

    @Test
    public void voiceActivityDetectsSustainedSpeechFrame() {
        byte[] frame = createVoiceAudio(40, 2800);
        Pcm16AudioActivity.Result activity = Pcm16AudioActivity.analyzeRange(frame, 0, frame.length);

        assertTrue(activity.hasVoiceActivity);
    }

    @Test
    public void commandVadStopsAfterInitialSilenceTimeout() {
        CommandRecordingConfig config = CommandRecordingConfig.defaultConfig();
        CommandRecordingVad vad = new CommandRecordingVad(config, 1_000L);
        byte[] frame = new byte[(CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ * 40 * 2) / 1000];

        vad.observe(Pcm16AudioActivity.analyzeRange(frame, 0, frame.length), 1_040L);

        assertFalse(vad.hasSpeech());
        assertFalse(vad.shouldStop(3_499L, config.initialSilenceTimeoutMs - 1));
        assertTrue(vad.shouldStop(3_500L, config.initialSilenceTimeoutMs));
    }

    @Test
    public void commandVadIgnoresSingleNoisePeakBeforeSpeech() {
        CommandRecordingConfig config = CommandRecordingConfig.defaultConfig();
        CommandRecordingVad vad = new CommandRecordingVad(config, 1_000L);
        byte[] frame = new byte[(CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ * 40 * 2) / 1000];
        short sample = 900;

        frame[0] = (byte) (sample & 0xff);
        frame[1] = (byte) ((sample >> 8) & 0xff);

        vad.observe(Pcm16AudioActivity.analyzeRange(frame, 0, frame.length), 1_040L);

        assertFalse(vad.hasSpeech());
        assertTrue(vad.shouldStop(3_500L, config.initialSilenceTimeoutMs));
    }

    @Test
    public void commandVadUsesSofterSpeechStartForAndroidMicGain() {
        CommandRecordingConfig config = CommandRecordingConfig.defaultConfig();
        CommandRecordingVad vad = new CommandRecordingVad(config, 1_000L);
        byte[] softSpeech = createVoiceAudio(40, 560);

        Pcm16AudioActivity.Result activity = Pcm16AudioActivity.analyzeRange(softSpeech, 0, softSpeech.length);

        assertFalse(activity.hasVoiceActivity);

        vad.observe(activity, 1_040L);

        assertTrue(vad.hasSpeech());
        assertFalse(vad.shouldStop(1_939L, config.silenceTimeoutMs - 1));
        assertTrue(vad.shouldStop(1_940L, config.silenceTimeoutMs));
    }

    @Test
    public void attachesPreBufferButRequiresMainRecordingVoice() throws Exception {
        byte[] preBuffer = createVoiceAudio(CommandRecordingConfig.VOICE_PREBUFFER_MS, 2800);
        byte[] mainRecording = createVoiceAudio(600, 2800);
        byte[] combined = concat(preBuffer, mainRecording);

        CommandAudio audio = CommandAudio.fromPcm16Le(
            combined,
            combined.length,
            CommandRecordingConfig.defaultConfig(),
            CommandRecordingConfig.VOICE_PREBUFFER_MS,
            600,
            preBuffer.length,
            mainRecording.length
        );

        assertEquals(CommandRecordingConfig.VOICE_PREBUFFER_MS, audio.preBufferMs);
        assertEquals(600, audio.recordingDurationMs);
        assertTrue(audio.durationMs >= 800);
    }

    @Test
    public void rejectsWakeTailPreBufferWithoutUserSpeechInMainRecording() {
        byte[] preBuffer = createVoiceAudio(CommandRecordingConfig.VOICE_PREBUFFER_MS, 2800);
        byte[] mainRecording = new byte[(CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ * 900 * 2) / 1000];
        byte[] combined = concat(preBuffer, mainRecording);

        try {
            CommandAudio.fromPcm16Le(
                combined,
                combined.length,
                CommandRecordingConfig.defaultConfig(),
                CommandRecordingConfig.VOICE_PREBUFFER_MS,
                900,
                preBuffer.length,
                mainRecording.length
            );
            fail("Expected STT validation error.");
        } catch (SttException error) {
            assertEquals(SttError.NO_SPEECH, error.code);
        }
    }

    @Test
    public void backendSpeechToTextServiceDoesNotDeclareProviderKeys() {
        for (Field field : BackendSpeechToTextService.class.getDeclaredFields()) {
            String fieldName = field.getName().toLowerCase(Locale.US);

            assertTrue(!fieldName.contains("yandex"));
            assertTrue(!fieldName.contains("openai"));
            assertTrue(!fieldName.contains("google"));
            assertTrue(!fieldName.contains("apikey"));
            assertTrue(!fieldName.contains("api_key"));
        }
    }

    @Test
    public void separatesWakeWordAndPushToTalkSources() {
        assertEquals(SttSource.ANDROID_SHORT_CLIP, SttRequest.afterWakeWord().source);
        assertTrue(SttRequest.afterWakeWord().wakeWordDetected);
        assertEquals(SttSource.ANDROID_PUSH_TO_TALK, SttRequest.pushToTalk().source);
        assertTrue(SttRequest.pushToTalk().explicitUserAction);
    }

    private static void assertValidationError(byte[] audio, SttError expectedCode) {
        try {
            CommandAudio.fromPcm16Le(audio, audio.length, CommandRecordingConfig.defaultConfig());
            fail("Expected STT validation error.");
        } catch (SttException error) {
            assertEquals(expectedCode, error.code);
        }
    }

    private static byte[] createVoiceAudio(int durationMs, int amplitude) {
        int sampleCount = (CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ * durationMs) / 1000;
        byte[] audio = new byte[sampleCount * 2];

        for (int index = 0; index < sampleCount; index++) {
            short sample = (short) (Math.sin(index / 7d) * amplitude);
            audio[index * 2] = (byte) (sample & 0xff);
            audio[index * 2 + 1] = (byte) ((sample >> 8) & 0xff);
        }

        return audio;
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] combined = new byte[first.length + second.length];

        System.arraycopy(first, 0, combined, 0, first.length);
        System.arraycopy(second, 0, combined, first.length, second.length);

        return combined;
    }
}
