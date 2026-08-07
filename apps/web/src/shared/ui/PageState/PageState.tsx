import type { ReactNode } from 'react'

import { cx } from '@/shared/lib/classnames'

import styles from './PageState.module.css'

export type PageStateKind =
  'loading' | 'error' | 'offline' | 'empty' | 'unavailable'

export type PageStateBannerKind = 'error' | 'info' | 'offline'

export type PageStateSkeletonVariant =
  'cards' | 'list' | 'calendar' | 'settings' | 'detail'

export type PageStateTimestamp = string | number | Date | null

export type PageStateAction =
  | {
      disabled?: boolean | undefined
      href?: never
      label: string
      onClick: () => void
    }
  | {
      disabled?: never
      href: string
      label: string
      onClick?: never
    }

export interface PageStateViewProps {
  action?: PageStateAction | undefined
  description?: string | undefined
  headingLevel?: 1 | 2 | 3 | undefined
  kind: PageStateKind
  lastSyncedAt?: PageStateTimestamp | undefined
  showUnknownLastSync?: boolean | undefined
  skeletonVariant?: PageStateSkeletonVariant | undefined
  title?: string | undefined
}

export interface PageStatusBannerProps {
  action?: PageStateAction | undefined
  description?: string | undefined
  kind: PageStateBannerKind
  lastSyncedAt?: PageStateTimestamp | undefined
  showUnknownLastSync?: boolean | undefined
  title?: string | undefined
}

interface StateCopy {
  description?: string
  title: string
}

const pageStateCopy: Record<PageStateKind, StateCopy> = {
  loading: {
    title: 'Загружаем данные',
  },
  error: {
    title: 'Не удалось загрузить данные',
    description: 'Попробуйте ещё раз.',
  },
  offline: {
    title: 'Нет подключения',
    description: 'Проверьте подключение и попробуйте ещё раз.',
  },
  empty: {
    title: 'Здесь пока ничего нет',
  },
  unavailable: {
    title: 'Сейчас недоступно',
  },
}

const bannerStateCopy: Record<PageStateBannerKind, StateCopy> = {
  error: {
    title: 'Не удалось обновить данные',
    description: 'Сохранённые данные остаются доступны.',
  },
  offline: {
    title: 'Нет подключения',
    description: 'Показываем последние сохранённые данные.',
  },
  info: {
    title: 'Данные доступны для просмотра',
    description: 'Восстанавливаем возможность обновлять данные.',
  },
}

const lastSyncFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  month: 'long',
  year: 'numeric',
})

export function PageStateView({
  action,
  description,
  headingLevel = 2,
  kind,
  lastSyncedAt,
  showUnknownLastSync = false,
  skeletonVariant = 'list',
  title,
}: PageStateViewProps) {
  const copy = pageStateCopy[kind]
  const resolvedTitle = title ?? copy.title
  const Heading =
    headingLevel === 1
      ? ('h1' as const)
      : headingLevel === 3
        ? ('h3' as const)
        : ('h2' as const)

  if (kind === 'loading') {
    return (
      <div
        className={cx(styles.pageState, styles.loadingState)}
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <Heading className={styles.visuallyHidden}>{resolvedTitle}</Heading>
        <PageSkeleton variant={skeletonVariant} />
      </div>
    )
  }

  const resolvedDescription = description ?? copy.description
  const lastSync = resolveLastSync(lastSyncedAt)

  return (
    <div
      className={cx(styles.pageState, styles[`${kind}State`])}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className={styles.stateContent}>
        <StateMark kind={kind} />
        <div className={styles.stateText}>
          <Heading>{resolvedTitle}</Heading>
          {resolvedDescription ? <p>{resolvedDescription}</p> : null}
          {lastSync ? <LastSync value={lastSync} /> : null}
          {!lastSync && showUnknownLastSync ? <UnknownLastSync /> : null}
        </div>
        {action ? <StateAction action={action} /> : null}
      </div>
    </div>
  )
}

export function PageStatusBanner({
  action,
  description,
  kind,
  lastSyncedAt,
  showUnknownLastSync = false,
  title,
}: PageStatusBannerProps) {
  const copy = bannerStateCopy[kind]
  const lastSync = resolveLastSync(lastSyncedAt)

  return (
    <div
      className={cx(styles.banner, styles[`${kind}Banner`])}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <StateMark kind={kind} />
      <div className={styles.bannerText}>
        <strong>{title ?? copy.title}</strong>
        {(description ?? copy.description) ? (
          <span>{description ?? copy.description}</span>
        ) : null}
        {lastSync ? <LastSync value={lastSync} /> : null}
        {!lastSync && showUnknownLastSync ? <UnknownLastSync /> : null}
      </div>
      {action ? <StateAction action={action} isBanner /> : null}
    </div>
  )
}

