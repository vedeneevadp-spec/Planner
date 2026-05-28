package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class WakeWordSampleProcessorTest {

    @Test
    public void process_trimsSilenceAndNormalizesVolume() throws Exception {
        short[] samples = new short[WakeWordSampleProcessor.SAMPLE_RATE * 2];
        int voiceStart = WakeWordSampleProcessor.SAMPLE_RATE / 2;
        int voiceEnd = voiceStart + WakeWordSampleProcessor.SAMPLE_RATE;

        for (int index = voiceStart; index < voiceEnd; index += 1) {
            samples[index] = (short) (index % 2 == 0 ? 4_000 : -4_000);
        }

        WakeWordSampleProcessor.ProcessedSample processed = WakeWordSampleProcessor.process(samples, samples.length);

        assertTrue(processed.durationMs >= 1_000);
        assertTrue(processed.durationMs < 1_250);
        assertTrue(findPeak(processed.samples) > 20_000);
    }

    @Test
    public void process_rejectsTooShortVoice() {
        short[] samples = new short[WakeWordSampleProcessor.SAMPLE_RATE];

        for (int index = 1_000; index < 1_600; index += 1) {
            samples[index] = 6_000;
        }

        assertValidationError(samples, "Слишком коротко");
    }

    @Test
    public void process_rejectsTooLongVoice() {
        short[] samples = new short[WakeWordSampleProcessor.SAMPLE_RATE * 3];

        for (int index = 1_000; index < samples.length - 1_000; index += 1) {
            samples[index] = 6_000;
        }

        assertValidationError(samples, "Слишком длинно");
    }

    @Test
    public void writeWav_writes16kMonoPcmHeader() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        WakeWordSampleProcessor.writeWav(output, new short[] { 1, -1 });

        byte[] value = output.toByteArray();
        assertEquals("RIFF", new String(value, 0, 4, StandardCharsets.US_ASCII));
        assertEquals("WAVE", new String(value, 8, 4, StandardCharsets.US_ASCII));
        assertEquals("fmt ", new String(value, 12, 4, StandardCharsets.US_ASCII));
        assertEquals(16_000, readLittleEndianInt(value, 24));
        assertEquals(1, readLittleEndianShort(value, 22));
        assertEquals(16, readLittleEndianShort(value, 34));
        assertEquals("data", new String(value, 36, 4, StandardCharsets.US_ASCII));
        assertEquals(4, readLittleEndianInt(value, 40));
    }

    @Test
    public void buildFileName_usesSpeakerAndPaddedIndex() {
        assertEquals("speaker_001_007.wav", WakeWordSampleProcessor.buildFileName("1", 7));
    }

    private static void assertValidationError(short[] samples, String expectedMessagePart) {
        try {
            WakeWordSampleProcessor.process(samples, samples.length);
        } catch (WakeWordSampleProcessor.ValidationException error) {
            assertTrue(error.getMessage().contains(expectedMessagePart));
            return;
        }

        throw new AssertionError("Expected validation error.");
    }

    private static int findPeak(short[] samples) {
        int peak = 0;

        for (short sample : samples) {
            peak = Math.max(peak, Math.abs(sample));
        }

        return peak;
    }

    private static int readLittleEndianInt(byte[] value, int offset) {
        return (
            (value[offset] & 0xff) |
            ((value[offset + 1] & 0xff) << 8) |
            ((value[offset + 2] & 0xff) << 16) |
            ((value[offset + 3] & 0xff) << 24)
        );
    }

    private static int readLittleEndianShort(byte[] value, int offset) {
        return (value[offset] & 0xff) | ((value[offset + 1] & 0xff) << 8);
    }
}
