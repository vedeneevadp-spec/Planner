import type { useSelfCareAnalytics } from '@/features/self-care'
import { cx } from '@/shared/lib/classnames'

import {
  buildVisibleCategoryDistribution,
  formatMeasurementDelta,
  formatMeasurementValue,
  formatMoney,
  formatMonthKey,
  formatShortDate,
  getPercent,
  VISIBLE_CATEGORY_LABELS,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'

type SelfCareAnalyticsData = NonNullable<
  ReturnType<typeof useSelfCareAnalytics>['data']
>

export function SelfCareAnalyticsTab({
  analytics,
  defaultCurrency,
}: {
  analytics: ReturnType<typeof useSelfCareAnalytics>['data'] | undefined
  defaultCurrency: string
}) {
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
                <MeasurementTrendRow key={trend.itemId} trend={trend} />
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>
              Динамика появится после первых записей измерений.
            </p>
          )}
        </section>
      </div>
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
  trend,
}: {
  trend: SelfCareAnalyticsData['measurementTrends'][number]
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
        {latest ? (
          <strong className={styles.measurementTrendValue}>
            {formatMeasurementValue(latest.value, trend.unit)}
          </strong>
        ) : null}
      </div>

      {delta !== null ? (
        <p className={styles.measurementTrendDelta}>
          {formatMeasurementDelta(delta, trend.unit)} с прошлого измерения
        </p>
      ) : null}

      <div className={styles.measurementTrendPoints}>
        {recentPoints.map((point) => (
          <span key={`${trend.itemId}-${point.completedAt}`}>
            <small>{formatShortDate(point.date)}</small>
            <strong>{formatMeasurementValue(point.value, trend.unit)}</strong>
          </span>
        ))}
      </div>
    </article>
  )
}
