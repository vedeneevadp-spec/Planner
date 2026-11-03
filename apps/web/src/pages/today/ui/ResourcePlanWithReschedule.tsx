import { useRef, useState } from 'react'

import { isActiveTaskStatus, type Task } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { usePlannerSession } from '@/features/session'
import { formatShortDate } from '@/shared/lib/date'

import type { EnergyMode } from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import { TaskRescheduleDialog } from './TaskRescheduleDialog'
import styles from './TaskRescheduleDialog.module.css'

export function ResourcePlanWithReschedule(props: {
  energyMode: EnergyMode
  isTaskDataComplete: boolean
  isTaskPending: (id: string) => boolean
  tasks: Task[]
  onEnergyModeChange: (mode: EnergyMode) => void
}) {
  const { tasks, setTaskPlannedDate } = usePlanner()
  const { data: session } = usePlannerSession()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [undo, setUndo] = useState<{
    task: Task
    target: string
    workspaceId: string | undefined
  } | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const lock = useRef(false)
  const selectedTask = tasks.find(
    (task) => task.id === selectedId && isActiveTaskStatus(task.status),
  )
  const currentUndo = undo?.workspaceId === session?.workspaceId ? undo : null
  async function undoMove() {
    if (!currentUndo || lock.current) return
    const current = tasks.find((task) => task.id === currentUndo.task.id)
    if (
      !current ||
      !isActiveTaskStatus(current.status) ||
      current.plannedDate !== currentUndo.target ||
      current.plannedStartTime !== currentUndo.task.plannedStartTime ||
      current.plannedEndTime !== currentUndo.task.plannedEndTime
    ) {
      setUndoError('Задача уже изменилась. Проверь её дату в календаре.')
      return
    }
    lock.current = true
    setUndoBusy(true)
    try {
      if (await setTaskPlannedDate(current.id, currentUndo.task.plannedDate)) {
        setUndo(null)
        setUndoError(null)
      } else setUndoError('Не удалось отменить перенос. Попробуй ещё раз.')
    } finally {
      lock.current = false
      setUndoBusy(false)
    }
  }
  return (
    <>
      <ResourcePlanPanel {...props} onChooseTaskDate={setSelectedId} />
      {selectedTask ? (
        <TaskRescheduleDialog
          key={`${session?.workspaceId}:${selectedTask.id}`}
          task={selectedTask}
          todayTasks={props.tasks}
          energyMode={props.energyMode}
          todayComplete={props.isTaskDataComplete}
          onClose={() => setSelectedId(null)}
          onMoved={(task, target) => {
            setUndo({ task, target, workspaceId: session?.workspaceId })
            setUndoError(null)
            setSelectedId(null)
          }}
        />
      ) : null}
      {currentUndo ? (
        <div className={styles.snackbar} role="status">
          <span>
            {undoError ??
              `«${currentUndo.task.title}» — ${formatShortDate(currentUndo.target)}`}
          </span>
          <button
            type="button"
            disabled={undoBusy || props.isTaskPending(currentUndo.task.id)}
            onClick={() => {
              void undoMove()
            }}
          >
            Отменить
          </button>
          <button
            type="button"
            disabled={undoBusy}
            aria-label="Скрыть сообщение о переносе"
            onClick={() => setUndo(null)}
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  )
}
