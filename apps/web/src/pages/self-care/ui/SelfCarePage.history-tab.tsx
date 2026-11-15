import type { SelfCareCompletion } from '@planner/contracts'

import type { useSelfCareHistory } from '@/features/self-care'
import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { getDateKeyInTimeZone } from '@/shared/time/time.service'
import { EditIcon } from '@/shared/ui/Icon'
import { PageStateView } from '@/shared/ui/PageState'

import {
  formatCompletionCost,
  formatCompletionMeasurementHistoryValue,
  formatDate,
  formatStateCompletionSummary,
  getCompletionCost,
  STATUS_LABELS,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'

export function SelfCareHistoryTab({
  canAddCare,
  defaultCurrency,
  history,
  isBusy,
  isAddingCare,
  onAddCare,
  onEditCompletion,
}: {
  canAddCare: boolean
  defaultCurrency: string
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  isAddingCare: boolean
  onAddCare: () => void
  onEditCompletion: (completion: SelfCareCompletion) => void
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const itemById = new Map(
    (history?.items ?? []).map((item) => [item.id, item]),
  )
  const completions = [...(history?.completions ?? [])].sort((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  )

  if (!completions.length) {
    return (
      <PageStateView
        action={
          canAddCare
            ? {
                disabled: isBusy,
                label: isAddingCare ? 'Добавляем…' : 'Добавить заботу',
                onClick: onAddCare,
              }
            : undefined
        }
        description="Выберите более ранний период, чтобы посмотреть прошлые заботы."
        kind="empty"
        title="Нет записей за этот период"
      />
    )
  }

  return (
    <div className={styles.timeline}>
      {completions.map((completion) => {
        const item = itemById.get(completion.itemId)
        const measurementHistoryValue = formatCompletionMeasurementHistoryValue(
          completion,
          item,
        )
        const completionCost = getCompletionCost(completion, item, {
          appointmentDetails: history?.appointmentDetails ?? [],
          procedureDetails: history?.procedureDetails ?? [],
        })
        const costHistoryValue = formatCompletionCost(
          completionCost,
          defaultCurrency,
        )
        return (
          <article key={completion.id} className={styles.historyCard}>
            <time
              dateTime={getDateKeyInTimeZone(
                completion.completedAt,
                plannerTimeZone,
              )}
            >
              {formatDate(
                getDateKeyInTimeZone(completion.completedAt, plannerTimeZone),
              )}
            </time>
            <div>
              <h3>{item?.title ?? 'Забота о себе'}</h3>
              <p>{STATUS_LABELS[completion.status]}</p>
              {costHistoryValue ? (
                <p className={styles.measurementHistoryValue}>
                  {costHistoryValue}
                </p>
              ) : null}
              {measurementHistoryValue ? (
                <p className={styles.measurementHistoryValue}>
                  {measurementHistoryValue}
                </p>
              ) : null}
              {formatStateCompletionSummary(completion) ? (
                <p className={styles.stateHistoryValue}>
                  {formatStateCompletionSummary(completion)}
                </p>
              ) : null}
              {completion.note ? (
                <p className={styles.noteText}>{completion.note}</p>
              ) : null}
            </div>
            <div className={styles.historyCardActions}>
              <button
                className={cx(
                  styles.cardActionButton,
                  styles.cardActionButtonSoft,
                )}
                type="button"
                disabled={isBusy}
                title="Редактировать"
                aria-label={`Редактировать запись «${item?.title ?? 'Забота о себе'}»`}
                onClick={() => onEditCompletion(completion)}
              >
                <EditIcon size={17} strokeWidth={2.1} />
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
