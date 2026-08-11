import {
  type LifeSphereRecord,
  makeFixedZoneDateTime,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  createOptimisticLifeSphereRecord,
  createOptimisticTaskNextStageResult,
  createOptimisticTaskRecord,
  createOptimisticTaskScheduleRecord,
  createOptimisticTaskStatusRecord,
  createOptimisticTaskTemplateRecord,
  createOptimisticUpdatedTaskRecord,
  detachLifeSphereFromTaskRecords,
  detachLifeSphereFromTaskTemplateRecords,
  normalizeSchedule,
  replaceOptimisticLifeSphereRecord,
  replaceOptimisticTaskRecord,
  replaceOptimisticTaskTemplateRecord,
  restoreTaskRecordAtIndex,
  sortSpheres,
  sortTaskTemplates,
  toggleTaskId,
  toPlannerTask,
  updateTaskLifeSphereRecords,
  updateTaskTemplateLifeSphereRecords,
} from './planner-records'

describe('planner record projections', () => {
  it('projects a fixed-zone task into the active planner timezone', () => {
    const record = createTaskRecord({
      plannedDate: '2026-08-10',
      plannedEndTime: '23:45',
      plannedStartTime: '23:30',
      schedule: {
        instantUtc: '2026-08-10T19:30:00.000Z',
        kind: 'fixed_zone_datetime',
        localDate: '2026-08-10',
        localTime: '23:30',
        timeZone: 'Europe/Samara',
        timeZoneInferred: true,
      },
    })

    const task = toPlannerTask(record, 'Asia/Novosibirsk')

    expect(task).toMatchObject({
      plannedDate: '2026-08-11',
      plannedEndTime: '02:45',
      plannedStartTime: '02:30',
      schedule: record.schedule,
    })
    expect(
      makeFixedZoneDateTime({
        localDate: task.plannedDate!,
        localTime: task.plannedStartTime!,
        timeZone: 'Asia/Novosibirsk',
      }).instantUtc,
    ).toBe(
      record.schedule?.kind === 'fixed_zone_datetime'
        ? record.schedule.instantUtc
        : null,
    )
    expect(record).toMatchObject({
      plannedDate: '2026-08-10',
      plannedEndTime: '23:45',
      plannedStartTime: '23:30',
    })
  })

  it('keeps date-only and floating schedules stable across timezone changes', () => {
    const dateOnlyTask = toPlannerTask(
      createTaskRecord({
        plannedDate: '2026-08-10',
        schedule: {
          kind: 'date_only',
          localDate: '2026-08-10',
        },
      }),
      'Asia/Novosibirsk',
    )
    const floatingTask = toPlannerTask(
      createTaskRecord({
        plannedDate: '2026-08-10',
        plannedEndTime: '08:15',
        plannedStartTime: '08:00',
        schedule: {
          kind: 'floating_local_time',
          localTime: '08:00',
          recurrenceRule: 'FREQ=DAILY',
        },
      }),
      'Europe/Amsterdam',
    )

    expect(dateOnlyTask.plannedDate).toBe('2026-08-10')
    expect(floatingTask).toMatchObject({
      plannedDate: '2026-08-10',
      plannedEndTime: '08:15',
      plannedStartTime: '08:00',
    })
  })

  it('falls back to legacy schedule fields for an invalid fixed instant', () => {
    const task = toPlannerTask(
      createTaskRecord({
        plannedDate: '2026-08-10',
        plannedEndTime: '17:15',
        plannedStartTime: '17:00',
        schedule: {
          instantUtc: 'not-an-instant',
          kind: 'fixed_zone_datetime',
          localDate: '2026-08-10',
          localTime: '17:00',
          timeZone: 'Europe/Samara',
        },
      }),
      'Asia/Novosibirsk',
    )

    expect(task).toMatchObject({
      plannedDate: '2026-08-10',
      plannedEndTime: '17:15',
      plannedStartTime: '17:00',
    })
  })

  it('restores one failed task without overwriting another successful mutation', () => {
    const previousTask = createTaskRecord({ id: 'task-1', title: 'Before' })
    const successfulTask = createTaskRecord({
      id: 'task-2',
      title: 'Saved concurrently',
      version: 2,
    })
    const current = [
      createTaskRecord({ id: 'task-1', title: 'Optimistic', version: 2 }),
      successfulTask,
    ]

    expect(restoreTaskRecordAtIndex(current, previousTask, 0)).toEqual([
      previousTask,
      successfulTask,
    ])
  })

  it('normalizes schedules before optimistic writes', () => {
    expect(
      normalizeSchedule({
        plannedDate: null,
        plannedEndTime: '10:00',
        plannedStartTime: '09:00',
      }),
    ).toEqual({
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
    })

    expect(
      normalizeSchedule({
        plannedDate: '2026-05-28',
        plannedEndTime: '08:30',
        plannedStartTime: '09:00',
      }),
    ).toEqual({
      plannedDate: '2026-05-28',
      plannedEndTime: null,
      plannedStartTime: '09:00',
    })
  })

  it('creates optimistic task records with trimmed fields and reminder defaults', () => {
    const task = createOptimisticTaskRecord(
      {
        assigneeUserId: 'user-2',
        dueDate: null,
        icon: '  inbox  ',
        necessity: 'required',
        note: '  context  ',
        plannedDate: '2026-05-28',
        plannedEndTime: '09:00',
        plannedStartTime: '09:00',
        project: '  Home  ',
        projectId: 'sphere-1',
        remindBeforeStart: true,
        requiresConfirmation: true,
        resource: 1,
        sphereId: 'sphere-1',
        title: '  Buy filters  ',
      },
      {
        authorDisplayName: 'Darya',
        authorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
    )

    expect(task).toMatchObject({
      assigneeUserId: 'user-2',
      authorDisplayName: 'Darya',
      authorUserId: 'user-1',
      icon: 'inbox',
      necessity: 'required',
      note: 'context',
      plannedEndTime: null,
      plannedStartTime: '09:00',
      project: 'Home',
      reminderOffsets: [15],
      requiresConfirmation: true,
      status: 'todo',
      title: 'Buy filters',
      version: 1,
      workspaceId: 'workspace-1',
    })
    expect(task.id).toBeTruthy()
  })

  it('projects task edits with one version increment', () => {
    const task = createOptimisticUpdatedTaskRecord(
      createTaskRecord({
        schedule: {
          instantUtc: '2026-08-10T06:00:00.000Z',
          kind: 'fixed_zone_datetime',
          localDate: '2026-08-10',
          localTime: '10:00',
          timeZone: 'Europe/Samara',
        },
        title: 'Before',
        version: 4,
      }),
      {
        assigneeUserId: null,
        dueDate: null,
        icon: '  inbox  ',
        importance: 'important',
        necessity: 'required',
        note: '  updated  ',
        plannedDate: '2026-08-10',
        plannedEndTime: '10:30',
        plannedStartTime: '10:00',
        project: '  Home  ',
        projectId: 'sphere-1',
        remindBeforeStart: true,
        reminderOffsets: [30],
        requiresConfirmation: false,
        resource: 2,
        sphereId: 'sphere-1',
        title: '  After  ',
      },
      '2026-08-10T08:00:00.000Z',
    )

    expect(task).toMatchObject({
      icon: 'inbox',
      necessity: 'required',
      note: 'updated',
      plannedEndTime: '10:30',
      plannedStartTime: '10:00',
      project: 'Home',
      reminderOffsets: [30],
      schedule: null,
      title: 'After',
      updatedAt: '2026-08-10T08:00:00.000Z',
      version: 5,
    })
  })

  it('projects task completion with one version increment', () => {
    const task = createOptimisticTaskStatusRecord(
      createTaskRecord({ status: 'in_progress', version: 2 }),
      'done',
      '2026-08-10T09:00:00.000Z',
    )

    expect(task).toMatchObject({
      completedAt: '2026-08-10T09:00:00.000Z',
      status: 'done',
      updatedAt: '2026-08-10T09:00:00.000Z',
      version: 3,
    })
  })

  it('projects both sides of a next-stage command with a stable client id', () => {
    const task = createTaskRecord({
      chainId: null,
      completedAt: null,
      recurrence: {
        daysOfWeek: [1],
        endDate: null,
        frequency: 'daily',
        interval: 1,
        isActive: true,
        seriesId: 'recurrence-1',
        startDate: '2026-08-11',
      },
      routine: {
        daysOfWeek: [1],
        frequency: 'daily',
        seriesId: 'routine-1',
        targetType: 'check',
        targetValue: 1,
        unit: '',
      },
      stageIndex: null,
      stageType: null,
      status: 'in_progress',
      version: 4,
    })

    const result = createOptimisticTaskNextStageResult(
      task,
      {
        chainId: 'chain-1',
        completeCurrent: true,
        expectedVersion: task.version,
        nextTaskId: 'next-stage-1',
        note: '  Следующий шаг  ',
        plannedDate: '2026-08-12',
        stageType: 'waiting',
        title: '  Дождаться ответа  ',
      },
      {
        chainId: 'chain-1',
        nextTaskId: 'next-stage-1',
        updatedAt: '2026-08-11T05:00:00.000Z',
      },
    )

    expect(result.currentTask).toMatchObject({
      chainId: 'chain-1',
      completedAt: '2026-08-11T05:00:00.000Z',
      completionType: 'advanced',
      stageIndex: 1,
      stageType: 'task',
      status: 'done',
      version: 5,
    })
    expect(result.nextTask).toMatchObject({
      chainId: 'chain-1',
      id: 'next-stage-1',
      note: 'Следующий шаг',
      plannedDate: '2026-08-12',
      previousTaskId: task.id,
      recurrence: null,
      routine: null,
      stageIndex: 2,
      stageType: 'waiting',
      status: 'todo',
      title: 'Дождаться ответа',
      version: 1,
    })
    expect(result.undo).toMatchObject({
      createdTaskId: 'next-stage-1',
      previousChainId: null,
      previousStageIndex: null,
      previousStatus: 'in_progress',
      previousTaskExpectedVersion: 5,
    })
  })

  it('projects schedule changes and clears unavailable reminders', () => {
    const task = createOptimisticTaskScheduleRecord(
      createTaskRecord({
        plannedDate: '2026-08-10',
        plannedStartTime: '09:00',
        remindBeforeStart: true,
        reminderOffsets: [30],
        version: 3,
      }),
      {
        plannedDate: '2026-08-11',
        plannedEndTime: null,
        plannedStartTime: null,
      },
      '2026-08-10T09:05:00.000Z',
    )

    expect(task).toMatchObject({
      plannedDate: '2026-08-11',
      plannedEndTime: null,
      plannedStartTime: null,
      schedule: null,
      updatedAt: '2026-08-10T09:05:00.000Z',
      version: 4,
    })
    expect(task.remindBeforeStart).toBeUndefined()
    expect(task.reminderOffsets).toBeUndefined()
  })

  it('creates optimistic templates and life spheres with normalized defaults', () => {
    const template = createOptimisticTaskTemplateRecord(
      {
        dueDate: null,
        icon: '  template  ',
        note: '  note  ',
        plannedDate: null,
        plannedEndTime: '12:00',
        plannedStartTime: '11:00',
        project: '  Ops  ',
        projectId: null,
        title: '  Weekly review  ',
      },
      'workspace-1',
    )
    const sphere = createOptimisticLifeSphereRecord(
      {
        color: '  #123456  ',
        description: '  admin work  ',
        icon: '  home  ',
        name: '  Ops  ',
      },
      {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
      },
    )

    expect(template).toMatchObject({
      icon: 'template',
      note: 'note',
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
      project: 'Ops',
      title: 'Weekly review',
      workspaceId: 'workspace-1',
    })
    expect(sphere).toMatchObject({
      color: '#123456',
      description: 'admin work',
      icon: 'home',
      isActive: true,
      name: 'Ops',
      userId: 'user-1',
    })
  })

  it('replaces optimistic records without duplicating server records', () => {
    const task = createTaskRecord({ id: 'server-task', title: 'Server task' })
    const optimisticTask = createTaskRecord({
      id: 'optimistic-task',
      title: 'Optimistic task',
    })
    const sphere = createSphereRecord({ id: 'server-sphere', name: 'Server' })
    const optimisticSphere = createSphereRecord({
      id: 'optimistic-sphere',
      name: 'Optimistic',
      sortOrder: 2,
    })
    const template = createTemplateRecord({
      id: 'server-template',
      title: 'Server template',
    })
    const optimisticTemplate = createTemplateRecord({
      id: 'optimistic-template',
      title: 'Optimistic template',
    })

    expect(
      replaceOptimisticTaskRecord(
        [optimisticTask],
        optimisticTask.id,
        task,
      ).map((item) => item.id),
    ).toEqual(['server-task'])
    expect(
      replaceOptimisticLifeSphereRecord(
        [optimisticSphere],
        optimisticSphere.id,
        sphere,
      ).map((item) => item.id),
    ).toEqual(['server-sphere'])
    expect(
      replaceOptimisticTaskTemplateRecord(
        [optimisticTemplate],
        optimisticTemplate.id,
        template,
      ).map((item) => item.id),
    ).toEqual(['server-template'])
  })

  it('updates and detaches life sphere references across tasks and templates', () => {
    const sphere = createSphereRecord({ id: 'sphere-1', name: 'Family' })
    const task = createTaskRecord({
      project: 'Old name',
      projectId: 'sphere-1',
      sphereId: null,
    })
    const template = createTemplateRecord({
      project: 'Old name',
      projectId: 'sphere-1',
    })

    expect(updateTaskLifeSphereRecords([task], sphere)[0]).toMatchObject({
      project: 'Family',
      projectId: 'sphere-1',
    })
    expect(
      updateTaskTemplateLifeSphereRecords([template], sphere)[0],
    ).toMatchObject({
      project: 'Family',
      projectId: 'sphere-1',
    })
    expect(
      detachLifeSphereFromTaskRecords([task], 'sphere-1')[0],
    ).toMatchObject({
      project: '',
      projectId: null,
      sphereId: null,
    })
    expect(
      detachLifeSphereFromTaskTemplateRecords([template], 'sphere-1')[0],
    ).toMatchObject({
      project: '',
      projectId: null,
    })
  })

  it('sorts spheres and templates deterministically', () => {
    expect(
      sortSpheres([
        createSphereRecord({
          createdAt: '2026-05-02T00:00:00.000Z',
          id: 'sphere-b',
          name: 'Beta',
          sortOrder: 2,
        }),
        createSphereRecord({
          createdAt: '2026-05-01T00:00:00.000Z',
          id: 'sphere-a',
          name: 'Alpha',
          sortOrder: 2,
        }),
        createSphereRecord({
          id: 'sphere-first',
          name: 'Zulu',
          sortOrder: 1,
        }),
      ]).map((sphere) => sphere.id),
    ).toEqual(['sphere-first', 'sphere-a', 'sphere-b'])

    expect(
      sortTaskTemplates([
        createTemplateRecord({
          createdAt: '2026-05-02T00:00:00.000Z',
          id: 'template-b',
          title: 'Review',
        }),
        createTemplateRecord({
          createdAt: '2026-05-01T00:00:00.000Z',
          id: 'template-a',
          title: 'Review',
        }),
        createTemplateRecord({
          id: 'template-first',
          title: 'Plan',
        }),
      ]).map((template) => template.id),
    ).toEqual(['template-first', 'template-a', 'template-b'])
  })

  it('toggles pending task identifiers immutably', () => {
    const current = new Set(['task-1'])
    const next = toggleTaskId(current, 'task-2', true)
    const final = toggleTaskId(next, 'task-1', false)

    expect([...current]).toEqual(['task-1'])
    expect([...next].sort()).toEqual(['task-1', 'task-2'])
    expect([...final]).toEqual(['task-2'])
  })
})

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    assigneeDisplayName: null,
    assigneeUserId: null,
    authorDisplayName: null,
    authorUserId: null,
    completedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: 'task-1',
    importance: 'not_important',
    necessity: 'desired',
    linkedTask: null,
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    recurrence: null,
    remindBeforeStart: undefined,
    reminderOffsets: undefined,
    requiresConfirmation: false,
    resource: null,
    routine: null,
    sourceWorkspace: null,
    sphereId: null,
    status: 'todo',
    title: 'Task',
    updatedAt: '2026-05-01T10:00:00.000Z',
    urgency: 'not_urgent',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createSphereRecord(
  overrides: Partial<LifeSphereRecord> = {},
): LifeSphereRecord {
  return {
    color: '#2f6f62',
    createdAt: '2026-05-01T10:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: 'folder',
    id: 'sphere-1',
    isActive: true,
    isDefault: false,
    name: 'Sphere',
    sortOrder: 1,
    updatedAt: '2026-05-01T10:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

function createTemplateRecord(
  overrides: Partial<TaskTemplateRecord> = {},
): TaskTemplateRecord {
  return {
    createdAt: '2026-05-01T10:00:00.000Z',
    deletedAt: null,
    dueDate: null,
    icon: '',
    id: 'template-1',
    importance: 'not_important',
    note: '',
    plannedDate: null,
    plannedEndTime: null,
    plannedStartTime: null,
    project: '',
    projectId: null,
    title: 'Template',
    updatedAt: '2026-05-01T10:00:00.000Z',
    urgency: 'not_urgent',
    version: 1,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}
