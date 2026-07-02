import { describe, expect, it } from 'vitest'

import type { Sphere } from '@/entities/sphere'
import {
  createDefaultRoutineTaskForm,
  createDefaultTaskRecurrenceForm,
  type RoutineTaskFormState,
} from '@/entities/task'

import {
  buildTaskComposerHabitInput,
  buildTaskComposerTaskInput,
} from './task-composer-model'

const PROJECT = {
  color: '#8ca0d7',
  createdAt: '2026-04-20T08:00:00.000Z',
  deletedAt: null,
  description: '',
  icon: 'target',
  id: 'project-1',
  isActive: true,
  isDefault: false,
  name: 'Работа',
  sortOrder: 0,
  updatedAt: '2026-04-20T08:00:00.000Z',
  userId: 'user-1',
  version: 1,
  workspaceId: 'workspace-1',
} satisfies Sphere

describe('task-composer-model', () => {
  it('builds task input from the current composer state', () => {
    const input = buildTaskComposerTaskInput({
      assigneeUserId: 'user-2',
      canUseRecurrence: true,
      icon: 'briefcase',
      initialPlannedDate: null,
      isImportant: true,
      isSharedWorkspace: true,
      note: 'Context',
      necessity: 'required',
      plannedDate: '',
      plannedEndTime: '',
      plannedStartTime: '',
      plannerTimeZone: 'Europe/Astrakhan',
      projectId: PROJECT.id,
      recurrenceForm: {
        ...createDefaultTaskRecurrenceForm(),
        isEnabled: true,
      },
      reminderOffsets: [15, 30],
      requiresConfirmation: true,
      resource: '3',
      routineForm: createDefaultRoutineTaskForm(),
      spheres: [PROJECT],
      taskType: '',
      title: '  Проверить отчёт  ',
      todayKey: '2026-04-22',
    })

    expect(input).toMatchObject({
      assigneeUserId: 'user-2',
      importance: 'important',
      necessity: 'required',
      plannedDate: '2026-04-22',
      project: 'Работа',
      projectId: PROJECT.id,
      reminderOffsets: [],
      remindBeforeStart: false,
      requiresConfirmation: true,
      resource: 3,
      sphereId: PROJECT.id,
      title: 'Проверить отчёт',
      urgency: 'not_urgent',
    })
    expect(input?.recurrence).toMatchObject({
      isActive: true,
      startDate: '2026-04-22',
    })
    expect(input?.reminderTimeZone).toBeUndefined()
  })

  it('keeps multiple reminder offsets for personal tasks with a start time', () => {
    const input = buildTaskComposerTaskInput({
      assigneeUserId: '',
      canUseRecurrence: false,
      icon: 'briefcase',
      initialPlannedDate: null,
      isImportant: false,
      isSharedWorkspace: false,
      note: '',
      necessity: 'desired',
      plannedDate: '2026-04-22',
      plannedEndTime: '',
      plannedStartTime: '10:00',
      plannerTimeZone: 'Europe/Astrakhan',
      projectId: PROJECT.id,
      recurrenceForm: createDefaultTaskRecurrenceForm(),
      reminderOffsets: [15, 60],
      requiresConfirmation: false,
      resource: '',
      routineForm: createDefaultRoutineTaskForm(),
      spheres: [PROJECT],
      taskType: '',
      title: 'Созвон',
      todayKey: '2026-04-22',
    })

    expect(input).toMatchObject({
      plannedDate: '2026-04-22',
      plannedStartTime: '10:00',
      reminderOffsets: [15, 60],
      remindBeforeStart: true,
      title: 'Созвон',
    })
  })

  it('rolls reminder tasks to tomorrow when today start time already passed', () => {
    const input = buildTaskComposerTaskInput({
      assigneeUserId: '',
      canUseRecurrence: false,
      icon: 'bell',
      initialPlannedDate: null,
      isImportant: false,
      isSharedWorkspace: false,
      note: '',
      necessity: 'desired',
      now: new Date('2026-04-22T23:44:00+04:00'),
      plannedDate: '2026-04-22',
      plannedEndTime: '',
      plannedStartTime: '00:03',
      plannerTimeZone: 'Europe/Astrakhan',
      projectId: PROJECT.id,
      recurrenceForm: createDefaultTaskRecurrenceForm(),
      reminderOffsets: [15],
      requiresConfirmation: false,
      resource: '',
      routineForm: createDefaultRoutineTaskForm(),
      spheres: [PROJECT],
      taskType: '',
      title: 'Выключить плиту',
      todayKey: '2026-04-22',
    })

    expect(input).toMatchObject({
      plannedDate: '2026-04-23',
      plannedStartTime: '00:03',
      reminderOffsets: [15],
      remindBeforeStart: true,
      title: 'Выключить плиту',
    })
  })

  it('keeps non-reminder tasks on the selected date even when start time passed', () => {
    const input = buildTaskComposerTaskInput({
      assigneeUserId: '',
      canUseRecurrence: false,
      icon: 'briefcase',
      initialPlannedDate: null,
      isImportant: false,
      isSharedWorkspace: false,
      note: '',
      necessity: 'desired',
      now: new Date('2026-04-22T23:44:00+04:00'),
      plannedDate: '2026-04-22',
      plannedEndTime: '',
      plannedStartTime: '00:03',
      plannerTimeZone: 'Europe/Astrakhan',
      projectId: PROJECT.id,
      recurrenceForm: createDefaultTaskRecurrenceForm(),
      reminderOffsets: [],
      requiresConfirmation: false,
      resource: '',
      routineForm: createDefaultRoutineTaskForm(),
      spheres: [PROJECT],
      taskType: '',
      title: 'Записать факт',
      todayKey: '2026-04-22',
    })

    expect(input).toMatchObject({
      plannedDate: '2026-04-22',
      plannedStartTime: '00:03',
      remindBeforeStart: false,
      title: 'Записать факт',
    })
  })

  it('builds habit input from the current composer state', () => {
    const routineForm = {
      ...createDefaultRoutineTaskForm(),
      targetType: 'count',
      targetValue: '5',
      unit: 'страниц',
    } satisfies RoutineTaskFormState

    expect(
      buildTaskComposerHabitInput({
        icon: '',
        initialPlannedDate: null,
        note: ' Читать перед сном ',
        plannedDate: '',
        projectId: PROJECT.id,
        routineForm,
        spheres: [PROJECT],
        title: '  Читать  ',
        todayKey: '2026-04-22',
      }),
    ).toMatchObject({
      description: 'Читать перед сном',
      icon: 'check',
      sphereId: PROJECT.id,
      startDate: '2026-04-22',
      targetType: 'count',
      targetValue: 5,
      title: 'Читать',
      unit: 'страниц',
    })
  })
})
