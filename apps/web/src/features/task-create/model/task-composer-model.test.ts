import { describe, expect, it } from 'vitest'

import type { Sphere } from '@/entities/sphere'
import {
  createDefaultRoutineTaskForm,
  createDefaultTaskRecurrenceForm,
  type RoutineTaskFormState,
} from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'

import {
  buildTaskComposerHabitInput,
  buildTaskComposerTaskInput,
  buildTaskInputFromTemplate,
  getSphereDisplayTitle,
  getTemplateDisplayProject,
  resolveProjectFields,
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

const TEMPLATE = {
  createdAt: '2026-04-20T08:00:00.000Z',
  dueDate: null,
  icon: 'briefcase',
  id: 'template-1',
  importance: 'important',
  note: 'Контекст',
  plannedDate: '2026-04-23',
  plannedEndTime: '10:30',
  plannedStartTime: '10:00',
  project: 'Работа',
  projectId: 'project-1',
  title: 'Проверить отчёт',
  urgency: 'urgent',
} satisfies TaskTemplate

describe('task-composer-model', () => {
  it('normalizes legacy empty project titles', () => {
    expect(getSphereDisplayTitle('Без сферы')).toBe('Без сферы')
    expect(getSphereDisplayTitle('Без проекта')).toBe('Без сферы')
    expect(resolveProjectFields([], null, 'No sphere')).toEqual({
      project: '',
      projectId: null,
    })
  })

  it('builds template display project metadata', () => {
    expect(getTemplateDisplayProject(TEMPLATE, [PROJECT])).toEqual({
      hasProject: true,
      project: PROJECT,
      title: 'Работа',
    })

    expect(
      getTemplateDisplayProject(
        {
          ...TEMPLATE,
          project: 'Без проекта',
          projectId: null,
        },
        [PROJECT],
      ),
    ).toEqual({
      hasProject: false,
      project: null,
      title: 'Без сферы',
    })
  })

  it('builds task input from the current composer state', () => {
    const input = buildTaskComposerTaskInput({
      assigneeUserId: 'user-2',
      canUseRecurrence: true,
      icon: 'briefcase',
      initialPlannedDate: null,
      isSharedWorkspace: true,
      note: 'Context',
      plannedDate: '',
      plannedEndTime: '',
      plannedStartTime: '',
      projectId: PROJECT.id,
      recurrenceForm: {
        ...createDefaultTaskRecurrenceForm(),
        isEnabled: true,
      },
      remindBeforeStart: true,
      requiresConfirmation: true,
      resource: '3',
      routineForm: createDefaultRoutineTaskForm(),
      spheres: [PROJECT],
      taskType: 'important',
      title: '  Проверить отчёт  ',
      todayKey: '2026-04-22',
    })

    expect(input).toMatchObject({
      assigneeUserId: 'user-2',
      importance: 'important',
      plannedDate: '2026-04-22',
      project: 'Работа',
      projectId: PROJECT.id,
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

  it('keeps project and reminder fields for personal template tasks', () => {
    const input = buildTaskInputFromTemplate(TEMPLATE, [PROJECT], null, false)

    expect(input.project).toBe('Работа')
    expect(input.projectId).toBe('project-1')
    expect(input.sphereId).toBe('project-1')
    expect(input.remindBeforeStart).toBe(true)
    expect(input.plannedStartTime).toBe('10:00')
  })

  it('keeps project and strips reminder fields for shared workspace template tasks', () => {
    const input = buildTaskInputFromTemplate(TEMPLATE, [PROJECT], null, true)

    expect(input.project).toBe('Работа')
    expect(input.projectId).toBe('project-1')
    expect(input.sphereId).toBe('project-1')
    expect(input.remindBeforeStart).toBe(false)
    expect(input.reminderTimeZone).toBeUndefined()
  })
})
