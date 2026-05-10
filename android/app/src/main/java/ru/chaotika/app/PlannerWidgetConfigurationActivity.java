package ru.chaotika.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

public class PlannerWidgetConfigurationActivity extends Activity {

    private static final int[] OPACITY_OPTIONS = {40, 55, 70, 85, 100};
    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private int selectedOpacity = 85;

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

        selectedOpacity = PlannerWidgetStorage.readBackgroundOpacityPercent(this);
        setContentView(createContentView());
    }

    private LinearLayout createContentView() {
        LinearLayout root = new LinearLayout(this);
        root.setLayoutParams(
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(24), dp(24), dp(24));
        root.setBackgroundColor(Color.rgb(20, 23, 28));

        TextView title = new TextView(this);
        title.setText(R.string.planner_widget_configuration_title);
        title.setTextColor(Color.rgb(255, 249, 240));
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView opacityLabel = new TextView(this);
        opacityLabel.setTextColor(Color.argb(210, 255, 255, 255));
        opacityLabel.setTextSize(16);
        opacityLabel.setPadding(0, dp(18), 0, dp(10));
        root.addView(opacityLabel);

        SeekBar opacitySeekBar = new SeekBar(this);
        opacitySeekBar.setMax(OPACITY_OPTIONS.length - 1);
        opacitySeekBar.setProgress(getOpacityIndex(selectedOpacity));
        root.addView(
            opacitySeekBar,
            new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        );

        Button doneButton = new Button(this);
        LinearLayout.LayoutParams doneButtonParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(52)
        );

        doneButtonParams.setMargins(0, dp(26), 0, 0);
        doneButton.setText(R.string.planner_widget_configuration_done);
        doneButton.setTextColor(Color.rgb(20, 23, 28));
        doneButton.setTextSize(16);
        doneButton.setTypeface(Typeface.DEFAULT_BOLD);
        doneButton.setBackground(createButtonBackground());
        root.addView(doneButton, doneButtonParams);

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
        doneButton.setOnClickListener(view -> saveAndClose());

        return root;
    }

    private void saveAndClose() {
        PlannerWidgetStorage.writeBackgroundOpacityPercent(this, selectedOpacity);
        PlannerWidgetUpdateDispatcher.updateAllWidgets(this);

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
