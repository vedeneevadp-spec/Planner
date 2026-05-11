import { describe, expect, it } from 'vitest'

import type { Project } from '@/entities/project'
import type { TaskTemplate } from '@/entities/task-template'

import {
  buildTaskInputFromTemplate,
  getProjectDisplayTitle,
  resolveProjectFields,
} from './task-composer-model'

const PROJECT = {
  color: '#8ca0d7',
  createdAt: '2026-04-20T08:00:00.000Z',
  deletedAt: null,
  description: '',
  icon: 'target',
  id: 'project-1',
  status: 'active',
  title: 'Работа',
  updatedAt: '2026-04-20T08:00:00.000Z',
  version: 1,
  workspaceId: 'workspace-1',
} satisfies Project

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
    expect(getProjectDisplayTitle('Без сферы', false)).toBe('Без сферы')
    expect(resolveProjectFields([], null, 'No sphere')).toEqual({
      project: '',
      projectId: null,
    })
  })

  it('keeps project and reminder fields for personal template tasks', () => {
    const input = buildTaskInputFromTemplate(TEMPLATE, [PROJECT], null, false)

    expect(input.project).toBe('Работа')
    expect(input.projectId).toBe('project-1')
    expect(input.remindBeforeStart).toBe(true)
    expect(input.plannedStartTime).toBe('10:00')
  })

  it('strips project and reminder fields for shared workspace template tasks', () => {
    const input = buildTaskInputFromTemplate(TEMPLATE, [PROJECT], null, true)

    expect(input.project).toBe('')
    expect(input.projectId).toBe(null)
    expect(input.remindBeforeStart).toBe(false)
    expect(input.reminderTimeZone).toBeUndefined()
  })
})
