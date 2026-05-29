import type {
  PlannerIntent,
  VoiceActionPreview,
  VoiceAssistantState,
} from '@planner/contracts'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_CLARIFICATION_ATTEMPTS,
  VoiceConfirmationCard,
  type VoiceConfirmationCardProps,
} from './VoiceConfirmationCard'

describe('VoiceConfirmationCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows create_task confirmation details and executes only after save', () => {
    const preview = createPreview({
      intent: createIntent({
        date: '2026-05-30',
        intent: 'create_task',
        priority: 'high',
        rawText: 'создай задачу позвонить врачу завтра',
        sphereId: 'health',
        time: '09:00',
        title: 'позвонить врачу',
      }),
      summary: 'Создать задачу «позвонить врачу», 2026-05-30 в 09:00.',
      title: 'Создать задачу',
      type: 'create_task',
    })
    const callbacks = renderCard({ preview })

    expect(screen.getByText('Новая задача')).toBeVisible()
    expect(screen.getByText('позвонить врачу')).toBeVisible()
    expect(screen.getByText('здоровье')).toBeVisible()
    expect(callbacks.onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }))

    expect(callbacks.onConfirm).toHaveBeenCalledWith(preview, {})
  })

  it('shows shopping items and add confirmation', () => {
    const preview = createPreview({
      intent: createIntent({
        intent: 'add_shopping_item',
        items: [{ title: 'молоко' }, { quantity: '2', title: 'хлеб' }],
        rawText: 'добавь в покупки молоко и два хлеба',
      }),
      summary: 'Добавить в покупки: молоко, 2 хлеб.',
      title: 'Добавить в покупки',
      type: 'add_shopping_item',
    })
    const callbacks = renderCard({ preview })

    expect(screen.getByText('молоко')).toBeVisible()
    expect(screen.getByText('2 хлеб')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /добавить/i }))

    expect(callbacks.onConfirm).toHaveBeenCalledWith(preview, {})
  })

  it('uses strict dangerous confirmation for reschedule', () => {
    const preview = createPreview({
      candidates: [
        {
          plannedDate: '2026-05-29',
          plannedEndTime: null,
          plannedStartTime: '10:00',
          taskId: 'task-1',
          title: 'Помыть окна',
          updatedAt: '2026-05-28T09:00:00.000Z',
          version: 3,
        },
      ],
      intent: createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        time: '12:00',
      }),
      isDangerous: true,
      summary: 'Перенести «Помыть окна» на 2026-05-30 в 12:00.',
      title: 'Перенести задачу',
      type: 'reschedule_task',
    })
    const callbacks = renderCard({
      preview,
      selectedCandidateId: 'task-1',
    })

    expect(screen.getByText('Это изменит существующую задачу.')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /да, перенести/i }))

    expect(callbacks.onConfirm).toHaveBeenCalledWith(preview, {
      candidateTaskId: 'task-1',
      expectedVersion: 3,
    })
  })

  it('requires candidate selection before multiple_candidates execution', () => {
    const preview = createPreview({
      canExecute: false,
      candidates: [
        createCandidate({ taskId: 'task-1', title: 'Помыть окна на кухне' }),
        createCandidate({ taskId: 'task-2', title: 'Помыть окна в спальне' }),
      ],
      intent: createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
      }),
      isDangerous: true,
      status: 'multiple_candidates',
      summary: 'Нашла несколько похожих задач. Выбери, какую перенести.',
      title: 'Какую задачу перенести?',
      type: 'reschedule_task',
    })
    const callbacks = createCallbacks()
    const { rerender } = render(
      <VoiceConfirmationCard
        {...createProps({ callbacks, preview, selectedCandidateId: null })}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /продолжить/i }),
    ).not.toBeInTheDocument()

    rerender(
      <VoiceConfirmationCard
        {...createProps({
          callbacks,
          preview,
          selectedCandidateId: 'task-2',
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /продолжить/i }))

    expect(callbacks.onConfirm).toHaveBeenCalledWith(preview, {
      candidateTaskId: 'task-2',
      expectedVersion: 1,
    })
  })

  it('keeps not_found from executing and offers a separate create preview', () => {
    const preview = createPreview({
      canExecute: false,
      intent: createIntent({
        date: '2026-05-30',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
      }),
      status: 'not_found',
      summary: 'Не нашла задачу «помыть окна».',
      title: 'Задача не найдена',
      type: 'reschedule_task',
    })
    const callbacks = renderCard({ preview })

    expect(
      screen.queryByRole('button', { name: /перенести|продолжить/i }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /создать новую/i }))

    expect(callbacks.onConfirm).not.toHaveBeenCalled()
    expect(callbacks.onCreateFromNotFound).toHaveBeenCalledWith(preview)
  })

  it('does not disclose transcript details for requires_unlock', () => {
    const preview = createPreview({
      canExecute: false,
      intent: createIntent({
        date: '2026-05-30',
        intent: 'get_agenda',
        rawText: 'покажи расписание врача завтра',
        requiresUnlock: true,
      }),
      requiresUnlock: true,
      status: 'requires_unlock',
      summary: 'Разблокируй устройство, чтобы посмотреть план.',
      title: 'Нужна разблокировка',
      type: 'get_agenda',
    })

    renderCard({ preview })

    expect(
      screen.getByText('Разблокируй телефон, чтобы продолжить.'),
    ).toBeVisible()
    expect(screen.queryByText(/расписание врача/i)).not.toBeInTheDocument()
  })

  it('shows clarify options, repeat, and safe inbox fallback after the limit', () => {
    const preview = createPreview({
      canExecute: false,
      intent: createIntent({
        clarificationQuestion: 'В 8 утра или вечера?',
        intent: 'clarify',
        rawText: 'напомни полить рассаду в 8',
      }),
      needsConfirmation: false,
      status: 'requires_clarification',
      summary: 'В 8 утра или вечера?',
      title: 'Нужно уточнение',
      type: 'clarify',
    })
    const callbacks = createCallbacks()
    const { rerender } = render(
      <VoiceConfirmationCard {...createProps({ callbacks, preview })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '8:00' }))
    fireEvent.click(screen.getByRole('button', { name: /повторить/i }))

    expect(callbacks.onClarifyOption).toHaveBeenCalledWith(
      'напомни полить рассаду в 8 8 утра',
    )
    expect(callbacks.onRepeat).toHaveBeenCalled()

    rerender(
      <VoiceConfirmationCard
        {...createProps({
          callbacks,
          clarificationAttempts: MAX_CLARIFICATION_ATTEMPTS,
          preview,
        })}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /сохранить во входящие/i }),
    )

    expect(callbacks.onSaveClarificationToInbox).toHaveBeenCalledWith(preview)
  })

  it('keeps unsupported dangerous actions without an execution button', () => {
    const preview = createPreview({
      canExecute: false,
      intent: createIntent({
        clarificationQuestion: 'Удаление голосом пока не поддерживается.',
        intent: 'unsupported',
        isDangerous: true,
        rawText: 'удали все задачи завтра',
      }),
      isDangerous: true,
      needsConfirmation: false,
      status: 'unsupported',
      summary: 'Удаление голосом пока не поддерживается.',
      title: 'Команда не поддерживается',
      type: 'unsupported',
    })

    renderCard({ preview })

    expect(
      screen.getByText(
        'Опасные и массовые действия голосом сейчас не выполняются.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /подтвердить/i }),
    ).not.toBeInTheDocument()
  })

  it('does not execute when cancel or edit is selected', () => {
    const preview = createPreview()
    const callbacks = renderCard({ preview })

    fireEvent.click(screen.getByRole('button', { name: /изменить/i }))
    fireEvent.change(screen.getByLabelText('Изменить распознанный текст'), {
      target: { value: 'создай задачу купить грунт' },
    })
    fireEvent.click(screen.getByRole('button', { name: /применить/i }))
    fireEvent.click(screen.getByRole('button', { name: /отмена/i }))

    expect(callbacks.onEditTranscript).toHaveBeenCalledWith(
      'создай задачу купить грунт',
    )
    expect(callbacks.onClose).toHaveBeenCalled()
    expect(callbacks.onConfirm).not.toHaveBeenCalled()
  })

  it('shows undo for successful reversible result', () => {
    const preview = createPreview()
    const callbacks = renderCard({
      preview,
      result: {
        changedData: true,
        createdTaskId: 'task-1',
        status: 'success',
        undo: {
          createdTaskId: 'task-1',
          type: 'create_task',
        },
        visualStatus: 'Готово, задача сохранена.',
      },
      state: {
        intent: preview.intent,
        source: 'web_microphone',
        status: 'completed',
        transcript: preview.intent.rawText,
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /^отменить$/i }))

    expect(callbacks.onUndo).toHaveBeenCalled()
  })

  it('shows agenda visually without an execution confirmation button', () => {
    const preview = createPreview({
      agendaItems: [
        {
          plannedStartTime: '09:00',
          status: 'todo',
          taskId: 'task-1',
          title: 'Позвонить врачу',
        },
      ],
      canExecute: false,
      intent: createIntent({
        date: '2026-05-30',
        intent: 'get_agenda',
        rawText: 'покажи задачи на завтра',
      }),
      needsConfirmation: false,
      summary: 'На 2026-05-30 1 задача.',
      title: 'План на 2026-05-30',
      type: 'get_agenda',
    })

    renderCard({ preview })

    expect(screen.getByText('Позвонить врачу')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /показать|готово/i }),
    ).not.toBeInTheDocument()
  })
})

