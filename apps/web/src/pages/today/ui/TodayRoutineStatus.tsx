import { PageStatusBanner } from '@/shared/ui/PageState'

import type { TodayRoutineSummaryModel } from '../model/useTodayRoutineSummary'
import { TodaySourceStatus } from './TodaySourceStatus'

export function TodayRoutineStatus({
  summary,
}: {
  summary: TodayRoutineSummaryModel
}) {
  return (
    <>
      <TodaySourceStatus
        emptyMessage="Покупки: список пуст."
        isEmpty={summary.shoppingItems.length === 0}
        label="Покупки"
        query={summary.shoppingQuery}
      />
      <TodaySourceStatus
        emptyMessage="Уборка: на сегодня задач нет."
        isEmpty={summary.cleaningSummary === null}
        label="Уборка"
        query={summary.cleaningQuery}
      />
      {summary.shoppingActionError ? (
        <PageStatusBanner
          action={
            summary.onRetryShoppingAction
              ? {
                  disabled: summary.isShoppingItemPending,
                  label: 'Повторить отметку покупки',
                  onClick: summary.onRetryShoppingAction,
                }
              : undefined
          }
          description="Попробуйте ещё раз или откройте список покупок."
          kind="error"
          title="Не удалось отметить покупку купленной"
        />
      ) : null}
    </>
  )
}
