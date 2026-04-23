import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlannerApiClient } from '@/features/planner'
import { formatShortDate, getDateKey } from '@/shared/lib/date'
import { IconMark } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  getCurrentWeekRange,
  getSphereHealthLabel,
} from '../lib/sphere-stats'
import styles from './SpheresPage.module.css'

function buildHeadline(stats: Array<{ title: string; weeklyShare: number; health: string }>): string {
  const dominantSphere = stats.find((stat) => stat.weeklyShare >= 50)
  const abandonedCount = stats.filter((stat) => stat.health === 'abandoned').length

  if (dominantSphere) {
    return `На этой неделе перекос в «${dominantSphere.title}»`
  }

  if (abandonedCount > 0) {
    return `${abandonedCount} ${abandonedCount === 1 ? 'сфера просит внимания' : 'сферы просят внимания'}`
  }

  return 'Баланс недели выглядит ровно'
}

function getLastActivityLabel(lastActivityAt: string | null): string {
  if (!lastActivityAt) {
    return 'активности еще не было'
  }

  const todayKey = getDateKey(new Date())
  const days = Math.max(
    0,
    Math.floor(
      (new Date(`${todayKey}T12:00:00`).getTime() -
        new Date(`${lastActivityAt}T12:00:00`).getTime()) /
        86_400_000,
    ),
  )

  return days === 0 ? 'активность сегодня' : `${days} дн. без активности`
}

export function SpheresPage() {
  const api = usePlannerApiClient()
  const queryClient = useQueryClient()
  const { uploadedIcons } = useUploadedIconAssets()
  const week = getCurrentWeekRange(new Date())
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2f6f62')
  const [icon, setIcon] = useState('heart')
  const statsQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) =>
      api!.getLifeSphereWeeklyStats(week.from, week.to, signal),
    queryKey: ['life-spheres', 'weekly-stats', week.from, week.to],
  })
  const spheresQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) => api!.listLifeSpheres(signal),
    queryKey: ['life-spheres'],
  })
  const spheres = useMemo(
    () => statsQuery.data?.spheres ?? spheresQuery.data ?? [],
    [spheresQuery.data, statsQuery.data?.spheres],
  )
  const stats = useMemo(() => {
    const sphereById = new Map(spheres.map((sphere) => [sphere.id, sphere]))

    return (statsQuery.data?.stats ?? []).map((stat) => ({
      ...stat,
      title: sphereById.get(stat.sphereId)?.name ?? 'Без сферы',
      color: sphereById.get(stat.sphereId)?.color ?? '#6f766d',
      icon: sphereById.get(stat.sphereId)?.icon ?? 'folder',
    }))
  }, [spheres, statsQuery.data?.stats])
  const abandonedStats = stats.filter((stat) => stat.health === 'abandoned')
  const createMutation = useMutation({
    mutationFn: () =>
      api!.createLifeSphere({
        color,
        icon,
        name,
      }),
    onSuccess: () => {
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['life-spheres'] })
    },
  })
  const updateMutation = useMutation({
    mutationFn: (variables: { id: string; isActive: boolean }) =>
      api!.updateLifeSphere(variables.id, { isActive: variables.isActive }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['life-spheres'] })
    },
  })
  const removeMutation = useMutation({
    mutationFn: (id: string) => api!.removeLifeSphere(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['life-spheres'] })
    },
  })

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!name.trim()) {
      return
    }

    createMutation.mutate()
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Life spheres"
        title="Сферы жизни"
        description="Отдельный уровень над задачами: видно, где неделя перекосилась и какие сферы заброшены."
      />

      <section className={styles.balancePanel}>
        <div className={styles.balanceHeader}>
          <div>
            <p className={styles.eyebrow}>Баланс недели</p>
            <h3>{stats.length > 0 ? buildHeadline(stats) : 'Сферы пока не заданы'}</h3>
            <p>
              {formatShortDate(week.from)} - {formatShortDate(week.to)} · ресурс считается по задачам недели.
            </p>
          </div>
          <Link className={styles.secondaryButton} to="/inbox">
            Добавить действие
          </Link>
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
                      width: `${Math.max(stat.weeklyShare, stat.totalResource > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.emptyCopy}>Создай первую сферу или дождись автосоздания базовых сфер.</p>
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
              <Link key={stat.sphereId} className={styles.forgottenChip} to="/inbox">
                {stat.title} · {getLastActivityLabel(stat.lastActivityAt)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <form className={styles.balancePanel} onSubmit={(event) => handleCreate(event)}>
        <div className={styles.balanceHeader}>
          <div>
            <p className={styles.eyebrow}>Новая сфера</p>
            <h3>Добавить свою область жизни</h3>
          </div>
        </div>
        <div className={styles.formGrid}>
          <input
            value={name}
            placeholder="Например: учеба"
            onChange={(event) => setName(event.target.value)}
          />
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          <input value={icon} placeholder="icon" onChange={(event) => setIcon(event.target.value)} />
          <button className={styles.primaryButton} type="submit" disabled={!name.trim()}>
            Добавить сферу
          </button>
        </div>
      </form>

      <div className={pageStyles.autoGrid}>
        {spheres.map((sphere) => {
          const stat = stats.find((candidate) => candidate.sphereId === sphere.id)

          return (
            <article key={sphere.id} className={styles.sphereCard}>
              <div className={styles.cardHeader}>
                <span
                  className={styles.sphereIcon}
                  style={{ backgroundColor: sphere.color ?? '#6f766d' }}
                >
                  <IconMark value={sphere.icon ?? ''} uploadedIcons={uploadedIcons} />
                </span>
                <span className={styles.healthBadge} data-health={stat?.health ?? 'abandoned'}>
                  {getSphereHealthLabel(stat?.health ?? 'abandoned')}
                </span>
              </div>

              <div>
                <p className={styles.eyebrow}>{sphere.isDefault ? 'Default sphere' : 'Sphere'}</p>
                <h3>{sphere.name}</h3>
                <p className={styles.cardCopy}>{getLastActivityLabel(stat?.lastActivityAt ?? null)}</p>
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

              <div className={styles.cardActions}>
                <Link className={styles.primaryButton} to="/inbox">
                  Добавить действие
                </Link>
                {sphere.id !== '__unsphered__' ? (
                  <>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() =>
                        updateMutation.mutate({
                          id: sphere.id,
                          isActive: !sphere.isActive,
                        })
                      }
                    >
                      {sphere.isActive ? 'Отключить' : 'Включить'}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => removeMutation.mutate(sphere.id)}
                    >
                      Удалить
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
