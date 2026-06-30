import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  lazy,
  type PointerEvent,
  type PropsWithChildren,
  Suspense,
  useRef,
  useState,
} from 'react'

import { usePlannerTimeZone } from '@/features/session'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import type { PlannerState } from '../model/planner.types'
import { PlannerContext } from '../model/planner-context'
import { usePlannerState } from '../model/usePlannerState'
import styles from './PlannerProvider.module.css'

const SNACKBAR_SWIPE_DISMISS_THRESHOLD = 80
const TaskNextStageDialog = lazy(() =>
  import('@/entities/task/ui').then((module) => ({
    default: module.TaskNextStageDialog,
  })),
)

export function PlannerQueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            retry: 0,
          },
          queries: {
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export function PlannerProvider({ children }: PropsWithChildren) {
  const planner = usePlannerState()

  return (
    <PlannerContext.Provider value={planner}>
      {children}
      <PlannerTaskActionSnackbar planner={planner} />
    </PlannerContext.Provider>
  )
}

function PlannerTaskActionSnackbar({ planner }: { planner: PlannerState }) {
  const snackbar = planner.taskActionSnackbar

  if (!snackbar) {
    return null
  }

  return (
    <PlannerTaskActionSnackbarContent
      key={snackbar.id}
      planner={planner}
      snackbar={snackbar}
    />
  )
}

function PlannerTaskActionSnackbarContent({
  planner,
  snackbar,
}: {
  planner: PlannerState
  snackbar: NonNullable<PlannerState['taskActionSnackbar']>
}) {
  const [nextStageTaskId, setNextStageTaskId] = useState<string | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const swipeStartRef = useRef<{
    pointerId: number
    x: number
    y: number
  } | null>(null)
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const tomorrowKey = addDateDays(todayKey, 1)
  const actionTaskId = snackbar?.chainCompletionTaskId ?? null
  const nextStageTask = nextStageTaskId
    ? (planner.tasks.find((task) => task.id === nextStageTaskId) ?? null)
    : null

  function handleSnackbarPointerDown(
    event: PointerEvent<HTMLDivElement>,
  ): void {
    if (event.button !== 0) {
      return
    }

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handleSnackbarPointerMove(
    event: PointerEvent<HTMLDivElement>,
  ): void {
    const start = swipeStartRef.current

    if (!start || start.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y

    if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setSwipeOffset(deltaX)
    }
  }

  function finishSnackbarSwipe(event: PointerEvent<HTMLDivElement>): void {
    const start = swipeStartRef.current

    if (!start || start.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    swipeStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (
      Math.abs(deltaX) >= SNACKBAR_SWIPE_DISMISS_THRESHOLD &&
      Math.abs(deltaX) > Math.abs(deltaY)
    ) {
      planner.clearTaskActionSnackbar()
      return
    }

    setSwipeOffset(0)
  }

  function cancelSnackbarSwipe(event: PointerEvent<HTMLDivElement>): void {
    swipeStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setSwipeOffset(0)
  }

  const snackbarSwipeStyle =
    swipeOffset === 0
      ? undefined
      : {
          opacity: Math.max(0.35, 1 - Math.abs(swipeOffset) / 240),
          transform: `translateX(${swipeOffset}px)`,
        }

  return (
    <>
      <div
        className={styles.snackbar}
        role="status"
        aria-live="polite"
        style={snackbarSwipeStyle}
        onPointerCancel={cancelSnackbarSwipe}
        onPointerDown={handleSnackbarPointerDown}
        onPointerMove={handleSnackbarPointerMove}
        onPointerUp={finishSnackbarSwipe}
      >
        <span>{snackbar.message}</span>
        <div className={styles.snackbarActions}>
          {actionTaskId ? (
            <button
              className={styles.snackbarButton}
              type="button"
              disabled={planner.isTaskPending(actionTaskId)}
              onClick={() => setNextStageTaskId(actionTaskId)}
            >
              Создать следующий этап
            </button>
          ) : null}
          {snackbar.chainCompletionTaskId ? (
            <button
              className={styles.snackbarButton}
              type="button"
              disabled={planner.isTaskPending(snackbar.chainCompletionTaskId)}
              onClick={() => {
                void planner.closeTaskChain(snackbar.chainCompletionTaskId!)
              }}
            >
              Завершить цепочку
            </button>
          ) : null}
          {snackbar.undo ? (
            <button
              className={styles.snackbarButton}
              type="button"
              disabled={planner.isTaskPending(snackbar.undo.taskId)}
              onClick={() => {
                void planner.undoNextTaskStage(
                  snackbar.undo!.taskId,
                  snackbar.undo!.input,
                )
              }}
            >
              Отменить
            </button>
          ) : null}
          <button
            className={styles.snackbarCloseButton}
            type="button"
            aria-label="Закрыть уведомление"
            onClick={planner.clearTaskActionSnackbar}
          >
            ×
          </button>
        </div>
      </div>

      {nextStageTask ? (
        <Suspense fallback={null}>
          <TaskNextStageDialog
            defaultTitle={nextStageTask.title}
            isPending={planner.isTaskPending(nextStageTask.id)}
            onClose={() => setNextStageTaskId(null)}
            todayKey={todayKey}
            tomorrowKey={tomorrowKey}
            onSubmit={(input) =>
              planner.createNextTaskStage(nextStageTask.id, {
                plannedDate: input.plannedDate,
                title: input.title,
              })
            }
          />
        </Suspense>
      ) : null}
    </>
  )
}
