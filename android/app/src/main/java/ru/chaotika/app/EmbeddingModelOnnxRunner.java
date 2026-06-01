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

final class EmbeddingModelOnnxRunner implements AutoCloseable {

    static final int EMBEDDING_MEL_BINS = 32;
    static final int EMBEDDING_SIZE = 96;
    static final int EMBEDDING_WINDOW_FRAMES = 76;

    private final OrtEnvironment environment;
    private final String inputName;
    private final OrtSession session;

    EmbeddingModelOnnxRunner(OrtEnvironment environment, byte[] modelBytes) throws WakeWordError {
        try {
            this.environment = environment;
            try (OrtSession.SessionOptions options = OnnxWakeWordSessionOptions.create()) {
                this.session = environment.createSession(modelBytes, options);
            }
            if (session.getInputInfo().size() != 1 || session.getOutputInfo().size() != 1) {
                throw WakeWordError.modelIoMismatch("LiveKit embedding model must expose exactly one input and one output.");
            }
            Map.Entry<String, NodeInfo> input = session.getInputInfo().entrySet().iterator().next();
            this.inputName = input.getKey();
            if (!(input.getValue().getInfo() instanceof TensorInfo tensorInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit embedding model input is not a tensor.");
            }
            validateInputContract(tensorInfo.getShape(), tensorInfo.type);
            Map.Entry<String, NodeInfo> output = session.getOutputInfo().entrySet().iterator().next();
            if (!(output.getValue().getInfo() instanceof TensorInfo outputInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit embedding model output is not a tensor.");
            }
            validateOutputContract(outputInfo.getShape(), outputInfo.type);
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.modelLoadError(WakeWordProvider.CUSTOM_ONNX.metricValue, error);
        }
    }

    static void validateInputContract(long[] shape, OnnxJavaType type) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit embedding model input must be float32.");
        }

        if (
            shape.length != 4 ||
            !isSingleOrDynamic(shape[0]) ||
            shape[1] != EMBEDDING_WINDOW_FRAMES ||
            shape[2] != EMBEDDING_MEL_BINS ||
            shape[3] != 1L
        ) {
            throw WakeWordError.modelIoMismatch("LiveKit embedding model input must be shaped (batch, 76, 32, 1).");
        }
    }

    static void validateOutputContract(long[] shape, OnnxJavaType type) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit embedding model output must be float32.");
        }

        boolean isBatchEmbedding = shape.length == 2 && isSingleOrDynamic(shape[0]) && shape[1] == EMBEDDING_SIZE;
        boolean isBatchSqueezedEmbedding = shape.length == 4 &&
            isSingleOrDynamic(shape[0]) &&
            isSingleOrDynamic(shape[1]) &&
            isSingleOrDynamic(shape[2]) &&
            shape[3] == EMBEDDING_SIZE;

        if (!isBatchEmbedding && !isBatchSqueezedEmbedding) {
            throw WakeWordError.modelIoMismatch("LiveKit embedding model output must be shaped (batch, 96) or (batch, 1, 1, 96).");
        }
    }

    float[][] runWindows(float[][][] windows) throws WakeWordError {
        float[][][][] input = new float[windows.length][EMBEDDING_WINDOW_FRAMES][EMBEDDING_MEL_BINS][1];
        for (int windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
            for (int frameIndex = 0; frameIndex < EMBEDDING_WINDOW_FRAMES; frameIndex += 1) {
                for (int binIndex = 0; binIndex < EMBEDDING_MEL_BINS; binIndex += 1) {
                    input[windowIndex][frameIndex][binIndex][0] = windows[windowIndex][frameIndex][binIndex];
                }
            }
        }

        try (OnnxTensor tensor = OnnxTensor.createTensor(environment, input)) {
            try (OrtSession.Result result = session.run(Map.of(inputName, tensor))) {
                return readEmbeddings(result.get(0));
            }
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.inferenceError(error);
        }
    }

    private static float[][] readEmbeddings(OnnxValue output) throws OrtException, WakeWordError {
        Object value = output.getValue();

        if (value instanceof float[][] embeddings) {
            return requireEmbeddingSize(embeddings);
        }

        if (value instanceof float[][][][] embeddings && embeddings.length > 0) {
            float[][] result = new float[embeddings.length][EMBEDDING_SIZE];
            for (int index = 0; index < embeddings.length; index += 1) {
                if (embeddings[index].length == 0 || embeddings[index][0].length == 0 || embeddings[index][0][0].length != EMBEDDING_SIZE) {
                    throw WakeWordError.modelIoMismatch("LiveKit embedding model output must be shaped (batch, 1, 1, 96).");
                }
                System.arraycopy(embeddings[index][0][0], 0, result[index], 0, EMBEDDING_SIZE);
            }
            return result;
        }

        throw WakeWordError.modelIoMismatch("LiveKit embedding model output must be (batch, 96) or (batch, 1, 1, 96).");
    }

    private static float[][] requireEmbeddingSize(float[][] embeddings) throws WakeWordError {
        for (float[] embedding : embeddings) {
            if (embedding.length != EMBEDDING_SIZE) {
                throw WakeWordError.modelIoMismatch("LiveKit embedding model output must have 96 values.");
            }
        }

        return embeddings;
    }

    private static boolean isSingleOrDynamic(long dimension) {
        return dimension == 1L || dimension <= 0L;
    }

    @Override
    public void close() throws OrtException {
        session.close();
    }
}