function renderCard(overrides: Partial<VoiceConfirmationCardProps> = {}) {
  const callbacks = createCallbacks()

  render(
    <VoiceConfirmationCard {...createProps({ callbacks, ...overrides })} />,
  )

  return callbacks
}

function createProps({
  callbacks = createCallbacks(),
  preview = createPreview(),
  state,
  ...overrides
}: Partial<VoiceConfirmationCardProps> & {
  callbacks?: ReturnType<typeof createCallbacks>
} = {}): VoiceConfirmationCardProps {
  const resolvedPreview = preview ?? createPreview()

  return {
    clarificationAttempts: 0,
    isUndoing: false,
    preview: resolvedPreview,
    result: null,
    selectedCandidateId: resolvedPreview.candidates?.[0]?.taskId ?? null,
    spheres: [{ id: 'health', name: 'здоровье' }],
    state:
      state ??
      ({
        intent: resolvedPreview.intent,
        source: 'web_microphone',
        status: 'awaiting_confirmation',
        transcript: resolvedPreview.intent.rawText,
      } satisfies VoiceAssistantState),
    ...callbacks,
    ...overrides,
  }
}

function createCallbacks() {
  return {
    onClarifyOption: vi.fn(),
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onCreateFromNotFound: vi.fn(),
    onEditTranscript: vi.fn(),
    onRepeat: vi.fn(),
    onSaveClarificationToInbox: vi.fn(),
    onSelectCandidate: vi.fn(),
    onUndo: vi.fn(),
  }
}

