package ru.chaotika.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.res.ColorStateList;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

public class PlannerWidgetConfigurationActivity extends Activity {

    private static final int[] OPACITY_OPTIONS = {40, 55, 70, 85, 100};
    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private int selectedOpacity = 85;
    private boolean selectedReadOnly = false;
    private boolean selectedShowCleaning = false;
    private boolean selectedShowSelfCare = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);

        Intent intent = getIntent();
        Bundle extras = intent == null ? null : intent.getExtras();

        if (extras != null) {
            appWidgetId = extras.getInt(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID
            );
        }

        PlannerWidgetConfiguration configuration = PlannerWidgetStorage.readConfiguration(this);

        selectedOpacity = configuration.backgroundOpacityPercent;
        selectedReadOnly = configuration.readOnly;
        selectedShowSelfCare = configuration.showSelfCare;
        selectedShowCleaning = configuration.showCleaning;
        setContentView(createContentView());
    }

    private ScrollView createContentView() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setLayoutParams(
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(Color.rgb(20, 23, 28));

        LinearLayout content = new LinearLayout(this);
        content.setLayoutParams(
            new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        scrollView.addView(content);

        TextView title = new TextView(this);
        title.setText(R.string.planner_widget_configuration_title);
        title.setTextColor(Color.rgb(255, 249, 240));
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        content.addView(title);

        TextView opacityLabel = new TextView(this);
        opacityLabel.setTextColor(Color.argb(210, 255, 255, 255));
        opacityLabel.setTextSize(16);
        opacityLabel.setPadding(0, dp(18), 0, dp(10));
        content.addView(opacityLabel);

        SeekBar opacitySeekBar = new SeekBar(this);
        opacitySeekBar.setMax(OPACITY_OPTIONS.length - 1);
        opacitySeekBar.setProgress(getOpacityIndex(selectedOpacity));
        content.addView(
            opacitySeekBar,
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        CheckBox readOnlyCheckBox = createCheckBox(
            R.string.planner_widget_configuration_read_only,
            selectedReadOnly
        );
        CheckBox showSelfCareCheckBox = createCheckBox(
            R.string.planner_widget_configuration_show_self_care,
            selectedShowSelfCare
        );
        CheckBox showCleaningCheckBox = createCheckBox(
            R.string.planner_widget_configuration_show_cleaning,
            selectedShowCleaning
        );

        content.addView(readOnlyCheckBox);
        content.addView(showSelfCareCheckBox);
        content.addView(showCleaningCheckBox);

        Button doneButton = new Button(this);
        LinearLayout.LayoutParams doneButtonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(52)
        );

        doneButtonParams.setMargins(0, dp(18), 0, 0);
        doneButton.setText(R.string.planner_widget_configuration_done);
        doneButton.setTextColor(Color.rgb(20, 23, 28));
        doneButton.setTextSize(16);
        doneButton.setTypeface(Typeface.DEFAULT_BOLD);
        doneButton.setBackground(createButtonBackground());
        content.addView(doneButton, doneButtonParams);

        updateOpacityLabel(opacityLabel, selectedOpacity);
        opacitySeekBar.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    selectedOpacity = OPACITY_OPTIONS[progress];
                    updateOpacityLabel(opacityLabel, selectedOpacity);
                }

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {}

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {}
            }
        );
        readOnlyCheckBox.setOnCheckedChangeListener(
            (buttonView, isChecked) -> selectedReadOnly = isChecked
        );
        showSelfCareCheckBox.setOnCheckedChangeListener(
            (buttonView, isChecked) -> selectedShowSelfCare = isChecked
        );
        showCleaningCheckBox.setOnCheckedChangeListener(
            (buttonView, isChecked) -> selectedShowCleaning = isChecked
        );
        doneButton.setOnClickListener(view -> saveAndClose());

        return scrollView;
    }

    private void saveAndClose() {
        PlannerWidgetStorage.writeConfiguration(
            this,
            selectedOpacity,
            selectedReadOnly,
            selectedShowSelfCare,
            selectedShowCleaning
        );
        PlannerWidgetUpdateDispatcher.updateAllWidgets(this);
        PlannerWidgetSyncScheduler.schedule(this, true);

        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    private void updateOpacityLabel(TextView label, int opacity) {
        label.setText(getString(R.string.planner_widget_configuration_opacity) + ": " + opacity + "%");
    }

    private GradientDrawable createButtonBackground() {
        GradientDrawable drawable = new GradientDrawable();

        drawable.setColor(Color.rgb(142, 231, 200));
        drawable.setCornerRadius(dp(16));

        return drawable;
    }

    private CheckBox createCheckBox(int labelResource, boolean checked) {
        CheckBox checkBox = new CheckBox(this);
        int accentColor = Color.rgb(142, 231, 200);
        int uncheckedColor = Color.argb(180, 255, 255, 255);

        checkBox.setLayoutParams(
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48)
            )
        );
        checkBox.setButtonTintList(
            new ColorStateList(
                new int[][] {
                    new int[] {android.R.attr.state_checked},
                    new int[] {}
                },
                new int[] {accentColor, uncheckedColor}
            )
        );
        checkBox.setChecked(checked);
        checkBox.setGravity(Gravity.CENTER_VERTICAL);
        checkBox.setText(labelResource);
        checkBox.setTextColor(Color.rgb(255, 249, 240));
        checkBox.setTextSize(16);

        return checkBox;
    }

    private int getOpacityIndex(int opacity) {
        int closestIndex = 0;
        int closestDistance = Math.abs(OPACITY_OPTIONS[0] - opacity);

        for (int index = 1; index < OPACITY_OPTIONS.length; index += 1) {
            int distance = Math.abs(OPACITY_OPTIONS[index] - opacity);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        }

        return closestIndex;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
