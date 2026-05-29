package ru.chaotika.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import java.util.Locale;

public class WakeWordTriggerReviewActivity extends Activity {

    private static final String STATE_DECISION_MADE = "decisionMade";

    private final WakeWordMetricsLogger metricsLogger = new WakeWordMetricsLogger();
    private Button continueButton;
    private Button falseAcceptButton;
    private Button recordButton;
    private Button skipButton;
    private TextView statusText;
    private Switch consentSwitch;
    private Button trueAcceptButton;
    private boolean decisionMade;

    static Intent createIntent(Context context) {
        return new Intent(context, WakeWordTriggerReviewActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        decisionMade = savedInstanceState != null && savedInstanceState.getBoolean(STATE_DECISION_MADE, false);
        setTitle("Проверка срабатывания");

        ScrollView scrollView = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(24), dp(22), dp(24), dp(22));
        container.setGravity(Gravity.START);

        TextView stepLabel = new TextView(this);
        stepLabel.setText("Проверка");
        stepLabel.setTextSize(14f);
        stepLabel.setPadding(0, 0, 0, dp(4));

        TextView title = new TextView(this);
        title.setText("Wake word сработал");
        title.setTextSize(22f);
        title.setPadding(0, 0, 0, dp(12));

        TextView note = new TextView(this);
        note.setText(
            "Перед записью команды отметьте, было ли срабатывание правильным. " +
            "Короткий фрагмент сохраняется на диск только с вашим разрешением."
        );
        note.setTextSize(15f);
        note.setLineSpacing(4f, 1f);
        note.setPadding(0, 0, 0, dp(16));

        consentSwitch = new Switch(this);
        consentSwitch.setText("Разрешаю сохранять короткие аудио-примеры wake-фразы");
        consentSwitch.setChecked(WakeWordTrainingExampleStore.isCollectionEnabled(this));
        consentSwitch.setOnCheckedChangeListener(
            (button, isChecked) -> {
                WakeWordTrainingExampleStore.setCollectionEnabled(this, isChecked);
                setStatus(
                    isChecked
                        ? "Сохранение фрагментов включено."
                        : "Сохранение фрагментов выключено. Текущий фрагмент не будет сохранен."
                );
                refreshButtons();
            }
        );

        TextView question = new TextView(this);
        question.setText("Это было правильное срабатывание?");
        question.setTextSize(17f);
        question.setPadding(0, dp(18), 0, dp(8));

        trueAcceptButton = new Button(this);
        trueAcceptButton.setText("Верно");
        trueAcceptButton.setOnClickListener(view -> submitWakeFeedback(true));

        falseAcceptButton = new Button(this);
        falseAcceptButton.setText("Ложно");
        falseAcceptButton.setOnClickListener(view -> submitWakeFeedback(false));

        skipButton = new Button(this);
        skipButton.setText("Пропустить");
        skipButton.setOnClickListener(view -> skipWakeFeedback());

        recordButton = new Button(this);
        recordButton.setText("Записать");
        recordButton.setOnClickListener(view -> openFalseRejectRecorder());

        statusText = new TextView(this);
        statusText.setTextSize(15f);
        statusText.setLineSpacing(4f, 1f);
        statusText.setPadding(0, dp(18), 0, dp(18));

        Button cancelButton = new Button(this);
        cancelButton.setText("Отмена");
        cancelButton.setOnClickListener(view -> cancelWakeFlow());

        continueButton = new Button(this);
        continueButton.setText("Продолжить");
        continueButton.setOnClickListener(view -> continueWakeFlow());

        LinearLayout bottomActions = new LinearLayout(this);
        bottomActions.setOrientation(LinearLayout.HORIZONTAL);
        bottomActions.setGravity(Gravity.END);
        bottomActions.addView(cancelButton, weightedButton());
        bottomActions.addView(continueButton, weightedButtonWithStartMargin());

        container.addView(stepLabel, fullWidth());
        container.addView(title, fullWidth());
        container.addView(note, fullWidth());
        container.addView(consentSwitch, fullWidth());
        container.addView(question, fullWidth());
        container.addView(trueAcceptButton, fullWidth());
        container.addView(falseAcceptButton, fullWidth());
        container.addView(skipButton, fullWidth());
        container.addView(recordButton, fullWidth());
        container.addView(statusText, fullWidth());
        container.addView(bottomActions, fullWidth());
        scrollView.addView(container);
        setContentView(scrollView);

        setStatus(buildInitialStatus());
        refreshButtons();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean(STATE_DECISION_MADE, decisionMade);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        cancelWakeFlow();
    }