function StateAction({
  action,
  isBanner = false,
}: {
  action: PageStateAction
  isBanner?: boolean
}) {
  const className = cx(styles.action, isBanner && styles.bannerAction)

  if (action.href !== undefined) {
    return (
      <a className={className} href={action.href}>
        {action.label}
      </a>
    )
  }

  return (
    <button
      aria-busy={action.disabled || undefined}
      className={className}
      type="button"
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  )
}

function StateMark({
  kind,
}: {
  kind: Exclude<PageStateKind, 'loading'> | 'info'
}) {
  const markByKind: Record<
    Exclude<PageStateKind, 'loading'> | 'info',
    ReactNode
  > = {
    empty: '＋',
    error: '!',
    offline: '↕',
    info: 'i',
    unavailable: 'i',
  }

  return (
    <span className={styles.stateMark} aria-hidden="true">
      {markByKind[kind]}
    </span>
  )
}

function UnknownLastSync() {
  return (
    <span className={styles.lastSync}>
      Время последней синхронизации неизвестно
    </span>
  )
}

function LastSync({ value }: { value: Date }) {
  return (
    <time className={styles.lastSync} dateTime={value.toISOString()}>
      Последняя синхронизация: {lastSyncFormatter.format(value)}
    </time>
  )
}

function resolveLastSync(value: PageStateTimestamp | undefined) {
  if (value === undefined || value === null) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

function PageSkeleton({ variant }: { variant: PageStateSkeletonVariant }) {
  return (
    <div
      className={cx(styles.skeleton, styles[`${variant}Skeleton`])}
      aria-hidden="true"
      data-testid="page-state-skeleton"
    >
      {variant === 'cards' ? <CardsSkeleton /> : null}
      {variant === 'list' ? <ListSkeleton /> : null}
      {variant === 'calendar' ? <CalendarSkeleton /> : null}
      {variant === 'settings' ? <SettingsSkeleton /> : null}
      {variant === 'detail' ? <DetailSkeleton /> : null}
    </div>
  )
}

function CardsSkeleton() {
  return (
    <>
      <SkeletonHeading />
      <div className={styles.skeletonCardGrid}>
        {Array.from({ length: 3 }, (_, index) => (
          <div className={styles.skeletonCard} key={index}>
            <span className={styles.skeletonMark} />
            <span className={styles.skeletonLine} />
            <span
              className={cx(styles.skeletonLine, styles.skeletonLineShort)}
            />
          </div>
        ))}
      </div>
    </>
  )
}

function ListSkeleton() {
  return (
    <>
      <SkeletonHeading />
      <div className={styles.skeletonList}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.skeletonRow} key={index}>
            <span className={styles.skeletonDot} />
            <span className={styles.skeletonRowText}>
              <span className={styles.skeletonLine} />
              <span
                className={cx(styles.skeletonLine, styles.skeletonLineShort)}
              />
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function CalendarSkeleton() {
  return (
    <>
      <SkeletonHeading />
      <div className={styles.skeletonCalendarHeader}>
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className={styles.skeletonCalendarGrid}>
        {Array.from({ length: 14 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </>
  )
}

function SettingsSkeleton() {
  return (
    <>
      <SkeletonHeading />
      <div className={styles.skeletonSettings}>
        {Array.from({ length: 3 }, (_, index) => (
          <div className={styles.skeletonSetting} key={index}>
            <span className={styles.skeletonRowText}>
              <span className={styles.skeletonLine} />
              <span
                className={cx(styles.skeletonLine, styles.skeletonLineShort)}
              />
            </span>
            <span className={styles.skeletonControl} />
          </div>
        ))}
      </div>
    </>
  )
}

function DetailSkeleton() {
  return (
    <>
      <div className={styles.skeletonHero} />
      <SkeletonHeading />
      <div className={styles.skeletonDetailLines}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLine} />
        <span className={cx(styles.skeletonLine, styles.skeletonLineShort)} />
      </div>
    </>
  )
}

function SkeletonHeading() {
  return (
    <div className={styles.skeletonHeading}>
      <span className={styles.skeletonTitle} />
      <span className={cx(styles.skeletonLine, styles.skeletonLineShort)} />
    </div>
  )
}
