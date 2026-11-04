package ru.chaotika.app;

import org.json.JSONObject;

final class PlannerTaskCompletion {
    enum Decision { COMPLETE, ALREADY_DONE, INACTIVE, CONFLICT }

    private PlannerTaskCompletion() {}

    static Decision decide(JSONObject task, int expectedVersion) {
        String status = task.optString("status", "");
        if ("done".equals(status)) return Decision.ALREADY_DONE;
        if (!"todo".equals(status) && !"in_progress".equals(status)) return Decision.INACTIVE;
        int version = task.optInt("version", 0);
        if (version <= 0 || (expectedVersion > 0 && expectedVersion != version)) return Decision.CONFLICT;
        return Decision.COMPLETE;
    }
}
