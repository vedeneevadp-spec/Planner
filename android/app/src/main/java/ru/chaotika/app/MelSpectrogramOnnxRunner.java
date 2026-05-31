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

final class MelSpectrogramOnnxRunner implements AutoCloseable {

    static final int MEL_BINS = 32;

    private final OrtEnvironment environment;
    private final String inputName;
    private final OrtSession session;

    MelSpectrogramOnnxRunner(OrtEnvironment environment, byte[] modelBytes) throws WakeWordError {
        try {
            this.environment = environment;
            this.session = environment.createSession(modelBytes, new OrtSession.SessionOptions());
            if (session.getInputInfo().size() != 1 || session.getOutputInfo().size() != 1) {
                throw WakeWordError.modelIoMismatch("LiveKit mel model must expose exactly one input and one output.");
            }
            Map.Entry<String, NodeInfo> input = session.getInputInfo().entrySet().iterator().next();
            this.inputName = input.getKey();
            if (!(input.getValue().getInfo() instanceof TensorInfo tensorInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit mel model input is not a tensor.");
            }
            validateInputContract(inputName, tensorInfo.getShape(), tensorInfo.type);
            Map.Entry<String, NodeInfo> output = session.getOutputInfo().entrySet().iterator().next();
            if (!(output.getValue().getInfo() instanceof TensorInfo outputInfo)) {
                throw WakeWordError.modelIoMismatch("LiveKit mel model output is not a tensor.");
            }
            validateOutputContract(output.getKey(), outputInfo.getShape(), outputInfo.type);
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.modelLoadError(WakeWordProvider.CUSTOM_ONNX.metricValue, error);
        }
    }

    static void validateInputContract(String inputName, long[] shape, OnnxJavaType type) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit mel model input must be float32: " + inputName);
        }

        if (shape.length != 2 || !isSingleOrDynamic(shape[0])) {
            throw WakeWordError.modelIoMismatch("LiveKit mel model input must be shaped (batch, samples).");
        }
    }

    static void validateOutputContract(String outputName, long[] shape, OnnxJavaType type) throws WakeWordError {
        if (type != OnnxJavaType.FLOAT) {
            throw WakeWordError.modelIoMismatch("LiveKit mel model output must be float32: " + outputName);
        }

        boolean isBatchTimeMel = shape.length == 3 && isSingleOrDynamic(shape[0]) && shape[2] == MEL_BINS;
        boolean isBatchChannelTimeMel = shape.length == 4 &&
            isSingleOrDynamic(shape[0]) &&
            isSingleOrDynamic(shape[1]) &&
            shape[3] == MEL_BINS;

        if (!isBatchTimeMel && !isBatchChannelTimeMel) {
            throw WakeWordError.modelIoMismatch(
                "LiveKit mel model output must be shaped (batch, time, 32) or (batch, 1, time, 32)."
            );
        }
    }

    float[][] run(float[] audioWindow) throws WakeWordError {
        float[][] input = new float[][] { audioWindow };

        try (OnnxTensor tensor = OnnxTensor.createTensor(environment, input)) {
            try (OrtSession.Result result = session.run(Map.of(inputName, tensor))) {
                return normalizeMel(readMelOutput(result.get(0)));
            }
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.inferenceError(error);
        }
    }

    private static float[][] readMelOutput(OnnxValue output) throws OrtException, WakeWordError {
        Object value = output.getValue();

        if (value instanceof float[][][] melBatch && melBatch.length > 0) {
            return requireMelBins(melBatch[0]);
        }

        if (value instanceof float[][][][] melBatch && melBatch.length > 0 && melBatch[0].length > 0) {
            return requireMelBins(melBatch[0][0]);
        }

        throw WakeWordError.modelIoMismatch("LiveKit mel model output must be (batch, time, 32) or (batch, 1, time, 32).");
    }

    private static float[][] requireMelBins(float[][] mel) throws WakeWordError {
        for (float[] frame : mel) {
            if (frame.length != MEL_BINS) {
                throw WakeWordError.modelIoMismatch("LiveKit mel model output must have 32 mel bins.");
            }
        }

        return mel;
    }

    private static float[][] normalizeMel(float[][] mel) {
        float[][] normalized = new float[mel.length][MEL_BINS];
        for (int frameIndex = 0; frameIndex < mel.length; frameIndex += 1) {
            for (int binIndex = 0; binIndex < MEL_BINS; binIndex += 1) {
                normalized[frameIndex][binIndex] = mel[frameIndex][binIndex] / 10f + 2f;
            }
        }

        return normalized;
    }

    private static boolean isSingleOrDynamic(long dimension) {
        return dimension == 1L || dimension <= 0L;
    }

    @Override
    public void close() throws OrtException {
        session.close();
    }
}
