package ru.chaotika.app;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;

final class LiveKitOnnxOfflineScorer {

    static final int PARITY_WINDOW_SECONDS = 2;

    private LiveKitOnnxOfflineScorer() {}

    static Result score(WakeWordModelManifest manifest, WakeWordAssetSource assets, float[] samples) throws WakeWordError {
        ensureManifestSupported(manifest);
        ensureAssetsExist(manifest, assets);

        OrtEnvironment environment = OrtEnvironment.getEnvironment();
        LiveKitFeatureExtractor featureExtractor = null;
        WakeWordClassifierOnnxRunner classifierRunner = null;

        try {
            MelSpectrogramOnnxRunner melRunner = new MelSpectrogramOnnxRunner(
                environment,
                assets.read(manifest.melSpectrogramModelPath)
            );
            EmbeddingModelOnnxRunner embeddingRunner = new EmbeddingModelOnnxRunner(
                environment,
                assets.read(manifest.embeddingModelPath)
            );
            featureExtractor = new LiveKitFeatureExtractor(melRunner, embeddingRunner);
            classifierRunner = new WakeWordClassifierOnnxRunner(
                environment,
                assets.read(manifest.classifierModelPath),
                manifest.frontendConfig.embeddingWindowSize,
                manifest.frontendConfig.embeddingSize
            );

            float[][] embeddings = featureExtractor.extractEmbeddings(samples);
            if (embeddings.length < manifest.frontendConfig.embeddingWindowSize) {
                throw WakeWordError.frontendNotReady(
                    "LiveKit parity scoring requires at least " + manifest.frontendConfig.embeddingWindowSize + " embeddings."
                );
            }

            RollingEmbeddingBuffer embeddingBuffer = new RollingEmbeddingBuffer(
                manifest.frontendConfig.embeddingWindowSize,
                manifest.frontendConfig.embeddingSize
            );
            embeddingBuffer.replaceWithLatest(embeddings);
            float[][] classifierInput = embeddingBuffer.classifierInput();

            return new Result(
                classifierRunner.score(classifierInput),
                embeddings.length,
                embeddings[0].length,
                classifierInput.length,
                classifierInput[0].length
            );
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.inferenceError(error);
        } finally {
            if (featureExtractor != null) {
                try {
                    featureExtractor.close();
                } catch (OrtException ignored) {
                    // Test/offline parity cleanup.
                }
            }

            if (classifierRunner != null) {
                try {
                    classifierRunner.close();
                } catch (OrtException ignored) {
                    // Test/offline parity cleanup.
                }
            }
        }
    }

    static float[] normalizeParityWindow(float[] samples, int sampleRate) {
        int windowSamples = sampleRate * PARITY_WINDOW_SECONDS;
        float[] window = new float[windowSamples];

        if (samples.length >= windowSamples) {
            System.arraycopy(samples, samples.length - windowSamples, window, 0, windowSamples);
            return window;
        }

        System.arraycopy(samples, 0, window, windowSamples - samples.length, samples.length);
        return window;
    }

    private static void ensureManifestSupported(WakeWordModelManifest manifest) throws WakeWordError {
        if (manifest.provider != WakeWordProvider.CUSTOM_ONNX) {
            throw WakeWordError.unsupportedProvider(manifest.provider.manifestValue);
        }

        if (manifest.inputKind != WakeWordModelInputKind.EMBEDDING_MATRIX) {
            throw WakeWordError.unsupportedModelInput("LiveKit parity scorer requires inputKind=embedding_matrix.");
        }

        if (manifest.frontend != WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD) {
            throw WakeWordError.unsupportedModelInput("LiveKit parity scorer requires frontend=livekit_openwakeword.");
        }
    }

    private static void ensureAssetsExist(WakeWordModelManifest manifest, WakeWordAssetSource assets) throws WakeWordError {
        if (!assets.exists(manifest.melSpectrogramModelPath)) {
            throw WakeWordError.missingFrontendModel(manifest.melSpectrogramModelPath);
        }

        if (!assets.exists(manifest.embeddingModelPath)) {
            throw WakeWordError.missingFrontendModel(manifest.embeddingModelPath);
        }

        if (!assets.exists(manifest.classifierModelPath)) {
            throw WakeWordError.missingModel(manifest.classifierModelPath);
        }
    }

    static final class Result {

        final int classifierEmbeddingSize;
        final int classifierWindowSize;
        final int generatedEmbeddingCount;
        final int generatedEmbeddingSize;
        final float score;

        Result(
            float score,
            int generatedEmbeddingCount,
            int generatedEmbeddingSize,
            int classifierWindowSize,
            int classifierEmbeddingSize
        ) {
            this.score = score;
            this.generatedEmbeddingCount = generatedEmbeddingCount;
            this.generatedEmbeddingSize = generatedEmbeddingSize;
            this.classifierWindowSize = classifierWindowSize;
            this.classifierEmbeddingSize = classifierEmbeddingSize;
        }
    }
}
