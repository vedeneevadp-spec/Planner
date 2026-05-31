package ru.chaotika.app;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import java.util.Map;

final class WakeWordClassifierOnnxRunner implements AutoCloseable {

    private final int embeddingSize;
    private final int embeddingWindowSize;
    private final OrtEnvironment environment;
    private final String inputName;
    private final OrtSession session;

    WakeWordClassifierOnnxRunner(
        OrtEnvironment environment,
        byte[] modelBytes,
        int embeddingWindowSize,
        int embeddingSize
    ) throws WakeWordError {
        try {
            this.environment = environment;
            this.embeddingWindowSize = embeddingWindowSize;
            this.embeddingSize = embeddingSize;
            this.session = environment.createSession(modelBytes, new OrtSession.SessionOptions());
            if (session.getInputInfo().size() != 1 || session.getOutputInfo().size() != 1) {
                throw WakeWordError.modelIoMismatch("LiveKit classifier must expose exactly one input and one output.");
            }
            Map.Entry<String, NodeInfo> input = session.getInputInfo().entrySet().iterator().next();
            this.inputName = input.getKey();
            if (!(input.getValue().getInfo() instanceof TensorInfo tensorInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit classifier input is not a tensor.");
            }
            validateInputContract(inputName, tensorInfo.getShape(), tensorInfo.type, embeddingWindowSize, embeddingSize);
            Map.Entry<String, NodeInfo> output = session.getOutputInfo().entrySet().iterator().next();
            if (!(output.getValue().getInfo() instanceof TensorInfo outputInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit classifier output is not a tensor.");
            }
            validateOutputContract(output.getKey(), outputInfo.getShape(), outputInfo.type);
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.modelLoadError(WakeWordProvider.CUSTOM_ONNX.metricValue, error);
        }
    }

    static void validateInputContract(
        String inputName,
        long[] shape,
        OnnxJavaType type,
        int embeddingWindowSize,
        int embeddingSize
    ) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier input must be float32.");
        }

        if (!"embeddings".equals(inputName)) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier input name must be embeddings.");
        }

        if (
            shape.length != 3 ||
            !isSingleOrDynamic(shape[0]) ||
            shape[1] != embeddingWindowSize ||
            shape[2] != embeddingSize
        ) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier input must be shaped (batch, 16, 96).");
        }
    }

    static void validateOutputContract(String outputName, long[] shape, OnnxJavaType type) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier output must be float32.");
        }

        if (!"score".equals(outputName)) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier output name must be score.");
        }

        if (shape.length != 2 || !isSingleOrDynamic(shape[0]) || shape[1] != 1L) {
            throw WakeWordError.modelIoMismatch("LiveKit classifier output must be shaped (batch, 1).");
        }
    }

    float score(float[][] embeddings) throws WakeWordError {
        if (embeddings.length != embeddingWindowSize) {
            throw WakeWordError.frontendNotReady("LiveKit classifier requires " + embeddingWindowSize + " embeddings.");
        }

        float[][][] input = new float[1][embeddingWindowSize][embeddingSize];
        for (int windowIndex = 0; windowIndex < embeddingWindowSize; windowIndex += 1) {
            if (embeddings[windowIndex].length != embeddingSize) {
                throw WakeWordError.modelIoMismatch("LiveKit classifier embedding size mismatch.");
            }
            System.arraycopy(embeddings[windowIndex], 0, input[0][windowIndex], 0, embeddingSize);
        }

        try (OnnxTensor tensor = OnnxTensor.createTensor(environment, input)) {
            try (OrtSession.Result result = session.run(Map.of(inputName, tensor))) {
                return readScore(result.get(0));
            }
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.inferenceError(error);
        }
    }

    private static float readScore(OnnxValue output) throws OrtException, WakeWordError {
        Object value = output.getValue();

        if (value instanceof float[] scores && scores.length > 0) {
            return scores[0];
        }

        if (value instanceof float[][] scores && scores.length > 0 && scores[0].length > 0) {
            return scores[0][0];
        }

        throw WakeWordError.modelIoMismatch("LiveKit classifier output must be shaped (batch, 1).");
    }

    private static boolean isSingleOrDynamic(long dimension) {
        return dimension == 1L || dimension <= 0L;
    }

    @Override
    public void close() throws OrtException {
        session.close();
    }
}
