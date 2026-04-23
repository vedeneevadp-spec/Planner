import type { ChaosInboxItemRecord, LifeSphereRecord } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { usePlanner, usePlannerApiClient } from '@/features/planner'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { addDays, formatShortDate, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import { ChaosDumpPanel } from './ChaosDumpPanel'
import styles from './InboxPage.module.css'

interface InboxTaskDraft extends TaskComposerDraft {
  inboxItemId: string
}

export function InboxPage() {
  const api = usePlannerApiClient()
  const planner = usePlanner()
  const queryClient = useQueryClient()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkSphereId, setBulkSphereId] = useState('')
  const [isQuickReview, setIsQuickReview] = useState(false)
  const [taskDraft, setTaskDraft] = useState<InboxTaskDraft | null>(null)
  const todayKey = getDateKey(new Date())
  const weekKey = getDateKey(addDays(new Date(), 7))
  const chaosQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) => api!.listChaosInboxItems({}, signal),
    queryKey: ['chaos-inbox'],
  })
  const spheresQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) => api!.listLifeSpheres(signal),
    queryKey: ['life-spheres'],
  })
  const items = useMemo(
    () =>
      (chaosQuery.data?.items ?? []).filter(
        (item) => item.status !== 'archived' && item.status !== 'converted',
      ),
    [chaosQuery.data],
  )
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  )
  const activeReviewItem = items[0] ?? null

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
  const bulkUpdateMutation = useMutation({
    mutationFn: (
      input: Parameters<
        NonNullable<typeof api>['bulkUpdateChaosInboxItems']
      >[0],
    ) => api!.bulkUpdateChaosInboxItems(input),
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
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api!.removeChaosInboxItem(id),
    onSuccess: (_data, id) => {
      setSelectedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
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

  function openTaskComposer(item: ChaosInboxItemRecord) {
    setTaskDraft({
      dueDate: item.dueDate,
      inboxItemId: item.id,
      plannedDate: null,
      projectId: item.sphereId,
      requestId: `${item.id}:${Date.now()}`,
      resource:
        item.priority === 'high' ? '-3' : item.priority === 'low' ? '-1' : '',
      taskType: item.priority === 'high' ? 'important' : '',
      title: item.text,
    })
  }

  async function handleTaskCreatedFromInbox() {
    if (!taskDraft) {
      return
    }

    await deleteMutation.mutateAsync(taskDraft.inboxItemId)
    setTaskDraft(null)
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
          onDelete={(id) => deleteMutation.mutate(id)}
          onOpenTask={openTaskComposer}
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
            onDelete={(id) => deleteMutation.mutate(id)}
            onOpenTask={openTaskComposer}
            onSelect={toggleSelected}
            onUpdate={updateItem}
          />
        ))}
      </div>

      <TaskComposer
        hideOpenButton
        initialPlannedDate={null}
        openDraft={taskDraft}
        onTaskCreated={handleTaskCreatedFromInbox}
      />

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
  onDelete: (id: string) => void
  onOpenTask: (item: ChaosInboxItemRecord) => void
  onSelect: (id: string) => void
  onUpdate: (
    id: string,
    input: Parameters<
      NonNullable<
        ReturnType<typeof usePlannerApiClient>
      >['updateChaosInboxItem']
    >[1],
  ) => void
}

function ChaosInboxCard({
  item,
  spheres,
  isSelected,
  onDelete,
  onOpenTask,
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
      </div>
      <p className={styles.cardTitle}>{item.text}</p>
      <div className={styles.cardMeta}>
        <span>{formatShortDate(item.createdAt.slice(0, 10))}</span>
        <span>{item.kind}</span>
        <span>{sphere?.name ?? 'Без сферы'}</span>
        {item.dueDate ? (
          <span>Дата: {formatShortDate(item.dueDate)}</span>
        ) : null}
        {item.linkedTaskDeleted ? <span>Связанная задача удалена</span> : null}
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.primaryButton}
          type="button"
          onClick={() => onOpenTask(item)}
        >
          В задачу
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
          className={styles.dangerButton}
          type="button"
          onClick={() => onDelete(item.id)}
        >
          Удалить
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
  onDelete: (id: string) => void
  onOpenTask: (item: ChaosInboxItemRecord) => void
  onUpdate: ChaosInboxCardProps['onUpdate']
}

function QuickReviewCard({
  item,
  spheres,
  todayKey,
  weekKey,
  onDelete,
  onOpenTask,
  onUpdate,
}: QuickReviewCardProps) {
  return (
    <article className={styles.quickReviewCard}>
      <strong>Быстрый разбор</strong>
      <p className={styles.cardTitle}>{item.text}</p>
      <div className={styles.quickActions}>
        <button
          type="button"
          onClick={() => onUpdate(item.id, { dueDate: todayKey })}
        >
          сегодня
        </button>
        <button
          type="button"
          onClick={() => onUpdate(item.id, { dueDate: weekKey })}
        >
          на неделе
        </button>
        <button
          type="button"
          onClick={() => onUpdate(item.id, { dueDate: null })}
        >
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
        <button type="button" onClick={() => onOpenTask(item)}>
          в задачу
        </button>
        <button
          className={styles.dangerButton}
          type="button"
          onClick={() => onDelete(item.id)}
        >
          удалить
        </button>
      </div>
    </article>
  )
}
