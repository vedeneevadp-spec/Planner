package ru.chaotika.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;

public class WakeWordSampleRecorderActivity extends Activity {

    private static final int RECORD_AUDIO_REQUEST_CODE = 1709;
    private static final int RECORDING_DURATION_MS = 2_500;
    private static final String EXTRA_MODE = "mode";
    private static final String MODE_FALSE_REJECT = "false_reject";
    private static final String MODE_POSITIVE = "positive";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Button recordButton;
    private EditText speakerInput;
    private TextView statusText;
    private TextView countText;
    private Thread recordingThread;
    private String mode = MODE_POSITIVE;
    private volatile boolean isRecording;

    static Intent createIntent(Context context) {
        return new Intent(context, WakeWordSampleRecorderActivity.class)
            .putExtra(EXTRA_MODE, MODE_POSITIVE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static Intent createFalseRejectIntent(Context context) {
        return new Intent(context, WakeWordSampleRecorderActivity.class)
            .putExtra(EXTRA_MODE, MODE_FALSE_REJECT)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mode = MODE_FALSE_REJECT.equals(getIntent().getStringExtra(EXTRA_MODE)) ? MODE_FALSE_REJECT : MODE_POSITIVE;
        setTitle(isFalseRejectMode() ? "Запись Хаотика" : "Haotika samples");

        ScrollView scrollView = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(36, 36, 36, 36);
        container.setGravity(Gravity.START);

        TextView phraseText = new TextView(this);
        phraseText.setText("Произнеси: Хаотика");
        phraseText.setTextSize(26f);

        TextView hintText = new TextView(this);
        hintText.setText(getHintText());
        hintText.setTextSize(15f);

        speakerInput = new EditText(this);
        speakerInput.setSingleLine(true);
        speakerInput.setInputType(InputType.TYPE_CLASS_TEXT);
        speakerInput.setHint("speaker_001");
        speakerInput.setText("speaker_001");
        speakerInput.setVisibility(isFalseRejectMode() ? View.GONE : View.VISIBLE);

        recordButton = new Button(this);
        recordButton.setText("Записать");
        recordButton.setOnClickListener(view -> startRecordingWithPermission());

        statusText = new TextView(this);
        statusText.setText("Готово к записи.");
        statusText.setTextSize(15f);

        countText = new TextView(this);
        countText.setTextSize(14f);

        container.addView(
            phraseText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            hintText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            speakerInput,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            recordButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            statusText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            countText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        scrollView.addView(container);
        setContentView(scrollView);

        refreshCount();
    }

    @Override
    protected void onDestroy() {
        isRecording = false;
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (
            requestCode == RECORD_AUDIO_REQUEST_CODE &&
            grantResults.length > 0 &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            startRecordingWithPermission();
        } else if (requestCode == RECORD_AUDIO_REQUEST_CODE) {
            setStatus("Нет разрешения на микрофон.");
        }
    }

    private void startRecordingWithPermission() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, RECORD_AUDIO_REQUEST_CODE);
            return;
        }

        if (isRecording) {
            return;
        }

        if (isFalseRejectMode() && !WakeWordTrainingExampleStore.isCollectionEnabled(this)) {
            setStatus("Сначала включите согласие на сохранение аудио.");
            return;
        }

        String speakerId = "";
        if (!isFalseRejectMode()) {
            speakerId = WakeWordSampleProcessor.normalizeSpeakerId(speakerInput.getText().toString());
            speakerInput.setText(speakerId);
        }
        String recordingSpeakerId = speakerId;

        startService(WakeWordService.createStopIntent(this));

        isRecording = true;
        recordButton.setEnabled(false);
        setStatus("Говорите “Хаотика”...");

        recordingThread = new Thread(() -> recordSample(recordingSpeakerId), "haotika-sample-recorder");
        recordingThread.start();
    }

