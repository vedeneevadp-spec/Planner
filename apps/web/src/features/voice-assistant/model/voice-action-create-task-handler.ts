import {
  generateUuidV7,
  type PlannerIntent,
  type VoiceActionPreview,
  type VoiceActionResult,
  type VoiceActionUndo,
} from '@planner/contracts'

import type { PlannerActionExecutorDependencies } from './planner-action-executor'
import {
  buildTaskInputFromPlannerIntent,
  getPlannerIntentTitle,
} from './planner-intent-execution'
import { createResult, getRecordId } from './voice-action-factory'

export function buildCreateTaskSummary(intent: PlannerIntent): string {
  const title = getPlannerIntentTitle(intent)
  const parts = [`Создать задачу «${title}»`]

  if (intent.reminderAt) {
    parts.push(`напоминание: ${intent.reminderAt}`)
  } else if (intent.date && intent.time) {
    parts.push(`${intent.date} в ${intent.time}`)
  } else if (intent.date) {
    parts.push(intent.date)
  }

  if (intent.priority === 'high') {
    parts.push('высокий приоритет')
  }

  return `${parts.join(', ')}.`
}

export async function executeCreateTaskAction(
  preview: VoiceActionPreview,
  dependencies: PlannerActionExecutorDependencies,
): Promise<VoiceActionResult> {
  const taskInput = {
    ...buildTaskInputFromPlannerIntent(preview.intent),
    id: generateUuidV7(),
  }

  try {
    const result = await dependencies.createTask(taskInput)

    if (result === false) {
      return createResult({
        errorCode: 'task_create_failed',
        status: 'failed',
        visualStatus: 'Не удалось сохранить задачу.',
      })
    }

    return createResult({
      changedData: true,
      createdTaskId: getRecordId(result) ?? taskInput.id,
      status: 'success',
      undo: {
        createdTaskId: getRecordId(result) ?? taskInput.id,
        type: 'create_task',
      },
      visualStatus: 'Готово, задача сохранена.',
    })
  } catch {
    return createResult({
      errorCode: 'task_create_failed',
      status: 'failed',
      visualStatus: 'Не удалось сохранить задачу.',
    })
  }
}

export async function undoCreateTaskAction(
  undo: Extract<VoiceActionUndo, { type: 'create_task' }>,
  dependencies: PlannerActionExecutorDependencies,
): Promise<VoiceActionResult> {
  if (!dependencies.removeTask) {
    return createResult({
      errorCode: 'voice_action_undo_unavailable',
      status: 'failed',
      visualStatus: 'Отмена создания задачи сейчас недоступна.',
    })
  }

  try {
    const result = await dependencies.removeTask(undo.createdTaskId)

    if (result === false) {
      return createResult({
        errorCode: 'task_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить создание задачи.',
      })
    }

    await dependencies.refreshPlanner?.()

    return createResult({
      changedData: true,
      status: 'success',
      visualStatus: 'Создание задачи отменено.',
    })
  } catch {
    return createResult({
      errorCode: 'task_undo_failed',
      status: 'failed',
      visualStatus: 'Не удалось отменить создание задачи.',
    })
  }
}
