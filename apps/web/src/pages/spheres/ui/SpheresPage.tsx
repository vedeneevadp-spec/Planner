import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  buildSphereStats,
  getCurrentWeekRange,
  getSphereHealthLabel,
  type SphereStats,
} from '../lib/sphere-stats'
import { SphereComposer } from './SphereComposer'
import styles from './SpheresPage.module.css'

function buildHeadline(stats: SphereStats[]): string {
  const dominantSphere = stats.find(
    (stat) => !stat.isUnassigned && stat.weeklyShare >= 50,
  )
  const abandonedCount = stats.filter(
    (stat) => !stat.isUnassigned && stat.health === 'abandoned',
  ).length

  if (dominantSphere) {
    return `На этой неделе перекос в «${dominantSphere.title}»`
  }

  if (abandonedCount > 0) {
    return `${abandonedCount} ${
      abandonedCount === 1 ? 'сфера просит внимания' : 'сферы просят внимания'
    }`
  }

  return 'Баланс недели выглядит ровно'
}

function getLastActivityLabel(
  stat: Pick<SphereStats, 'idleDays' | 'lastActivityAt'>,
): string {
  if (!stat.lastActivityAt || stat.idleDays === null) {
    return 'активности еще не было'
  }

  return stat.idleDays === 0
    ? 'активность сегодня'
    : `${stat.idleDays} дн. без активности`
}

export function SpheresPage() {
  const { addSphere, spheres, tasks } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const week = getCurrentWeekRange(new Date())
  const todayKey = getDateKey(new Date())
  const stats = useMemo(
    () => buildSphereStats(spheres, tasks, week, todayKey),
    [spheres, tasks, todayKey, week],
  )
  const statsBySphereId = useMemo(
    () => new Map(stats.map((stat) => [stat.sphereId, stat])),
    [stats],
  )
  const abandonedStats = stats.filter(
    (stat) => !stat.isUnassigned && stat.health === 'abandoned',
  )

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Spheres"
        description="Сферы собирают задачи по областям жизни: видно, где неделя перекосилась и что давно не получало внимания."
      />

      <section className={styles.balancePanel}>
        <div className={styles.balanceHeader}>
          <div className={styles.balanceMeta}>
            <p className={styles.eyebrow}>Баланс недели</p>
          </div>
          <div className={styles.balanceAction}>
            <TaskComposer
              initialPlannedDate={null}
              mobileOpenButtonMode="inline"
              openButtonLabel="Действие"
            />
          </div>
          <div className={styles.balanceSummary}>
            <h3>
              {stats.length > 0 ? buildHeadline(stats) : 'Сферы пока не заданы'}
            </h3>
            <p>
              {formatShortDate(week.from)} - {formatShortDate(week.to)} · доля
              считается по задачам недели.
            </p>
          </div>
        </div>

        {stats.length > 0 ? (
          <div className={styles.balanceBars}>
            {stats.map((stat) => (
              <div key={stat.sphereId} className={styles.balanceRow}>
                <div className={styles.balanceLabel}>
                  <span
                    className={styles.tinyDot}
                    style={{ backgroundColor: stat.color }}
                    aria-hidden="true"
                  />
                  <span>{stat.title}</span>
                  <strong>{stat.weeklyShare}%</strong>
                </div>
                <div className={styles.barTrack} aria-hidden="true">
                  <span
                    className={styles.barFill}
                    style={{
                      backgroundColor: stat.color,
                      width: `${Math.max(
                        stat.weeklyShare,
                        stat.totalResource > 0 ? 4 : 0,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>
            Создай первую сферу, чтобы выбирать ее при добавлении задач.
          </p>
        )}
      </section>

      {abandonedStats.length > 0 ? (
        <section className={styles.forgottenPanel}>
          <div>
            <p className={styles.eyebrow}>Забытые сферы</p>
            <h3>Стоит добавить хотя бы одно маленькое действие</h3>
          </div>
          <div className={styles.forgottenList}>
            {abandonedStats.slice(0, 4).map((stat) => (
              <Link
                key={stat.sphereId}
                className={styles.forgottenChip}
                to={`/spheres/${stat.sphereId}`}
              >
                {stat.title} · {getLastActivityLabel(stat)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <SphereComposer
        uploadedIcons={uploadedIcons}
        onCreate={(values) => addSphere(values)}
      />

      {spheres.length === 0 ? (
        <div className={pageStyles.emptyPanel}>
          <p>Создайте первую сферу, чтобы выбирать ее при добавлении задач.</p>
        </div>
      ) : (
        <div className={pageStyles.autoGrid}>
          {spheres.map((sphere) => {
            const stat = statsBySphereId.get(sphere.id)

            return (
              <Link
                key={sphere.id}
                className={styles.sphereCard}
                to={`/spheres/${sphere.id}`}
              >
                <div className={styles.cardHeader}>
                  <span
                    className={styles.sphereIcon}
                    style={{ backgroundColor: sphere.color }}
                  >
                    <IconMark
                      value={sphere.icon}
                      uploadedIcons={uploadedIcons}
                    />
                  </span>
                  <span
                    className={styles.healthBadge}
                    data-health={stat?.health ?? 'abandoned'}
                  >
                    {getSphereHealthLabel(stat?.health ?? 'abandoned')}
                  </span>
                </div>

                <div>
                  <p className={styles.eyebrow}>Sphere</p>
                  <h3>{sphere.name}</h3>
                  {sphere.description ? (
                    <p className={styles.sphereDescription}>
                      {sphere.description}
                    </p>
                  ) : null}
                  <p className={styles.cardCopy}>
                    {stat
                      ? getLastActivityLabel(stat)
                      : 'активности еще не было'}
                  </p>
                </div>

                <div className={styles.statsGrid}>
                  <div>
                    <span>План</span>
                    <strong>{stat?.plannedCount ?? 0}</strong>
                  </div>
                  <div>
                    <span>Готово</span>
                    <strong>{stat?.completedCount ?? 0}</strong>
                  </div>
                  <div>
                    <span>Просрочено</span>
                    <strong>{stat?.overdueCount ?? 0}</strong>
                  </div>
                  <div>
                    <span>Ресурс</span>
                    <strong>{stat?.totalResource ?? 0}</strong>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