    @SuppressLint("MissingPermission")
    private void recordSample(String speakerId) {
        AudioRecord audioRecord = null;

        try {
            int minBufferSize = AudioRecord.getMinBufferSize(
                WakeWordSampleProcessor.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            );

            if (minBufferSize <= 0) {
                throw new IOException("Invalid AudioRecord buffer size: " + minBufferSize);
            }

            int totalSamples = (WakeWordSampleProcessor.SAMPLE_RATE * RECORDING_DURATION_MS) / 1_000;
            int frameSamples = Math.max(512, minBufferSize / 2);
            short[] rawSamples = new short[totalSamples];
            short[] frame = new short[frameSamples];
            int offset = 0;

            audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                WakeWordSampleProcessor.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minBufferSize * 2, WakeWordSampleProcessor.SAMPLE_RATE)
            );

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IOException("AudioRecord is not initialized.");
            }

            audioRecord.startRecording();

            while (isRecording && offset < totalSamples) {
                int read = audioRecord.read(frame, 0, Math.min(frame.length, totalSamples - offset));

                if (read > 0) {
                    System.arraycopy(frame, 0, rawSamples, offset, read);
                    offset += read;
                }
            }

            WakeWordSampleProcessor.ProcessedSample processed = WakeWordSampleProcessor.process(rawSamples, offset);

            if (isFalseRejectMode()) {
                WakeWordTrainingExampleStore.SaveResult result = WakeWordTrainingExampleStore.saveFalseReject(this, processed.samples);
                WakeWordMetricsLogger metricsLogger = new WakeWordMetricsLogger();

                metricsLogger.falseRejectReported();
                metricsLogger.trainingExampleSaved(result.label);
                showSuccess(result.audioFile, processed.durationMs);
            } else {
                File directory = getPositiveDirectory();

                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IOException("Cannot create output directory: " + directory.getAbsolutePath());
                }

                int sampleIndex = nextSampleIndex(directory, speakerId);
                File outputFile = new File(directory, WakeWordSampleProcessor.buildFileName(speakerId, sampleIndex));

                WakeWordSampleProcessor.writeWav(outputFile, processed.samples);
                showSuccess(outputFile, processed.durationMs);
            }
        } catch (WakeWordSampleProcessor.ValidationException error) {
            showFailure(error.getMessage());
        } catch (Exception error) {
            showFailure("Не удалось сохранить запись: " + error.getMessage());
        } finally {
            if (audioRecord != null) {
                try {
                    audioRecord.stop();
                } catch (IllegalStateException ignored) {
                    // Already stopped.
                }

                audioRecord.release();
            }

            handler.post(
                () -> {
                    isRecording = false;
                    recordButton.setEnabled(true);
                    refreshCount();
                    restartWakeWordServiceIfNeeded();
                }
            );
        }
    }

    private File getPositiveDirectory() {
        File externalDirectory = getExternalFilesDir("wakeword/haotika/positive");

        if (externalDirectory != null) {
            return externalDirectory;
        }

        return new File(getFilesDir(), "wakeword/haotika/positive");
    }

    private int nextSampleIndex(File directory, String speakerId) {
        int maxIndex = 0;
        File[] files = directory.listFiles();

        if (files == null) {
            return 1;
        }

        String prefix = WakeWordSampleProcessor.normalizeSpeakerId(speakerId) + "_";

        for (File file : files) {
            String name = file.getName();

            if (!name.startsWith(prefix) || !name.endsWith(".wav")) {
                continue;
            }

            String numericPart = name.substring(prefix.length(), name.length() - 4);

            try {
                maxIndex = Math.max(maxIndex, Integer.parseInt(numericPart));
            } catch (NumberFormatException ignored) {
                // Ignore files that do not follow speaker_001_001.wav format.
            }
        }

        return maxIndex + 1;
    }

    private void refreshCount() {
        if (isFalseRejectMode()) {
            WakeWordTrainingExampleStore.CollectionStatus status = WakeWordTrainingExampleStore.getStatus(this);

            countText.setText(
                "Сохранено false_reject WAV: " + status.falseRejectCount + "\nПапка: " +
                WakeWordTrainingExampleStore.getStoragePath(this) + "/" + WakeWordTrainingExampleStore.LABEL_FALSE_REJECT
            );
            return;
        }

        File directory = getPositiveDirectory();
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".wav"));
        int count = files == null ? 0 : files.length;

        countText.setText("Сохранено positive WAV: " + count + "\nПапка: " + directory.getAbsolutePath());
    }

    private void showSuccess(File file, int durationMs) {
        handler.post(() -> setStatus("Сохранено: " + file.getName() + "\nДлина после trim: " + durationMs + " ms"));
    }

    private void showFailure(String message) {
        handler.post(() -> setStatus(message));
    }

    private void setStatus(String value) {
        statusText.setText(value);
    }

    private String getHintText() {
        if (isFalseRejectMode()) {
            return "Нажмите “Записать”, произнесите одно слово и дождитесь проверки. " +
                "Файл сохранится как false_reject для дообучения модели.";
        }

        return "Нажмите “Записать”, произнесите одно слово и дождитесь сохранения. " +
            "Файл будет WAV, mono, 16 kHz, 16-bit PCM, с trim silence и normalize volume.";
    }

    private boolean isFalseRejectMode() {
        return MODE_FALSE_REJECT.equals(mode);
    }

    private void restartWakeWordServiceIfNeeded() {
        if (!isFalseRejectMode()) {
            return;
        }

        Intent intent = WakeWordService.createStartIntent(this);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
            return;
        }

        startService(intent);
    }
}
