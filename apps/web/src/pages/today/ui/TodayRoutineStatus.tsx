import type { ReactNode } from 'react'

import type { TodayRoutineSummaryModel } from '../model/useTodayRoutineSummary'
import { TodaySourceStatus, type TodayStatusSource } from './TodaySourceStatus'
import { TodayStatusNotice } from './TodayStatusNotice'

export function TodayRoutineStatus({
  additionalSources = [],
  status,
  summary,
}: {
  additionalSources?: TodayStatusSource[]
  status?: ReactNode
  summary: TodayRoutineSummaryModel
}) {
  return (
    <>
      {status ?? (
        <TodaySourceStatus
          sources={[
            { label: 'Покупки', query: summary.shoppingQuery },
            { label: 'Уборка', query: summary.cleaningQuery },
            ...additionalSources,
          ]}
        />
      )}
      {summary.shoppingActionError ? (
        <TodayStatusNotice
          action={
            summary.onRetryShoppingAction
              ? {
                  disabled: summary.isShoppingItemPending,
                  label: 'Повторить отметку покупки',
                  onClick: summary.onRetryShoppingAction,
                }
              : undefined
          }
          message="Не удалось отметить покупку купленной"
        />
      ) : null}
    </>
  )
}
