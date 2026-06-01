import {
  type PlannerIntent,
  type VoiceActionPreview,
  type VoiceAssistantState,
  voiceCommandCorpusV1,
  type VoiceTestCase,
} from '@planner/contracts'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_CLARIFICATION_ATTEMPTS,
  VOICE_UNDO_TTL_MS,
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

    expect(screen.getByText('Молоко')).toBeVisible()
    expect(screen.getByText('2 Хлеб')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /добавить/i }))

    expect(callbacks.onConfirm).toHaveBeenCalledWith(preview, {})
  })

  it('shows active shopping list as a preview-only result', () => {
    const preview = createPreview({
      canExecute: false,
      intent: createIntent({
        intent: 'get_shopping_list',
        needsConfirmation: false,
        rawText: 'что надо купить',
      }),
      needsConfirmation: false,
      shoppingItems: [
        { shoppingItemId: 'shopping-1', title: 'Молоко' },
        { shoppingItemId: 'shopping-2', title: 'Хлеб' },
      ],
      summary: 'Нужно купить: Молоко, Хлеб.',
      title: 'Список покупок',
      type: 'get_shopping_list',
    })
    const callbacks = renderCard({ preview })

    expect(screen.getByText('Нужно купить')).toBeVisible()
    expect(screen.getByText('Молоко')).toBeVisible()
    expect(screen.getByText('Хлеб')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /показать/i }),
    ).not.toBeInTheDocument()
    expect(callbacks.onConfirm).not.toHaveBeenCalled()
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
      confirmed: true,
      expectedVersion: 3,
    })
  })

  it('shows relative reschedule shift details', () => {
    const preview = createPreview({
      candidates: [
        {
          plannedDate: '2026-05-29',
          plannedEndTime: '11:00',
          plannedStartTime: '10:00',
          taskId: 'task-1',
          title: 'Помыть окна',
          updatedAt: '2026-05-28T09:00:00.000Z',
          version: 3,
        },
      ],
      intent: createIntent({
        datePrecision: 'relative',
        intent: 'reschedule_task',
        targetQuery: 'помыть окна',
        timeShiftMinutes: -60,
        timeShiftText: 'на час раньше',
      }),
      isDangerous: true,
      summary: 'Сдвинуть «Помыть окна» на час раньше: 2026-05-29 в 09:00.',
      title: 'Перенести задачу',
      type: 'reschedule_task',
    })

    renderCard({ preview, selectedCandidateId: 'task-1' })

    expect(screen.getByText('2026-05-29, 10:00')).toBeVisible()
    expect(screen.getByText('на час раньше')).toBeVisible()
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
      confirmed: true,
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

  it('expires undo in the current confirmation card session', () => {
    vi.useFakeTimers()

    try {
      const preview = createPreview()

      renderCard({
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

      expect(screen.getByRole('button', { name: /^отменить$/i })).toBeVisible()

      act(() => {
        vi.advanceTimersByTime(VOICE_UNDO_TTL_MS)
      })

      expect(
        screen.queryByRole('button', { name: /^отменить$/i }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Время отмены истекло.')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides undo after an undo result has consumed the payload', () => {
    const preview = createPreview()

    renderCard({
      preview,
      result: {
        changedData: true,
        status: 'success',
        visualStatus: 'Перенос отменен.',
      },
      state: {
        intent: preview.intent,
        source: 'web_microphone',
        status: 'completed',
        transcript: 'перенеси помыть окна на завтра',
      },
    })

    expect(screen.getByText('Перенос отменен.')).toBeVisible()
    expect(screen.getByText('Отменено')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /^отменить$/i }),
    ).not.toBeInTheDocument()
  })

  it('shows undo failure as visual-only status without another undo button', () => {
    const preview = createPreview()

    renderCard({
      preview,
      result: {
        errorCode: 'voice_action_undo_failed',
        status: 'failed',
        visualStatus: 'Не удалось отменить. Обнови экран.',
      },
      state: {
        intent: preview.intent,
        source: 'web_microphone',
        status: 'completed',
        transcript: 'создай задачу проверить оплату',
      },
    })

    expect(screen.getByText('Не удалось отменить. Обнови экран.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /^отменить$/i }),
    ).not.toBeInTheDocument()
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

  it('renders selected confirmation UI expectations from the shared corpus', () => {
    const corpusCases = [
      'task_basic_015',
      'shopping_001',
      'reschedule_001',
      'agenda_001',
      'clarify_003',
      'dangerous_001',
      'locked_screen_003',
    ].map(getCorpusCase)

    for (const corpusCase of corpusCases) {
      cleanup()

      const preview = createPreviewFromCorpusCase(corpusCase)

      renderCard({
        preview,
        selectedCandidateId: preview.candidates?.[0]?.taskId ?? null,
        state: {
          intent: preview.intent,
          source: 'web_microphone',
          status: 'awaiting_confirmation',
          transcript: preview.intent.rawText,
        },
      })

      for (const text of corpusCase.expectedUI?.mustShow ?? []) {
        expect(
          screen.queryAllByText((content) => content.includes(text)).length,
          `${corpusCase.id}: ${text}`,
        ).toBeGreaterThan(0)
      }

      for (const text of corpusCase.expectedUI?.mustNotShow ?? []) {
        expect(
          screen.queryByText((content) => content.includes(text)),
          `${corpusCase.id}: ${text}`,
        ).not.toBeInTheDocument()
      }

      for (const button of corpusCase.expectedUI?.buttons ?? []) {
        expect(
          screen.getAllByRole('button', { name: new RegExp(button, 'iu') })[0],
          `${corpusCase.id}: ${button}`,
        ).toBeVisible()
      }
    }
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

function getCorpusCase(id: string): VoiceTestCase {
  const testCase = voiceCommandCorpusV1.find((candidate) => candidate.id === id)

  if (!testCase) {
    throw new Error(`Missing voice corpus case: ${id}`)
  }

  return testCase
}

function createPreviewFromCorpusCase(
  testCase: VoiceTestCase,
): VoiceActionPreview {
  const intent = testCase.expectedIntent ?? createIntent()
  const status = testCase.expectedPreview?.status ?? 'ready_for_confirmation'
  const canExecute =
    testCase.expectedPreview?.canExecute ??
    (status === 'ready_for_confirmation' &&
      intent.intent !== 'get_agenda' &&
      intent.intent !== 'get_shopping_list')
  const candidates =
    intent.intent === 'reschedule_task' && status !== 'not_found'
      ? createCorpusCandidates(intent, testCase.expectedPreview?.candidateCount)
      : undefined

  return createPreview({
    agendaItems:
      intent.intent === 'get_agenda' && status === 'ready_for_confirmation'
        ? [
            {
              plannedStartTime: '09:00',
              status: 'todo',
              taskId: 'agenda-1',
              title: 'Позвонить врачу',
            },
          ]
        : undefined,
    shoppingItems:
      intent.intent === 'get_shopping_list' &&
      status === 'ready_for_confirmation'
        ? [
            {
              shoppingItemId: 'shopping-1',
              title: 'Молоко',
            },
          ]
        : undefined,
    canExecute,
    candidates,
    intent,
    isDangerous: Boolean(intent.isDangerous),
    needsConfirmation:
      intent.intent === 'get_agenda' ||
      intent.intent === 'get_shopping_list' ||
      status === 'requires_clarification'
        ? false
        : true,
    requiresUnlock: status === 'requires_unlock',
    status,
    summary: createCorpusPreviewSummary(testCase),
    title: createCorpusPreviewTitle(testCase),
    type: intent.intent,
  })
}

function createCorpusCandidates(
  intent: PlannerIntent,
  candidateCount: VoiceTestCase['expectedPreview'] extends infer Preview
    ? Preview extends { candidateCount?: infer Count }
      ? Count
      : never
    : never,
): VoiceActionPreview['candidates'] {
  const targetQuery = intent.targetQuery ?? 'помыть окна'

  if (candidateCount === 2) {
    return [
      createCandidate({ taskId: 'task-1', title: `${targetQuery} на кухне` }),
      createCandidate({ taskId: 'task-2', title: `${targetQuery} в спальне` }),
    ]
  }

  return [createCandidate({ taskId: 'task-1', title: targetQuery })]
}

function createCorpusPreviewTitle(testCase: VoiceTestCase): string {
  switch (testCase.expectedUI?.card) {
    case 'agenda':
      return `План на ${testCase.expectedIntent?.date ?? 'сегодня'}`
    case 'clarify':
      return 'Нужно уточнение'
    case 'requires_unlock':
      return 'Нужна разблокировка'
    case 'reschedule_confirmation':
      return 'Перенести задачу'
    case 'shopping_confirmation':
      return 'Добавить в покупки'
    case 'shopping_list':
      return 'Список покупок'
    case 'unsupported':
      return 'Команда не поддерживается'
    case 'blocked':
      return 'Голосовое действие недоступно'
    case 'multiple_candidates':
      return 'Какую задачу перенести?'
    case 'not_found':
      return 'Задача не найдена'
    case 'task_confirmation':
    case undefined:
      return 'Создать задачу'
  }
}

function createCorpusPreviewSummary(testCase: VoiceTestCase): string {
  if (testCase.expectedPreview?.status === 'requires_unlock') {
    return 'Разблокируй устройство, чтобы посмотреть план.'
  }

  return (
    testCase.expectedIntent?.clarificationQuestion ??
    testCase.expectedUI?.mustShow?.[0] ??
    'Проверь действие перед выполнением.'
  )
}
