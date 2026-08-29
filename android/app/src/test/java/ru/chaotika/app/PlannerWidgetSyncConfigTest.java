package ru.chaotika.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlannerWidgetSyncConfigTest {

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
