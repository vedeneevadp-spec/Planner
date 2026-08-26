import type { TaskReadModelResponse } from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { PlannerApiClient } from '../lib/planner-api'
import {
  loadPlannerTaskSnapshot,
  PLANNER_TASK_SNAPSHOT_LIMITS,
} from './planner-queries'

describe('planner task snapshot', () => {
  it('uses the bounded read model instead of the legacy full task list', async () => {
    const response: TaskReadModelResponse = {
      eventCursor: 12,
      historyNextCursor: null,
      items: [],
      returnedCount: 0,
      sources: {
        active: { returnedCount: 0, totalCount: 0, truncated: false },
        history: { returnedCount: 0, totalCount: 0, truncated: false },
        range: { returnedCount: 0, totalCount: 0, truncated: false },
      },
      totalCount: 0,
      truncated: false,
    }
    const getTaskReadModel = vi.fn().mockResolvedValue(response)
    const listTasks = vi.fn()
    const api = {
      getTaskReadModel,
      listTasks,
    } as unknown as PlannerApiClient
    const signal = new AbortController().signal

    await expect(
      loadPlannerTaskSnapshot(api, '2026-08-25', '2026-08-26', signal),
    ).resolves.toBe(response)
    expect(getTaskReadModel).toHaveBeenCalledWith(
      {
        ...PLANNER_TASK_SNAPSHOT_LIMITS,
        dateFrom: '2026-08-25',
        dateTo: '2026-08-26',
      },
      signal,
    )
    expect(listTasks).not.toHaveBeenCalled()
  })
})
