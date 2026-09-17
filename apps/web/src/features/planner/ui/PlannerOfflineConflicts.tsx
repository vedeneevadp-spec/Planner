import { useEffect, useState } from 'react'

import type { PlannerOfflineConflictGroup } from '../lib/offline-planner-conflicts'
import type { PlannerOfflineMutationRecord } from '../lib/offline-planner-store'
import type { PlannerState } from '../model/planner.types'
import styles from './PlannerOfflineConflicts.module.css'

export function PlannerOfflineConflicts({
  planner,
}: {
  planner: PlannerState
}) {
  const {
    loadOfflineConflictGroups,
    resolveOfflineConflict,
    conflictedMutationCount,
  } = planner
  const [loaded, setLoaded] = useState<{
    loader: typeof loadOfflineConflictGroups
    groups: PlannerOfflineConflictGroup[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void loadOfflineConflictGroups()
      .then((groups) => {
        if (active) setLoaded({ loader: loadOfflineConflictGroups, groups })
      })
      .catch(() => {
        if (active)
          setError(
            'Не удалось прочитать сохранённые изменения. Перезапустите приложение и откройте этот список снова.',
          )
      })
    return () => {
      active = false
    }
  }, [conflictedMutationCount, loadOfflineConflictGroups])
  const groups =
    loaded?.loader === loadOfflineConflictGroups ? loaded.groups : []

  async function resolve(id: string, action: 'retry' | 'discard') {
    setBusy(true)
    setError(null)
    try {
      await resolveOfflineConflict(id, action)
      const next = await loadOfflineConflictGroups()
      setLoaded({ loader: loadOfflineConflictGroups, groups: next })
      setConfirmDiscardId(null)
    } catch {
      setError(
        'Не удалось завершить действие. Проверьте соединение и повторите попытку.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={styles.panel} aria-label="Несинхронизированные изменения">
      <details>
        <summary>
          Несинхронизированные изменения ({conflictedMutationCount})
        </summary>
        <p>
          Ввод сохранён на этом устройстве. Связанные изменения ожидают решения;
          независимые продолжают синхронизироваться.
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {groups.map((group) => {
          const cause =
            group.mutations.find(
              (mutation) => mutation.conflictCode !== 'dependency_blocked',
            ) ?? group.mutations[0]!
          const versionConflict =
            cause.conflictCode?.endsWith('_version_conflict') ||
            cause.conflictActualVersion !== null
          return (
            <section
              className={styles.group}
              key={group.id}
              aria-label={`Сохранённая группа: ${mutationLabel(cause)}`}
            >
              <h2>{mutationLabel(cause)}</h2>
              <p>
                {versionConflict
                  ? 'Версия на сервере изменилась. Повтор не перезаписывает новую версию: сохраните свой ввод и сверьте его с текущей задачей.'
                  : 'Сервер отклонил изменение. После устранения причины можно повторить всю связанную последовательность.'}
              </p>
              {cause.lastError ? <p>{cause.lastError}</p> : null}
              <ol>
                {group.mutations.map((mutation) => (
                  <li key={mutation.id}>
                    <strong>{mutationLabel(mutation)}</strong>
                    <details>
                      <summary>Сохранённые данные</summary>
                      <pre className={styles.payload}>
                        {JSON.stringify(savedInput(mutation), null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
              {confirmDiscardId === group.id ? (
                <div>
                  <p>
                    Удалить все сохранённые изменения этой группы, включая
                    зависимые? Восстановить этот ввод из очереди будет нельзя.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve(group.id, 'discard')}
                  >
                    Удалить группу окончательно
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDiscardId(null)}
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      planner.isOffline ||
                      !planner.readiness.canWriteProtectedData
                    }
                    onClick={() => void resolve(group.id, 'retry')}
                  >
                    Повторить группу
                  </button>
                  <button
                    type="button"
                    disabled={busy || planner.isOffline}
                    onClick={() => setConfirmDiscardId(group.id)}
                  >
                    Удалить из очереди…
                  </button>
                </div>
              )}
            </section>
          )
        })}
      </details>
    </aside>
  )
}

function mutationLabel(mutation: PlannerOfflineMutationRecord): string {
  const actions: Record<PlannerOfflineMutationRecord['type'], string> = {
    'lifeSphere.create': 'Создание сферы',
    'lifeSphere.update': 'Изменение сферы',
    'task.create': 'Создание задачи',
    'task.update': 'Изменение задачи',
    'task.next-stage': 'Следующий этап',
    'task.status.update': 'Изменение статуса',
    'task.schedule.update': 'Изменение расписания',
    'task.delete': 'Удаление задачи',
  }
  const title =
    'input' in mutation
      ? 'title' in mutation.input
        ? mutation.input.title
        : 'name' in mutation.input
          ? mutation.input.name
          : ''
      : ''
  return `${actions[mutation.type]}${title ? `: ${title}` : ''}`
}

function savedInput(mutation: PlannerOfflineMutationRecord): unknown {
  if ('input' in mutation) return mutation.input
  if ('schedule' in mutation) return mutation.schedule
  if ('statusValue' in mutation)
    return { status: mutation.statusValue, taskId: mutation.taskId }
  return { taskId: mutation.taskId, expectedVersion: mutation.expectedVersion }
}
