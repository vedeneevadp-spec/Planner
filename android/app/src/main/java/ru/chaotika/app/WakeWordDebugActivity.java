package ru.chaotika.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public class WakeWordDebugActivity extends Activity {

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final WakeWordMetricsLogger metricsLogger = new WakeWordMetricsLogger();
    private TextView diagnosticsText;
    private Switch sampleCollectionSwitch;
    private Button trueAcceptButton;
    private Button falseAcceptButton;
    private Button skipButton;
    private Button recordButton;

    static Intent createIntent(Context context) {
        return new Intent(context, WakeWordDebugActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Wake word diagnostics");

        ScrollView scrollView = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(36, 36, 36, 36);
        container.setGravity(Gravity.START);

        diagnosticsText = new TextView(this);
        diagnosticsText.setTextSize(16f);
        diagnosticsText.setLineSpacing(4f, 1f);

        TextView collectionTitle = new TextView(this);
        collectionTitle.setText("Помочь улучшить распознавание “Хаотика”");
        collectionTitle.setTextSize(17f);
        collectionTitle.setPadding(0, 28, 0, 8);

        sampleCollectionSwitch = new Switch(this);
        sampleCollectionSwitch.setText("Разрешаю сохранять короткие примеры wake-фразы");
        sampleCollectionSwitch.setChecked(WakeWordTrainingExampleStore.isCollectionEnabled(this));
        sampleCollectionSwitch.setOnCheckedChangeListener(
            (button, isChecked) -> {
                WakeWordTrainingExampleStore.setCollectionEnabled(this, isChecked);
                Toast
                    .makeText(
                        this,
                        isChecked ? "Сбор примеров включен." : "Сбор примеров выключен.",
                        Toast.LENGTH_SHORT
                    )
                    .show();
                refresh();
            }
        );

        TextView pendingQuestion = new TextView(this);
        pendingQuestion.setText("Это было правильное срабатывание?");
        pendingQuestion.setTextSize(17f);
        pendingQuestion.setPadding(0, 28, 0, 8);

        trueAcceptButton = new Button(this);
        trueAcceptButton.setText("Верно");
        trueAcceptButton.setOnClickListener(
            view -> {
                savePendingExample(true);
                refresh();
            }
        );

        falseAcceptButton = new Button(this);
        falseAcceptButton.setText("Ложно");
        falseAcceptButton.setOnClickListener(
            view -> {
                savePendingExample(false);
                refresh();
            }
        );

        skipButton = new Button(this);
        skipButton.setText("Пропустить");
        skipButton.setOnClickListener(
            view -> {
                skipPendingExample();
                refresh();
            }
        );

        Button debugFalseAcceptButton = new Button(this);
        debugFalseAcceptButton.setText("False accept");
        debugFalseAcceptButton.setOnClickListener(
            view -> {
                metricsLogger.falseAcceptReported();
                refresh();
            }
        );

        recordButton = new Button(this);
        recordButton.setText("Записать");
        recordButton.setOnClickListener(view -> startActivity(WakeWordSampleRecorderActivity.createFalseRejectIntent(this)));

        Button sampleRecorderButton = new Button(this);
        sampleRecorderButton.setText("Record positive samples");
        sampleRecorderButton.setOnClickListener(view -> startActivity(WakeWordSampleRecorderActivity.createIntent(this)));

        container.addView(
            diagnosticsText,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            collectionTitle,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            sampleCollectionSwitch,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            pendingQuestion,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            trueAcceptButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            falseAcceptButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            skipButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            debugFalseAcceptButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            recordButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        container.addView(
            sampleRecorderButton,
            new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        );
        scrollView.addView(container);
        setContentView(scrollView);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshLoop();
    }

    @Override
    protected void onPause() {
        handler.removeCallbacksAndMessages(null);
        super.onPause();
    }

    private void refreshLoop() {
        refresh();
        handler.postDelayed(this::refreshLoop, 1_000L);
    }

    private void refresh() {
        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        WakeWordTrainingExampleStore.CollectionStatus collectionStatus = WakeWordTrainingExampleStore.getStatus(this);
        WakeWordTrainingExampleStore.PendingSummary pendingSummary = WakeWordTrainingExampleStore.pendingSummary();

        trueAcceptButton.setEnabled(collectionStatus.isEnabled && collectionStatus.hasPendingExample);
        falseAcceptButton.setEnabled(collectionStatus.isEnabled && collectionStatus.hasPendingExample);
        skipButton.setEnabled(collectionStatus.hasPendingExample);
        recordButton.setEnabled(true);

        diagnosticsText.setText(
            "Phrase: " + snapshot.phrase + "\n" +
            "Model version: " + snapshot.modelVersion + "\n" +
            "Provider: " + snapshot.provider.metricValue + "\n" +
            "Threshold: " + snapshot.threshold + "\n" +
            "Current score: " + snapshot.currentScore + "\n" +
            "Last detection score: " + snapshot.lastDetectionScore + "\n" +
            "Detection count: " + snapshot.detectionCount + "\n" +
            "Last metric: " + snapshot.lastMetric + "\n" +
            "Last error: " + snapshot.lastError + "\n" +
            "Sample collection enabled: " + collectionStatus.isEnabled + "\n" +
            "Pending sample: " + collectionStatus.hasPendingExample + "\n" +
            "Pending score: " + pendingSummary.score + "\n" +
            "Pending noise RMS: " + pendingSummary.noiseLevelRms + "\n" +
            "Saved true accepts: " + collectionStatus.trueAcceptCount + "\n" +
            "Saved false accepts: " + collectionStatus.falseAcceptCount + "\n" +
            "Saved false rejects: " + collectionStatus.falseRejectCount
        );
    }

    private void savePendingExample(boolean isTrueAccept) {
        try {
            String label = isTrueAccept
                ? WakeWordTrainingExampleStore.LABEL_TRUE_ACCEPT
                : WakeWordTrainingExampleStore.LABEL_FALSE_ACCEPT;
            WakeWordTrainingExampleStore.SaveResult result = WakeWordTrainingExampleStore.savePending(this, label);

            if (isTrueAccept) {
                metricsLogger.trueAcceptReported();
            } else {
                metricsLogger.falseAcceptReported();
            }

            metricsLogger.trainingExampleSaved(result.label);
            Toast.makeText(this, "Сохранено: " + result.audioFile.getName(), Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            Toast.makeText(this, "Нет примера для сохранения.", Toast.LENGTH_SHORT).show();
        }
    }

    private void skipPendingExample() {
        if (!WakeWordTrainingExampleStore.hasPendingExample()) {
            Toast.makeText(this, "Нет примера для пропуска.", Toast.LENGTH_SHORT).show();
            return;
        }

        WakeWordTrainingExampleStore.clearPending();
        Toast.makeText(this, "Пример пропущен.", Toast.LENGTH_SHORT).show();
    }

}
