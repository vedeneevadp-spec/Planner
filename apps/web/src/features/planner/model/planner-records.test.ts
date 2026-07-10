import type {
  LifeSphereRecord,
  TaskRecord,
  TaskTemplateRecord,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  createOptimisticLifeSphereRecord,
  createOptimisticTaskRecord,
  createOptimisticTaskTemplateRecord,
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
  updateTaskLifeSphereRecords,
  updateTaskTemplateLifeSphereRecords,
} from './planner-records'

describe('planner record projections', () => {
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
