import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type { useSelfCareAnalytics } from '@/features/self-care'
import { cx } from '@/shared/lib/classnames'
import { CloseIcon } from '@/shared/ui/Icon'

import {
  buildVisibleCategoryDistribution,
  formatDate,
  formatExerciseDelta,
  formatExerciseValue,
  formatMeasurementDelta,
  formatMeasurementValue,
  formatMoney,
  formatMonthKey,
  formatShortDate,
  formatTime,
  getExerciseMetricLabel,
  getPercent,
  type SelfCareAnalyticsDetailSelection,
  STATUS_LABELS,
  VISIBLE_CATEGORY_LABELS,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'

type SelfCareAnalyticsData = NonNullable<
  ReturnType<typeof useSelfCareAnalytics>['data']
>
type MeasurementTrend = SelfCareAnalyticsData['measurementTrends'][number]
type MeasurementTrendPoint = MeasurementTrend['points'][number]
type ExerciseTrend = SelfCareAnalyticsData['exerciseTrends'][number]
type ExerciseTrendPoint = ExerciseTrend['points'][number]
type AnalyticsRecord =
  | {
      kind: 'exercise'
      point: ExerciseTrendPoint
      trend: ExerciseTrend
    }
  | {
      kind: 'measurement'
      point: MeasurementTrendPoint
      trend: MeasurementTrend
    }
type AnalyticsDetail =
  | {
      kind: 'exercise'
      trend: ExerciseTrend
    }
  | {
      kind: 'measurement'
      trend: MeasurementTrend
    }

const COMPLETION_VARIANT_LABELS = {
  alternative: 'альтернатива',
  full: 'полное',
  minimum: 'минимум',
} as const

export function SelfCareAnalyticsTab({
  analytics,
  detailSelection,
  defaultCurrency,
  onBackToOverview,
  onShowAll,
}: {
  analytics: ReturnType<typeof useSelfCareAnalytics>['data'] | undefined
  detailSelection: SelfCareAnalyticsDetailSelection | null
  defaultCurrency: string
  onBackToOverview: () => void
  onShowAll: (selection: SelfCareAnalyticsDetailSelection) => void
}) {
  const [selectedRecord, setSelectedRecord] = useState<AnalyticsRecord | null>(
    null,
  )
  const categoryDistribution = buildVisibleCategoryDistribution(
    analytics?.balanceByCategory ?? {},
  )
  const categoryTotal = categoryDistribution.reduce(
    (total, [, count]) => total + count,
    0,
  )
  const procedureCostsByMonth = Object.entries(
    analytics?.procedureCostsByMonth ?? {},
  )
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[0].localeCompare(left[0]))
    .slice(0, 6)
  const measurementTrends = analytics?.measurementTrends ?? []
  const exerciseTrends = analytics?.exerciseTrends ?? []
  const detail = useMemo(
    () =>
      detailSelection ? getAnalyticsDetail(analytics, detailSelection) : null,
    [analytics, detailSelection],
  )

  if (detailSelection) {
    return (
      <div className={styles.tabPanel}>
        <AnalyticsDetailView
          detail={detail}
          selection={detailSelection}
          onBack={onBackToOverview}
          onSelectRecord={setSelectedRecord}
        />
        {selectedRecord ? (
          <AnalyticsRecordDialog
            record={selectedRecord}
            onClose={() => setSelectedRecord(null)}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.tabPanel}>
      <section className={styles.analyticsHero}>
        <div>
          <p>За выбранный период</p>
          <span>Отметок заботы</span>
        </div>
        <strong>{analytics?.selectedSelfCareCount ?? 0}</strong>
      </section>

      <div className={cx(styles.gridTwo, styles.analyticsGrid)}>
        <section className={cx(styles.panel, styles.analyticsPanel)}>
          <h3>Баланс категорий</h3>
          {categoryDistribution.length ? (
            <div className={styles.categoryDistributionList}>
              {categoryDistribution.map(([category, count]) => (
                <CategoryDistributionRow
                  key={category}
                  count={count}
                  label={VISIBLE_CATEGORY_LABELS[category]}
                  percent={getPercent(count, categoryTotal)}
                />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Данные появятся после выполнений.
            </p>
          )}
        </section>

        <section className={cx(styles.panel, styles.analyticsPanel)}>
          <h3>Записи и здоровье</h3>
          <div className={styles.metricList}>
            <MetricRow
              label="Расходы на записи"
              value={formatMoney(
                analytics?.procedureCosts ?? 0,
                defaultCurrency,
              )}
            />
            <MetricRow
              label="Важные записи скоро"
              value={String(analytics?.medicalUpcoming.length ?? 0)}
            />
          </div>
          {procedureCostsByMonth.length ? (
            <>
              <span className={styles.analyticsSubheading}>По месяцам</span>
              <div className={styles.metricList}>
                {procedureCostsByMonth.map(([monthKey, value]) => (
                  <MetricRow
                    key={monthKey}
                    label={formatMonthKey(monthKey)}
                    value={formatMoney(value, defaultCurrency)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section
          className={cx(
            styles.panel,
            styles.analyticsPanel,
            styles.analyticsWidePanel,
          )}
        >
          <h3>Динамика измерений</h3>
          {measurementTrends.length ? (
            <div className={styles.measurementTrendList}>
              {measurementTrends.map((trend) => (
                <MeasurementTrendRow
                  key={trend.itemId}
                  trend={trend}
                  onSelectRecord={(point) =>
                    setSelectedRecord({ kind: 'measurement', point, trend })
                  }
                  onShowAll={() =>
                    onShowAll({ itemId: trend.itemId, kind: 'measurement' })
                  }
                />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Динамика появится после первых записей измерений.
            </p>
          )}
        </section>

        <section
          className={cx(
            styles.panel,
            styles.analyticsPanel,
            styles.analyticsWidePanel,
          )}
        >
          <h3>Динамика упражнений</h3>
          {exerciseTrends.length ? (
            <div className={styles.measurementTrendList}>
              {exerciseTrends.map((trend) => (
                <ExerciseTrendRow
                  key={trend.itemId}
                  trend={trend}
                  onSelectRecord={(point) =>
                    setSelectedRecord({ kind: 'exercise', point, trend })
                  }
                  onShowAll={() =>
                    onShowAll({ itemId: trend.itemId, kind: 'exercise' })
                  }
                />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Динамика появится после первых отметок упражнений.
            </p>
          )}
        </section>
      </div>

      {selectedRecord ? (
        <AnalyticsRecordDialog
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
        />
      ) : null}
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function CategoryDistributionRow({
  count,
  label,
  percent,
}: {
  count: number
  label: string
  percent: number
}) {
  return (
    <div className={styles.categoryDistributionRow}>
      <div className={styles.categoryDistributionHeader}>
        <span>{label}</span>
        <strong>
          {count} · {percent}%
        </strong>
      </div>
      <div className={styles.analyticsBar} aria-hidden="true">
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
    </div>
  )
}

function MeasurementTrendRow({
  onSelectRecord,
  onShowAll,
  trend,
}: {
  onSelectRecord: (point: MeasurementTrendPoint) => void
  onShowAll: () => void
  trend: MeasurementTrend
}) {
  const latest = trend.points[trend.points.length - 1]
  const previous = trend.points[trend.points.length - 2]
  const delta =
    latest && previous
      ? Number((latest.value - previous.value).toFixed(2))
      : null
  const recentPoints = trend.points.slice(-4)

  return (
    <article className={styles.measurementTrendItem}>
      <div className={styles.measurementTrendHeader}>
        <div>
          <strong>{trend.title}</strong>
          <span>{trend.valueLabel}</span>
        </div>
        <div className={styles.measurementTrendActions}>
          {latest ? (
            <strong className={styles.measurementTrendValue}>
              {formatMeasurementValue(latest.value, trend.unit)}
            </strong>
          ) : null}
          <button
            className={styles.analyticsShowAllButton}
            type="button"
            onClick={onShowAll}
          >
            Показать все
          </button>
        </div>
      </div>

      {delta !== null ? (
        <p className={styles.measurementTrendDelta}>
          {formatMeasurementDelta(delta, trend.unit)} с прошлого измерения
        </p>
      ) : null}

      <div className={styles.measurementTrendPoints}>
        {recentPoints.map((point) => (
          <button
            key={`${trend.itemId}-${point.completionId}`}
            className={styles.measurementTrendPointButton}
            type="button"
            onClick={() => onSelectRecord(point)}
          >
            <small>{formatShortDate(point.date)}</small>
            <strong>{formatMeasurementValue(point.value, trend.unit)}</strong>
          </button>
        ))}
      </div>
    </article>
  )
}

function ExerciseTrendRow({
  onSelectRecord,
  onShowAll,
  trend,
}: {
  onSelectRecord: (point: ExerciseTrendPoint) => void
  onShowAll: () => void
  trend: ExerciseTrend
}) {
  const latest = trend.points[trend.points.length - 1]
  const previous = trend.points[trend.points.length - 2]
  const delta =
    latest && previous
      ? Number((latest.value - previous.value).toFixed(2))
      : null
  const recentPoints = trend.points.slice(-4)

  return (
    <article className={styles.measurementTrendItem}>
      <div className={styles.measurementTrendHeader}>
        <div>
          <strong>{trend.title}</strong>
          <span>{getExerciseMetricLabel(trend.metricType)}</span>
        </div>
        <div className={styles.measurementTrendActions}>
          {latest ? (
            <strong className={styles.measurementTrendValue}>
              {formatExerciseValue(latest.value, trend.unit)}
            </strong>
          ) : null}
          <button
            className={styles.analyticsShowAllButton}
            type="button"
            onClick={onShowAll}
          >
            Показать все
          </button>
        </div>
      </div>

      {delta !== null ? (
        <p className={styles.measurementTrendDelta}>
          {formatExerciseDelta(delta, trend.unit)} с прошлого выполнения
        </p>
      ) : null}

      <div className={styles.measurementTrendPoints}>
        {recentPoints.map((point) => (
          <button
            key={`${trend.itemId}-${point.completionId}`}
            className={styles.measurementTrendPointButton}
            type="button"
            onClick={() => onSelectRecord(point)}
          >
            <small>{formatShortDate(point.date)}</small>
            <strong>{formatExerciseValue(point.value, trend.unit)}</strong>
          </button>
        ))}
      </div>
    </article>
  )
}

function AnalyticsDetailView({
  detail,
  onBack,
  onSelectRecord,
  selection,
}: {
  detail: AnalyticsDetail | null
  onBack: () => void
  onSelectRecord: (record: AnalyticsRecord) => void
  selection: SelfCareAnalyticsDetailSelection
}) {
  const points = detail ? [...detail.trend.points].reverse() : []
  const title = detail?.trend.title ?? 'Аналитика'
  const subtitle =
    detail?.kind === 'exercise'
      ? getExerciseMetricLabel(detail.trend.metricType)
      : detail?.trend.valueLabel

  return (
    <section className={cx(styles.panel, styles.analyticsDetailPanel)}>
      <div className={styles.analyticsDetailHeader}>
        <button className={styles.softButton} type="button" onClick={onBack}>
          Назад
        </button>
        <div>
          <h3>{title}</h3>
          <p>
            {subtitle
              ? `${subtitle} · ${points.length} записей`
              : `${points.length} записей`}
          </p>
        </div>
      </div>

      {detail && points.length ? (
        <div className={styles.analyticsRecordList}>
          {detail.kind === 'exercise'
            ? (points as ExerciseTrendPoint[]).map((point) => (
                <AnalyticsRecordListButton
                  key={`${selection.kind}-${point.completionId}`}
                  record={{ kind: 'exercise', point, trend: detail.trend }}
                  onSelectRecord={onSelectRecord}
                />
              ))
            : (points as MeasurementTrendPoint[]).map((point) => (
                <AnalyticsRecordListButton
                  key={`${selection.kind}-${point.completionId}`}
                  record={{ kind: 'measurement', point, trend: detail.trend }}
                  onSelectRecord={onSelectRecord}
                />
              ))}
        </div>
      ) : (
        <p className={styles.mutedText}>
          Записи для выбранной аналитики не найдены.
        </p>
      )}
    </section>
  )
}

function AnalyticsRecordListButton({
  onSelectRecord,
  record,
}: {
  onSelectRecord: (record: AnalyticsRecord) => void
  record: AnalyticsRecord
}) {
  const { point } = record
  const value =
    record.kind === 'exercise'
      ? formatExerciseValue(point.value, record.trend.unit)
      : formatMeasurementValue(point.value, record.trend.unit)
  const note = point.note.trim()

  return (
    <button
      className={styles.analyticsRecordListItem}
      type="button"
      onClick={() => onSelectRecord(record)}
    >
      <span>
        <strong>{formatDate(point.date)}</strong>
        <small>{formatTime(point.completedAt)}</small>
      </span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </button>
  )
}

function AnalyticsRecordDialog({
  onClose,
  record,
}: {
  onClose: () => void
  record: AnalyticsRecord
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const point = record.point
  const note = point.note.trim()
  const value =
    record.kind === 'exercise'
      ? formatExerciseValue(point.value, record.trend.unit)
      : formatMeasurementValue(point.value, record.trend.unit)
  const valueLabel =
    record.kind === 'exercise'
      ? getExerciseMetricLabel(record.trend.metricType)
      : record.trend.valueLabel
  const rows = getAnalyticsRecordRows(record)

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-analytics-record-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть детали записи"
        onClick={onClose}
      />

      <section className={cx(styles.modalPanel, styles.analyticsRecordDialog)}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-analytics-record-title">Детали записи</h2>
            <p>
              {record.trend.title} · {formatDate(point.date)}
            </p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть детали записи"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <div className={styles.analyticsRecordSummary}>
          <div className={styles.analyticsRecordValue}>
            <span>{valueLabel}</span>
            <strong>{value}</strong>
          </div>

          {record.kind === 'exercise' && record.point.sets.length ? (
            <div className={styles.analyticsRecordBlock}>
              <strong>Подходы</strong>
              <div className={styles.analyticsRecordSetList}>
                {record.point.sets.map((set) => (
                  <div key={set.index}>
                    <span>Подход {set.index}</span>
                    <strong>
                      {formatExerciseValue(set.value, record.trend.unit)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {rows.length ? (
            <div className={styles.analyticsRecordDetails}>
              {rows.map(([label, rowValue]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{rowValue}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {note ? (
            <div className={styles.analyticsRecordBlock}>
              <strong>Комментарий</strong>
              <p>{note}</p>
            </div>
          ) : null}
        </div>

        <div className={styles.modalActions}>
          <button className={styles.softButton} type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function getAnalyticsDetail(
  analytics: SelfCareAnalyticsData | undefined,
  selection: SelfCareAnalyticsDetailSelection,
): AnalyticsDetail | null {
  if (selection.kind === 'exercise') {
    const trend = analytics?.exerciseTrends.find(
      (candidate) => candidate.itemId === selection.itemId,
    )

    return trend ? { kind: 'exercise', trend } : null
  }

  const trend = analytics?.measurementTrends.find(
    (candidate) => candidate.itemId === selection.itemId,
  )

  return trend ? { kind: 'measurement', trend } : null
}

function getAnalyticsRecordRows(
  record: AnalyticsRecord,
): Array<[string, string]> {
  const point = record.point
  const rows: Array<[string, string]> = [
    ['Время', formatTime(point.completedAt)],
    ['Статус', STATUS_LABELS[point.status]],
  ]

  if (point.completedVariant) {
    rows.push(['Вариант', COMPLETION_VARIANT_LABELS[point.completedVariant]])
  }

  if (point.scheduledFor) {
    rows.push(['Плановая дата', formatDate(point.scheduledFor)])
  }

  if (point.durationMinutes !== null) {
    rows.push(['Длительность', `${point.durationMinutes} мин`])
  }

  const mood = formatBeforeAfterRating(point.moodBefore, point.moodAfter)
  if (mood) {
    rows.push(['Настроение', mood])
  }

  const energy = formatBeforeAfterRating(point.energyBefore, point.energyAfter)
  if (energy) {
    rows.push(['Энергия', energy])
  }

  if (point.alternativeTitle) {
    rows.push(['Альтернатива', point.alternativeTitle])
  }

  return rows
}

function formatBeforeAfterRating(
  before: number | null,
  after: number | null,
): string | null {
  if (before === null && after === null) {
    return null
  }

  if (before !== null && after !== null) {
    return `${before}/5 -> ${after}/5`
  }

  return `${before ?? after}/5`
}
