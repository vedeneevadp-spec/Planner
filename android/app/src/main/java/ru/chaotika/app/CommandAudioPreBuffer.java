package ru.chaotika.app;

import java.util.Arrays;

final class CommandAudioPreBuffer {

    static final CommandAudioPreBuffer EMPTY = new CommandAudioPreBuffer(new byte[0], 0, 0);

    final int durationMs;
    final byte[] pcm16le;
    final int sampleRateHertz;

    private CommandAudioPreBuffer(byte[] pcm16le, int sampleRateHertz, int durationMs) {
        this.pcm16le = pcm16le.clone();
        this.sampleRateHertz = sampleRateHertz;
        this.durationMs = Math.max(0, durationMs);
    }

    static CommandAudioPreBuffer empty(int sampleRateHertz) {
        return new CommandAudioPreBuffer(new byte[0], sampleRateHertz, 0);
    }

    static CommandAudioPreBuffer fromFloatSamples(float[] samples, int sampleRateHertz) {
        if (samples == null || samples.length == 0 || sampleRateHertz <= 0) {
            return empty(sampleRateHertz);
        }

        byte[] pcm16le = new byte[samples.length * 2];

        for (int index = 0; index < samples.length; index += 1) {
            int clamped = Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767f)));

            pcm16le[index * 2] = (byte) (clamped & 0xff);
            pcm16le[index * 2 + 1] = (byte) ((clamped >> 8) & 0xff);
        }

        return fromPcm16Le(pcm16le, sampleRateHertz);
    }

    static CommandAudioPreBuffer fromPcm16Le(byte[] pcm16le, int sampleRateHertz) {
        if (pcm16le == null || pcm16le.length == 0 || sampleRateHertz <= 0) {
            return empty(sampleRateHertz);
        }

        int evenLength = pcm16le.length - (pcm16le.length % 2);

        if (evenLength <= 0) {
            return empty(sampleRateHertz);
        }

        int durationMs = Math.round((evenLength * 1000f) / (sampleRateHertz * 2f));

        return new CommandAudioPreBuffer(Arrays.copyOf(pcm16le, evenLength), sampleRateHertz, durationMs);
    }

    boolean isCompatibleWith(CommandRecordingConfig config) {
        return pcm16le.length > 0 && sampleRateHertz == config.sampleRateHertz;
    }
}
