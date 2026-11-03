import type { PlannerSearchItem, PlannerSearchQuery } from '@planner/contracts'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { isUnauthorizedPlannerApiError } from '@/features/planner'
import {
  usePlannerSession,
  useSessionAuth,
  useSessionFeatureReadiness,
} from '@/features/session'
import { formatShortDate } from '@/shared/lib/date'
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  SearchIcon,
} from '@/shared/ui/Icon'
import { PlannerDialog } from '@/shared/ui/PlannerDialog/PlannerDialog'

import { searchPlanner } from '../lib/search-api'
import styles from './PlannerSearchDialog.module.css'

const labels = {
  all: 'Всё',
  tasks: 'Задачи',
  shopping: 'Покупки',
  care: 'Забота',
  cleaning: 'Уборка',
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (!query || index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

export default function PlannerSearchDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<PlannerSearchQuery['source']>('all')
  const [includeCompleted, setIncludeCompleted] = useState(true)
  const [selected, setSelected] = useState<PlannerSearchItem | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) backButton.current?.focus()
    else searchInput.current?.focus()
  }, [selected])
  const { data: session } = usePlannerSession()
  const { apiConfig } = useSessionFeatureReadiness()
  const { sessionVersion } = useSessionAuth()
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft.trim()), 250)
    return () => clearTimeout(timer)
  }, [draft])
  const results = useInfiniteQuery({
    queryKey: [
      'planner-search',
      session?.workspaceId,
      sessionVersion,
      query,
      source,
      includeCompleted,
    ],
    enabled: Boolean(query && apiConfig),
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) => {
      if (!apiConfig) throw new Error('Planner API is unavailable')
      return searchPlanner(
        apiConfig,
        { query, source, includeCompleted, page: pageParam, limit: 20 },
        signal,
      )
    },
    getNextPageParam: (page) => (page.hasMore ? page.page + 1 : undefined),
    retry: (count, error) => !isUnauthorizedPlannerApiError(error) && count < 1,
    staleTime: 0,
  })
  const items = [
    ...new Map(
      (results.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        `${item.source}:${item.id}`,
        item,
      ]),
    ).values(),
  ]
  const unavailable = [
    ...new Set(
      results.data?.pages.flatMap((page) => page.unavailableSources) ?? [],
    ),
  ]
  const isUnavailable = !apiConfig || results.isPaused
  const waiting =
    draft.trim() !== query ||
    (Boolean(query) && !isUnavailable && results.isPending)
  return (
    <PlannerDialog
      title={selected?.title ?? 'Поиск по Планнеру'}
      subtitle={session?.workspace.name ?? 'Планнер'}
      onClose={onClose}
      initialFocus="input[type=search]"
    >
      {selected ? (
        <>
          <p className={styles.context}>
            {labels[selected.source]}
            {selected.context ? ` · ${selected.context}` : ''}
            {selected.date
              ? ` · ${formatShortDate(selected.date.slice(0, 10))}`
              : ''}
          </p>
          <p className={styles.description}>
            {selected.description || 'Без заметки'}
          </p>
          {selected.status !== 'active' ? (
            <p className={styles.context}>
              {selected.status === 'done' ? 'Выполнено' : 'В архиве'}
            </p>
          ) : null}
          <button
            ref={backButton}
            type="button"
            className={styles.secondary}
            onClick={() => setSelected(null)}
          >
            ← К результатам
          </button>
        </>
      ) : (
        <>
          <div className={styles.searchField}>
            <SearchIcon size={18} />
            <input
              ref={searchInput}
              type="search"
              aria-label="Поиск по названию и заметке"
              placeholder="Например, договор"
              maxLength={200}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {draft ? (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => setDraft('')}
              >
                <CloseIcon size={17} />
              </button>
            ) : null}
          </div>
          <label className={styles.completed}>
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(event) => setIncludeCompleted(event.target.checked)}
            />
            Включать выполненные
          </label>
          <div
            className={styles.filters}
            role="group"
            aria-label="Раздел поиска"
          >
            {Object.entries(labels)
              .filter(
                ([key]) =>
                  key !== 'care' || session?.workspace.kind !== 'shared',
              )
              .map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={source === key}
                  onClick={() => setSource(key as PlannerSearchQuery['source'])}
                >
                  {label}
                </button>
              ))}
          </div>
          <div className={styles.summary} role="status" aria-live="polite">
            {!draft.trim()
              ? 'Поиск по названиям и заметкам в этом пространстве'
              : isUnavailable
                ? 'Поиск временно недоступен'
                : waiting
                  ? 'Ищем…'
                  : results.isError
                    ? 'Не удалось обновить поиск'
                    : unavailable.length
                      ? 'Часть разделов недоступна'
                      : results.hasNextPage
                        ? `Показано: ${items.length}`
                        : `Найдено: ${items.length}`}
          </div>
          {query && isUnavailable ? (
            <p className={styles.empty}>
              Ждём подключения к Планнеру. Поиск продолжится, когда связь
              восстановится.
            </p>
          ) : null}
          {!isUnavailable && (results.isError || unavailable.length > 0) ? (
            <div className={styles.error}>
              {unavailable.length ? (
                <span>
                  Не обновились:{' '}
                  {unavailable.map((value) => labels[value]).join(', ')}.
                </span>
              ) : (
                <span>Проверь подключение и повтори поиск.</span>
              )}
              <button
                type="button"
                disabled={results.isFetching}
                onClick={() => {
                  void results.refetch()
                }}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {!waiting && !isUnavailable && query && draft.trim() ? (
            <div className={styles.results}>
              {items.map((item) => (
                <button
                  type="button"
                  className={styles.result}
                  key={`${item.source}:${item.id}`}
                  onClick={() => setSelected(item)}
                >
                  <span className={styles.resultCopy}>
                    <strong>
                      <Highlight text={item.title} query={query} />
                    </strong>
                    {item.description ? (
                      <span className={styles.snippet}>
                        <Highlight text={item.description} query={query} />
                      </span>
                    ) : null}
                    <small>
                      {labels[item.source]}
                      {item.context ? ` · ${item.context}` : ''}
                      {item.date
                        ? ` · ${formatShortDate(item.date.slice(0, 10))}`
                        : ''}
                    </small>
                    {item.status !== 'active' ? (
                      <small className={styles.status}>
                        <CheckIcon size={13} />
                        {item.status === 'done' ? 'Выполнено' : 'В архиве'}
                      </small>
                    ) : null}
                  </span>
                  <ChevronRightIcon size={17} />
                </button>
              ))}
              {!items.length && !results.isError && !unavailable.length ? (
                <p className={styles.empty}>
                  Ничего не найдено. Попробуй другое слово или выбери «Всё».
                </p>
              ) : null}
              {results.hasNextPage ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={results.isFetchingNextPage}
                  onClick={() => {
                    void results.fetchNextPage()
                  }}
                >
                  {results.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </PlannerDialog>
  )
}
