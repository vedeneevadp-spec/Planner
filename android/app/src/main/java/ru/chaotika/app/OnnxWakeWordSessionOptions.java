package ru.chaotika.app;

import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

final class OnnxWakeWordSessionOptions {

    private static final int THREAD_COUNT = 1;

    private OnnxWakeWordSessionOptions() {}

    static OrtSession.SessionOptions create() throws OrtException {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();

        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        options.setInterOpNumThreads(THREAD_COUNT);
        options.setIntraOpNumThreads(THREAD_COUNT);
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);

        return options;
    }
}
