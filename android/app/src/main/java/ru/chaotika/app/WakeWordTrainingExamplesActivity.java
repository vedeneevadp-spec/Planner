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

public class WakeWordTrainingExamplesActivity extends Activity {

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final WakeWordMetricsLogger metricsLogger = new WakeWordMetricsLogger();
    private TextView statusText;
    private Switch consentSwitch;
    private Button trueAcceptButton;
    private Button falseAcceptButton;
    private Button skipButton;
    private Button recordButton;

    static Intent createIntent(Context context) {
        return new Intent(context, WakeWordTrainingExamplesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Примеры wake-фразы");

        ScrollView scrollView = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(36, 36, 36, 36);
        container.setGravity(Gravity.START);

        TextView title = new TextView(this);
        title.setText("Помочь улучшить распознавание “Хаотика”");
        title.setTextSize(19f);
        title.setPadding(0, 0, 0, 12);

        consentSwitch = new Switch(this);
        consentSwitch.setText("Разрешаю сохранять короткие примеры wake-фразы");
        consentSwitch.setChecked(WakeWordTrainingExampleStore.isCollectionEnabled(this));
        consentSwitch.setOnCheckedChangeListener(
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

        TextView note = new TextView(this);
        note.setText(
            "После срабатывания wake word короткий фрагмент хранится только в памяти. " +
            "На диск он сохраняется только после вашего ответа. Если модель не сработала, " +
            "нажмите “Записать” и произнесите “Хаотика”."
        );
        note.setTextSize(15f);
        note.setPadding(0, 12, 0, 28);

        TextView question = new TextView(this);
        question.setText("Это было правильное срабатывание?");
        question.setTextSize(17f);
        question.setPadding(0, 0, 0, 8);

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

        recordButton = new Button(this);
        recordButton.setText("Записать");
        recordButton.setOnClickListener(view -> startActivity(WakeWordSampleRecorderActivity.createFalseRejectIntent(this)));

        statusText = new TextView(this);
        statusText.setTextSize(15f);
        statusText.setLineSpacing(4f, 1f);
        statusText.setPadding(0, 28, 0, 0);

        container.addView(title, fullWidth());
        container.addView(consentSwitch, fullWidth());
        container.addView(note, fullWidth());
        container.addView(question, fullWidth());
        container.addView(trueAcceptButton, fullWidth());
        container.addView(falseAcceptButton, fullWidth());
        container.addView(skipButton, fullWidth());
        container.addView(recordButton, fullWidth());
        container.addView(statusText, fullWidth());
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

    private LinearLayout.LayoutParams fullWidth() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void refreshLoop() {
        refresh();
        handler.postDelayed(this::refreshLoop, 1_000L);
    }

    private void refresh() {
        WakeWordTrainingExampleStore.CollectionStatus collectionStatus = WakeWordTrainingExampleStore.getStatus(this);
        WakeWordTrainingExampleStore.PendingSummary pendingSummary = WakeWordTrainingExampleStore.pendingSummary();

        trueAcceptButton.setEnabled(collectionStatus.isEnabled && collectionStatus.hasPendingExample);
        falseAcceptButton.setEnabled(collectionStatus.isEnabled && collectionStatus.hasPendingExample);
        skipButton.setEnabled(collectionStatus.hasPendingExample);
        recordButton.setEnabled(true);

        statusText.setText(
            "Сбор включен: " + collectionStatus.isEnabled + "\n" +
            "Есть пример для оценки: " + collectionStatus.hasPendingExample + "\n" +
            "Score: " + pendingSummary.score + "\n" +
            "Noise RMS: " + pendingSummary.noiseLevelRms + "\n" +
            "True accept сохранено: " + collectionStatus.trueAcceptCount + "\n" +
            "False accept сохранено: " + collectionStatus.falseAcceptCount + "\n" +
            "False reject сохранено: " + collectionStatus.falseRejectCount + "\n" +
            "Папка: " + WakeWordTrainingExampleStore.getStoragePath(this)
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
