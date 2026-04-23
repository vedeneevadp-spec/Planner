import type {
  ChaosInboxItemRecord,
  ChaosInboxStatus,
  LifeSphereRecord,
} from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { usePlanner, usePlannerApiClient } from '@/features/planner'
import { addDays, formatShortDate, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { ChaosDumpPanel } from './ChaosDumpPanel'
import styles from './InboxPage.module.css'

const filters: Array<{ label: string; value: ChaosInboxStatus | 'all' }> = [
  { label: 'Все', value: 'all' },
  { label: 'Новые', value: 'new' },
  { label: 'Без разбора', value: 'in_review' },
  { label: 'Уже превращенные', value: 'converted' },
  { label: 'Архив', value: 'archived' },
]

export function InboxPage() {
  const api = usePlannerApiClient()
  const planner = usePlanner()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<ChaosInboxStatus | 'all'>(
    'all',
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkSphereId, setBulkSphereId] = useState('')
  const [isQuickReview, setIsQuickReview] = useState(false)
  const todayKey = getDateKey(new Date())
  const weekKey = getDateKey(addDays(new Date(), 7))
  const chaosQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) =>
      api!.listChaosInboxItems(
        statusFilter === 'all' ? {} : { status: statusFilter },
        signal,
      ),
    queryKey: ['chaos-inbox', statusFilter],
  })
  const spheresQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) => api!.listLifeSpheres(signal),
    queryKey: ['life-spheres'],
  })
  const items = useMemo(() => chaosQuery.data?.items ?? [], [chaosQuery.data])
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  )
  const activeReviewItem = items.find((item) => item.status !== 'converted') ?? null

  function invalidateInbox() {
    void queryClient.invalidateQueries({ queryKey: ['chaos-inbox'] })
    void queryClient.invalidateQueries({ queryKey: ['planner', 'tasks'] })
  }

  const updateMutation = useMutation({
    mutationFn: (variables: {
      id: string
      input: Parameters<NonNullable<typeof api>['updateChaosInboxItem']>[1]
    }) => api!.updateChaosInboxItem(variables.id, variables.input),
    onSuccess: invalidateInbox,
  })
  const convertMutation = useMutation({
    mutationFn: (id: string) => api!.convertChaosInboxItemToTask(id),
    onSuccess: invalidateInbox,
  })
  const bulkUpdateMutation = useMutation({
    mutationFn: (input: Parameters<NonNullable<typeof api>['bulkUpdateChaosInboxItems']>[0]) =>
      api!.bulkUpdateChaosInboxItems(input),
    onSuccess: () => {
      setSelectedIds(new Set())
      invalidateInbox()
    },
  })
  const bulkConvertMutation = useMutation({
    mutationFn: (ids: string[]) => api!.bulkConvertChaosInboxItemsToTasks(ids),
    onSuccess: () => {
      setSelectedIds(new Set())
      invalidateInbox()
    },
  })
  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api!.bulkDeleteChaosInboxItems(ids),
    onSuccess: () => {
      setSelectedIds(new Set())
      invalidateInbox()
    },
  })

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      return next
    })
  }

  function updateItem(
    id: string,
    input: Parameters<NonNullable<typeof api>['updateChaosInboxItem']>[1],
  ) {
    updateMutation.mutate({ id, input })
  }

  function convertItem(id: string) {
    convertMutation.mutate(id)
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Capture"
        title="Сброс хаоса"
        description="Быстро выгрузи мысли без структуры. Потом преврати входящие в задачи, даты и сферы."
      />

      <ChaosDumpPanel onSaved={invalidateInbox} />

      <div className={styles.toolbar}>
        <div className={styles.filterGroup}>
          {filters.map((filter) => (
            <button
              key={filter.value}
              className={
                statusFilter === filter.value
                  ? `${styles.filterButton} ${styles.filterButtonActive}`
                  : styles.filterButton
              }
              type="button"
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => setIsQuickReview((value) => !value)}
        >
          {isQuickReview ? 'Список' : 'Быстрый разбор'}
        </button>
      </div>

      {selectedItems.length > 0 ? (
        <div className={styles.bulkBar}>
          <strong>Выбрано: {selectedItems.length}</strong>
          <div className={styles.bulkActions}>
            <select
              value={bulkSphereId}
              onChange={(event) => setBulkSphereId(event.target.value)}
            >
              <option value="">Сфера</option>
              {(spheresQuery.data ?? []).map((sphere) => (
                <option key={sphere.id} value={sphere.id}>
                  {sphere.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!bulkSphereId}
              onClick={() =>
                bulkUpdateMutation.mutate({
                  ids: [...selectedIds],
                  patch: { sphereId: bulkSphereId },
                })
              }
            >
              Назначить сферу
            </button>
            <button
              type="button"
              onClick={() => bulkConvertMutation.mutate([...selectedIds])}
            >
              В задачи
            </button>
            <button
              type="button"
              onClick={() =>
                bulkUpdateMutation.mutate({
                  ids: [...selectedIds],
                  patch: { status: 'archived' },
                })
              }
            >
              Архив
            </button>
            <button
              className={styles.dangerButton}
              type="button"
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
            >
              Удалить
            </button>
          </div>
        </div>
      ) : null}

      {isQuickReview && activeReviewItem ? (
        <QuickReviewCard
          item={activeReviewItem}
          spheres={spheresQuery.data ?? []}
          todayKey={todayKey}
          weekKey={weekKey}
          onConvert={convertItem}
          onUpdate={updateItem}
        />
      ) : null}

      <div className={styles.list}>
        {items.length === 0 ? (
          <div className={styles.emptyPanel}>
            Хаос-входящие пусты. Сырые мысли появятся здесь после сброса.
          </div>
        ) : null}

        {items.map((item) => (
          <ChaosInboxCard
            key={item.id}
            item={item}
            spheres={spheresQuery.data ?? []}
            isSelected={selectedIds.has(item.id)}
            onConvert={convertItem}
            onSelect={toggleSelected}
            onUpdate={updateItem}
          />
        ))}
      </div>

      {planner.errorMessage ? (
        <p className={styles.emptyPanel}>{planner.errorMessage}</p>
      ) : null}
    </section>
  )
}

interface ChaosInboxCardProps {
  item: ChaosInboxItemRecord
  spheres: LifeSphereRecord[]
  isSelected: boolean
  onConvert: (id: string) => void
  onSelect: (id: string) => void
  onUpdate: (
    id: string,
    input: Parameters<NonNullable<ReturnType<typeof usePlannerApiClient>>['updateChaosInboxItem']>[1],
  ) => void
}

function ChaosInboxCard({
  item,
  spheres,
  isSelected,
  onConvert,
  onSelect,
  onUpdate,
}: ChaosInboxCardProps) {
  const sphere = spheres.find((candidate) => candidate.id === item.sphereId)

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <label>
          <input
            aria-label={`Выбрать элемент ${item.text}`}
            className={styles.checkbox}
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(item.id)}
          />
        </label>
        <span className={styles.statusBadge}>{item.status}</span>
      </div>
      <p className={styles.cardTitle}>{item.text}</p>
      <div className={styles.cardMeta}>
        <span>{formatShortDate(item.createdAt.slice(0, 10))}</span>
        <span>{item.kind}</span>
        <span>{sphere?.name ?? 'Без сферы'}</span>
        {item.dueDate ? <span>Дата: {formatShortDate(item.dueDate)}</span> : null}
        {item.linkedTaskDeleted ? <span>Связанная задача удалена</span> : null}
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={item.status === 'converted'}
          onClick={() => onConvert(item.id)}
        >
          В задачу
        </button>
        <button
          type="button"
          onClick={() => onUpdate(item.id, { kind: 'note', status: 'archived' })}
        >
          Не требует действий
        </button>
        <select
          value={item.sphereId ?? ''}
          onChange={(event) =>
            onUpdate(item.id, { sphereId: event.target.value || null })
          }
        >
          <option value="">Сфера</option>
          {spheres.map((sphereItem) => (
            <option key={sphereItem.id} value={sphereItem.id}>
              {sphereItem.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={item.dueDate ?? ''}
          onChange={(event) =>
            onUpdate(item.id, { dueDate: event.target.value || null })
          }
        />
        <button
          type="button"
          onClick={() => onUpdate(item.id, { status: 'archived' })}
        >
          Архив
        </button>
      </div>
    </article>
  )
}

interface QuickReviewCardProps {
  item: ChaosInboxItemRecord
  spheres: LifeSphereRecord[]
  todayKey: string
  weekKey: string
  onConvert: (id: string) => void
  onUpdate: ChaosInboxCardProps['onUpdate']
}

function QuickReviewCard({
  item,
  spheres,
  todayKey,
  weekKey,
  onConvert,
  onUpdate,
}: QuickReviewCardProps) {
  return (
    <article className={styles.quickReviewCard}>
      <strong>Быстрый разбор</strong>
      <p className={styles.cardTitle}>{item.text}</p>
      <div className={styles.quickActions}>
        <button type="button" onClick={() => onUpdate(item.id, { dueDate: todayKey })}>
          сегодня
        </button>
        <button type="button" onClick={() => onUpdate(item.id, { dueDate: weekKey })}>
          на неделе
        </button>
        <button type="button" onClick={() => onUpdate(item.id, { dueDate: null })}>
          без даты
        </button>
        <select
          value={item.sphereId ?? ''}
          onChange={(event) =>
            onUpdate(item.id, { sphereId: event.target.value || null })
          }
        >
          <option value="">сфера</option>
          {spheres.map((sphere) => (
            <option key={sphere.id} value={sphere.id}>
              {sphere.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onConvert(item.id)}>
          в задачу
        </button>
        <button type="button" onClick={() => onUpdate(item.id, { status: 'archived' })}>
          архив
        </button>
        <button
          type="button"
          onClick={() => onUpdate(item.id, { kind: 'note', status: 'archived' })}
        >
          это не задача
        </button>
      </div>
    </article>
  )
}
