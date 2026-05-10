package ru.chaotika.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import java.util.Locale;

final class PlannerWidgetVisuals {

    private PlannerWidgetVisuals() {}

    static int getTaskAccentColor(Context context, PlannerWidgetTask task) {
        if ("in_progress".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_in_progress);
        }

        if ("review".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_review);
        }

        if ("urgent".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_urgent);
        }

        if ("overdue".equals(task.visualTone) || task.isOverdue) {
            return context.getColor(R.color.planner_widget_warning);
        }

        return parseTaskColor(task.color, context.getColor(R.color.planner_widget_accent));
    }

    static Bitmap createCheckboxBitmap(Context context, int accentColor) {
        int size = dp(context, 22);
        int strokeWidth = dp(context, 2);
        float radius = (size - strokeWidth) / 2f;
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(strokeWidth);
        paint.setColor(accentColor);
        canvas.drawCircle(size / 2f, size / 2f, radius - 1f, paint);

        return bitmap;
    }

    static Bitmap createTaskIconBitmap(Context context, PlannerWidgetTask task) {
        int size = dp(context, 24);
        int accentColor = getTaskAccentColor(context, task);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        String glyph = getIconGlyph(task.icon, task.title);

        paint.setStyle(Paint.Style.FILL);
        paint.setColor(withAlpha(accentColor, 56));
        canvas.drawRoundRect(new RectF(0, 0, size, size), size / 2f, size / 2f, paint);

        paint.setColor(accentColor);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        paint.setTextSize(dp(context, glyph.codePointCount(0, glyph.length()) > 1 ? 10 : 13));

        Rect bounds = new Rect();
        paint.getTextBounds(glyph, 0, glyph.length(), bounds);
        canvas.drawText(glyph, size / 2f, size / 2f - bounds.exactCenterY(), paint);

        return bitmap;
    }

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private static int parseTaskColor(String value, int fallbackColor) {
        try {
            return Color.parseColor(value);
        } catch (IllegalArgumentException exception) {
            return fallbackColor;
        }
    }

    private static int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private static String getIconGlyph(String rawIcon, String title) {
        String icon = rawIcon == null ? "" : rawIcon.trim();

        if (icon.startsWith("svg:")) {
            icon = icon.substring(4);
        }

        if (icon.startsWith("image:")) {
            return "•";
        }

        switch (icon) {
            case "bell":
                return "!";
            case "calendar":
                return "◷";
            case "car":
                return "C";
            case "chat":
                return "@";
            case "check":
                return "✓";
            case "children":
                return "U";
            case "dog":
                return "D";
            case "folder":
                return "F";
            case "heart":
                return "♥";
            case "home":
                return "H";
            case "lightning":
                return "⚡";
            case "search":
                return "?";
            case "settings":
                return "⚙";
            case "user":
                return "U";
            default:
                break;
        }

        if (!icon.isEmpty()) {
            int firstCodePoint = icon.codePointAt(0);
            return new String(Character.toChars(firstCodePoint));
        }

        String normalizedTitle = title == null ? "" : title.trim();

        if (normalizedTitle.isEmpty()) {
            return "•";
        }

        int firstCodePoint = normalizedTitle.codePointAt(0);

        return new String(Character.toChars(firstCodePoint)).toUpperCase(Locale.forLanguageTag("ru-RU"));
    }
}
