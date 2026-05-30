package ru.chaotika.app;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.PowerManager;
import android.os.SystemClock;

final class AndroidVoiceRuntimeSampler {

    private static long lastCpuElapsedMs;
    private static long lastCpuProcessMs;

    private AndroidVoiceRuntimeSampler() {}

    static AndroidVoiceRuntimeSamples sample(Context context) {
        AndroidVoiceBatterySample battery = sampleBattery(context);
        AndroidVoiceCpuSample cpu = sampleCpu();
        AndroidVoiceMemorySample memory = sampleMemory();

        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.BATTERY_SAMPLE,
            battery.levelPercent < 0 ? 0 : battery.levelPercent
        );
        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.CPU_SAMPLE,
            Math.round(cpu.processCpuPercent)
        );
        AndroidVoiceRuntimeStore.recordValue(
            context,
            AndroidVoiceRuntimeMetric.MEMORY_SAMPLE,
            memory.usedMb
        );

        return new AndroidVoiceRuntimeSamples(battery, cpu, memory);
    }

    private static AndroidVoiceBatterySample sampleBattery(Context context) {
        int levelPercent = -1;
        boolean isCharging = false;
        boolean isPowerSaveMode = false;

        BatteryManager batteryManager = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        if (batteryManager != null) {
            levelPercent = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        }

        Intent batteryStatus = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batteryStatus != null) {
            int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL;
        }

        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            isPowerSaveMode = powerManager.isPowerSaveMode();
        }

        return new AndroidVoiceBatterySample(levelPercent, isCharging, isPowerSaveMode);
    }

    private static AndroidVoiceCpuSample sampleCpu() {
        long nowElapsedMs = SystemClock.elapsedRealtime();
        long nowCpuMs = android.os.Process.getElapsedCpuTime();
        double processCpuPercent = 0d;

        if (lastCpuElapsedMs > 0L && nowElapsedMs > lastCpuElapsedMs) {
            processCpuPercent = ((nowCpuMs - lastCpuProcessMs) * 100d) / (nowElapsedMs - lastCpuElapsedMs);
        }

        lastCpuElapsedMs = nowElapsedMs;
        lastCpuProcessMs = nowCpuMs;

        return new AndroidVoiceCpuSample(Math.max(0d, processCpuPercent));
    }

    private static AndroidVoiceMemorySample sampleMemory() {
        Runtime runtime = Runtime.getRuntime();
        long usedBytes = runtime.totalMemory() - runtime.freeMemory();

        return new AndroidVoiceMemorySample(bytesToMb(usedBytes), bytesToMb(runtime.maxMemory()));
    }

    private static long bytesToMb(long bytes) {
        return Math.max(0L, bytes / (1024L * 1024L));
    }
}

final class AndroidVoiceRuntimeSamples {

    final AndroidVoiceBatterySample battery;
    final AndroidVoiceCpuSample cpu;
    final AndroidVoiceMemorySample memory;

    AndroidVoiceRuntimeSamples(
        AndroidVoiceBatterySample battery,
        AndroidVoiceCpuSample cpu,
        AndroidVoiceMemorySample memory
    ) {
        this.battery = battery;
        this.cpu = cpu;
        this.memory = memory;
    }
}

final class AndroidVoiceBatterySample {

    final boolean isCharging;
    final boolean isPowerSaveMode;
    final int levelPercent;

    AndroidVoiceBatterySample(int levelPercent, boolean isCharging, boolean isPowerSaveMode) {
        this.levelPercent = levelPercent;
        this.isCharging = isCharging;
        this.isPowerSaveMode = isPowerSaveMode;
    }
}

final class AndroidVoiceCpuSample {

    final double processCpuPercent;

    AndroidVoiceCpuSample(double processCpuPercent) {
        this.processCpuPercent = processCpuPercent;
    }
}

final class AndroidVoiceMemorySample {

    final long maxMb;
    final long usedMb;

    AndroidVoiceMemorySample(long usedMb, long maxMb) {
        this.usedMb = usedMb;
        this.maxMb = maxMb;
    }
}