    private void submitWakeFeedback(boolean isTrueAccept) {
        if (decisionMade) {
            return;
        }

        boolean collectionEnabled = WakeWordTrainingExampleStore.isCollectionEnabled(this);
        boolean hadPendingExample = WakeWordTrainingExampleStore.hasPendingExample();
        String label = isTrueAccept
            ? WakeWordTrainingExampleStore.LABEL_TRUE_ACCEPT
            : WakeWordTrainingExampleStore.LABEL_FALSE_ACCEPT;

        if (isTrueAccept) {
            metricsLogger.trueAcceptReported();
        } else {
            metricsLogger.falseAcceptReported();
        }

        if (!collectionEnabled) {
            WakeWordTrainingExampleStore.clearPending();
            markDecision("Оценка учтена. Фрагмент не сохранен: нет разрешения.");
            return;
        }

        if (!hadPendingExample) {
            markDecision("Оценка учтена, но фрагмента для сохранения нет.");
            return;
        }

        try {
            WakeWordTrainingExampleStore.SaveResult result = WakeWordTrainingExampleStore.savePending(this, label);

            metricsLogger.trainingExampleSaved(result.label);
            markDecision("Фрагмент сохранен: " + result.audioFile.getName());
        } catch (Exception error) {
            markDecision("Оценка учтена, но фрагмент не удалось сохранить.");
        }
    }

    private void skipWakeFeedback() {
        if (decisionMade) {
            return;
        }

        WakeWordTrainingExampleStore.clearPending();
        markDecision("Срабатывание пропущено. Фрагмент не сохранен.");
    }

    private void openFalseRejectRecorder() {
        if (decisionMade) {
            return;
        }

        if (!WakeWordTrainingExampleStore.isCollectionEnabled(this)) {
            setStatus("Сначала включите разрешение на сохранение аудио-примеров.");
            return;
        }

        startActivity(WakeWordSampleRecorderActivity.createWakeReviewFalseRejectIntent(this));
        markDecision("Открыта запись примера. После записи можно продолжить или отменить.");
    }

    private void markDecision(String message) {
        decisionMade = true;
        setStatus(message);
        refreshButtons();
    }

    private void continueWakeFlow() {
        if (!decisionMade) {
            setStatus("Сначала отметьте срабатывание или пропустите оценку.");
            return;
        }

        startWakeWordService(WakeWordService.createContinueAfterWakeReviewIntent(this));
        finish();
    }

    private void cancelWakeFlow() {
        startWakeWordService(WakeWordService.createCancelWakeReviewIntent(this));
        finish();
    }

    private void startWakeWordService(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
            return;
        }

        startService(intent);
    }

    private void refreshButtons() {
        trueAcceptButton.setEnabled(!decisionMade);
        falseAcceptButton.setEnabled(!decisionMade);
        skipButton.setEnabled(!decisionMade);
        recordButton.setEnabled(!decisionMade);
        consentSwitch.setEnabled(!decisionMade);
        continueButton.setEnabled(decisionMade);
    }

    private void setStatus(String value) {
        statusText.setText(value);
    }

    private String buildInitialStatus() {
        WakeWordTrainingExampleStore.PendingSummary summary = WakeWordTrainingExampleStore.pendingSummary();

        if (!summary.hasPendingExample) {
            return "Фрагмент для обучения недоступен. Можно отметить срабатывание без сохранения.";
        }

        return String.format(
            Locale.ROOT,
            "Фрагмент готов к оценке. Score: %.2f, noise RMS: %.4f.",
            summary.score,
            summary.noiseLevelRms
        );
    }

    private LinearLayout.LayoutParams fullWidth() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams weightedButton() {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    }

    private LinearLayout.LayoutParams weightedButtonWithStartMargin() {
        LinearLayout.LayoutParams params = weightedButton();

        params.setMargins(dp(10), 0, 0, 0);

        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