function createPreview(
  overrides: Partial<VoiceActionPreview> = {},
): VoiceActionPreview {
  const intent = overrides.intent ?? createIntent()

  return {
    canExecute: true,
    id: 'preview-1',
    intent,
    isDangerous: Boolean(intent.isDangerous),
    needsConfirmation: intent.needsConfirmation,
    requiresUnlock: false,
    status: 'ready_for_confirmation',
    summary: 'Создать задачу «проверить оплату».',
    title: 'Создать задачу',
    type: intent.intent,
    ...overrides,
  } as VoiceActionPreview
}

function createIntent(overrides: Partial<PlannerIntent> = {}): PlannerIntent {
  return {
    confidence: 0.9,
    intent: 'create_task',
    needsConfirmation: true,
    rawText: 'создай задачу проверить оплату',
    title: 'проверить оплату',
    ...overrides,
  } as PlannerIntent
}

function createCandidate(
  overrides: Pick<
    NonNullable<VoiceActionPreview['candidates']>[number],
    'taskId' | 'title'
  > &
    Partial<NonNullable<VoiceActionPreview['candidates']>[number]>,
): NonNullable<VoiceActionPreview['candidates']>[number] {
  return {
    plannedDate: '2026-05-29',
    plannedEndTime: null,
    plannedStartTime: null,
    updatedAt: '2026-05-28T09:00:00.000Z',
    version: 1,
    ...overrides,
  }
}
