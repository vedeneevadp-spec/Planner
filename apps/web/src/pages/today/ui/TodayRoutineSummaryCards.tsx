import { CleaningZonesIcon, ShoppingCartIcon } from '@/shared/ui/Icon'

import type { TodayRoutineSummaryModel } from '../model/useTodayRoutineSummary'
import {
  TodayRoutineActionCard,
  type TodayRoutineCardVariant,
  TodayRoutineLinkCard,
} from './TodayRoutineCard'

interface TodayRoutineSummaryCardsProps extends Omit<
  TodayRoutineSummaryModel,
  'itemCount'
> {
  variant: TodayRoutineCardVariant
}

function pluralizeRu(count: number, one: string, few: string, many: string) {
  const absoluteCount = Math.abs(count)
  const lastTwoDigits = absoluteCount % 100
  const lastDigit = absoluteCount % 10

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return many
  }

  if (lastDigit === 1) {
    return one
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return few
  }

  return many
}

function formatShoppingItemCount(count: number) {
  return `${count} ${pluralizeRu(count, 'покупка', 'покупки', 'покупок')}`
}

function formatCleaningTaskCount(count: number) {
  return `${count} ${pluralizeRu(count, 'задача', 'задачи', 'задач')}`
}

export function TodayRoutineSummaryCards({
  cleaningSummary,
  isShoppingItemPending,
  shoppingItems,
  variant,
  onCompleteShoppingItem,
}: TodayRoutineSummaryCardsProps) {
  const singleShoppingItem =
    shoppingItems.length === 1 ? shoppingItems[0] : undefined
  const shoppingItemCountLabel = formatShoppingItemCount(shoppingItems.length)
  const cleaningTaskCountLabel = cleaningSummary
    ? formatCleaningTaskCount(cleaningSummary.taskCount)
    : ''

  return (
    <>
      {singleShoppingItem ? (
        <TodayRoutineActionCard
          ariaLabel={`Отметить покупку купленной: ${singleShoppingItem.text}`}
          disabled={isShoppingItemPending}
          icon={<ShoppingCartIcon size={18} />}
          meta="Покупки"
          title={`Купить ${singleShoppingItem.text}`}
          tone="shopping"
          variant={variant}
          onClick={() => onCompleteShoppingItem(singleShoppingItem.id)}
        />
      ) : shoppingItems.length > 1 ? (
        <TodayRoutineLinkCard
          ariaLabel={`Открыть покупки: ${shoppingItemCountLabel}`}
          icon={<ShoppingCartIcon size={18} />}
          meta={shoppingItemCountLabel}
          title="Покупки"
          to="/shopping"
          tone="shopping"
          variant={variant}
        />
      ) : null}

      {cleaningSummary ? (
        <TodayRoutineLinkCard
          ariaLabel={`Открыть уборку: ${cleaningSummary.areaLabel}, ${cleaningTaskCountLabel}`}
          icon={<CleaningZonesIcon size={18} />}
          meta={`${cleaningTaskCountLabel} · ${cleaningSummary.areaLabel}`}
          title="Уборка"
          to="/cleaning"
          variant={variant}
        />
      ) : null}
    </>
  )
}
