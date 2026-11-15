package ru.chaotika.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PlannerWidgetSyncConfigTest {

    @Test
    public void restoreEpochChangesInvalidateConfigAndLegacyConfigRemainsZero() {
        PlannerWidgetSyncConfig legacy = new PlannerWidgetSyncConfig(
            "https://planner.example.test", "personal-workspace", "Asia/Novosibirsk"
        );
        PlannerWidgetSyncConfig restored = new PlannerWidgetSyncConfig(
            "https://planner.example.test", "personal-workspace", "Asia/Novosibirsk", "1"
        );
        assertEquals("0", legacy.writeEpoch);
        assertEquals("1", restored.writeEpoch);
        assertFalse(legacy.hasSameValues(restored));
        assertEquals("0", new PlannerWidgetSyncConfig(
            "https://planner.example.test", "personal-workspace", "Asia/Novosibirsk", "invalid"
        ).writeEpoch);
    }

    @Test
    public void matchesEquivalentNormalizedValues() {
        PlannerWidgetSyncConfig first = new PlannerWidgetSyncConfig(
            "https://planner.example.test/",
            " personal-workspace ",
            " Asia/Novosibirsk "
        );
        PlannerWidgetSyncConfig second = new PlannerWidgetSyncConfig(
            "https://planner.example.test",
            "personal-workspace",
            "Asia/Novosibirsk"
        );

        assertTrue(first.hasSameValues(second));
        assertTrue(second.hasSameValues(first));
    }

    @Test
    public void rejectsMissingOrChangedValues() {
        PlannerWidgetSyncConfig config = new PlannerWidgetSyncConfig(
            "https://planner.example.test",
            "personal-workspace",
            "Asia/Novosibirsk"
        );

        assertFalse(config.hasSameValues(null));
        assertFalse(
            config.hasSameValues(
                new PlannerWidgetSyncConfig(
                    "https://planner.example.test",
                    "shared-workspace",
                    "Asia/Novosibirsk"
                )
            )
        );
    }
}
