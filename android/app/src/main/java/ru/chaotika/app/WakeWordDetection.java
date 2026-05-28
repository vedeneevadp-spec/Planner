package ru.chaotika.app;

final class WakeWordDetection {

    final String phraseId;
    final String displayPhrase;
    final float score;
    final long detectedAtEpochMillis;
    final short[] audioSamples;
    final int sampleRate;
    final float noiseLevelRms;

    WakeWordDetection(String phraseId, String displayPhrase, float score, long detectedAtEpochMillis) {
        this(phraseId, displayPhrase, score, detectedAtEpochMillis, null, 0, 0f);
    }

    WakeWordDetection(
        String phraseId,
        String displayPhrase,
        float score,
        long detectedAtEpochMillis,
        short[] audioSamples,
        int sampleRate,
        float noiseLevelRms
    ) {
        this.phraseId = phraseId;
        this.displayPhrase = displayPhrase;
        this.score = score;
        this.detectedAtEpochMillis = detectedAtEpochMillis;
        this.audioSamples = audioSamples == null ? null : audioSamples.clone();
        this.sampleRate = sampleRate;
        this.noiseLevelRms = noiseLevelRms;
    }

    boolean hasAudioSamples() {
        return audioSamples != null && audioSamples.length > 0 && sampleRate > 0;
    }
}
