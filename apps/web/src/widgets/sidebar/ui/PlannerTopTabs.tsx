import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

import {
  CLEANING_FOCUS_QUERY_KEY,
  type CleaningFocusMode,
  getCleaningFocusModeAriaLabel,
  getCleaningFocusModeFromSearchParams,
} from '@/features/cleaning'
import {
  setSelectedWorkspaceIdForActors,
  usePlannerSession,
  useSessionAuth,
} from '@/features/session'
import {
  getShoppingFiltersFromSearchParams,
  hasActiveShoppingFilters,
  SHOPPING_FILTER_QUERY_KEYS,
  type ShoppingCategory,
} from '@/features/shopping-list'
import { cx } from '@/shared/lib/classnames'
import {
  GearIcon,
  LightningIcon,
  MenuIcon,
  PlusIcon,
  SpheresIcon,
} from '@/shared/ui/Icon'
import { SelectPicker } from '@/shared/ui/SelectPicker'

import styles from './PlannerTabs.module.css'

type CalendarTopViewMode = 'day' | 'week' | 'month' | 'schedule'
type TodayTaskView = 'cards' | 'list'

const CALENDAR_VIEW_SEARCH_PARAM = 'calendarView'
const SELF_CARE_ACTION_REQUEST_SEARCH_PARAM = 'selfCareActionRequest'
const SELF_CARE_ACTION_SEARCH_PARAM = 'selfCareAction'
const SHOPPING_ICON_BASE_URL = '/icons/shopping'
const SPHERES_ACTION_REQUEST_SEARCH_PARAM = 'spheresActionRequest'
const SPHERES_ACTION_SEARCH_PARAM = 'spheresAction'
const TASK_CREATE_SEARCH_PARAM = 'createTask'
const TASK_VIEW_SEARCH_PARAM = 'taskView'
const CALENDAR_VIEW_TABS: Array<{
  label: string
  mode: CalendarTopViewMode
}> = [
  { label: 'День', mode: 'day' },
  { label: 'Неделя', mode: 'week' },
  { label: 'Месяц', mode: 'month' },
  { label: 'Расписание', mode: 'schedule' },
]
const CLEANING_FOCUS_TABS: Array<{
  label: string
  mode: CleaningFocusMode
}> = [
  { label: 'Всё', mode: 'all' },
  { label: 'Низкий', mode: 'low' },
  { label: 'Обычный', mode: 'normal' },
  { label: 'Важные', mode: 'high' },
]
const SHOPPING_CATEGORY_FILTERS: Array<{
  iconSrc: string
  label: string
  value: ShoppingCategory
}> = [
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/groceries.webp`,
    label: 'Продукты',
    value: 'groceries',
  },
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/household.png`,
    label: 'Бытовое',
    value: 'household',
  },
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/other.png`,
    label: 'Прочее',
    value: 'other',
  },
]
const SHOPPING_FLAG_FILTERS: Array<{
  iconSrc: string
  label: string
  param:
    | typeof SHOPPING_FILTER_QUERY_KEYS.favorite
    | typeof SHOPPING_FILTER_QUERY_KEYS.urgent
}> = [
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/favorite.png`,
    label: 'Избранное',
    param: SHOPPING_FILTER_QUERY_KEYS.favorite,
  },
  {
    iconSrc: `${SHOPPING_ICON_BASE_URL}/urgent.webp`,
    label: 'Срочное',
    param: SHOPPING_FILTER_QUERY_KEYS.urgent,
  },
]

export function PlannerTopTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const auth = useSessionAuth()
  const { data: session } = usePlannerSession()
  const [searchParams] = useSearchParams()
  const isHomeActive = matchesRoute(location.pathname, '/today')
  const isCalendarActive = matchesRoute(location.pathname, '/calendar')
  const isCleaningActive = location.pathname === '/cleaning'
  const isCleaningSettingsActive = matchesRoute(
    location.pathname,
    '/cleaning/settings',
  )
  const isSelfCareActive = location.pathname === '/self-care'
  const isShoppingActive = matchesRoute(location.pathname, '/shopping')
  const isSpheresActive = location.pathname === '/spheres'
  const shouldHideMobileBrandText =
    isCalendarActive ||
    isCleaningActive ||
    isCleaningSettingsActive ||
    isSelfCareActive ||
    isShoppingActive
  const calendarViewMode = getCalendarViewMode(searchParams) ?? 'week'
  const cleaningFocusMode = getCleaningFocusModeFromSearchParams(searchParams)
  const shoppingFilters = getShoppingFiltersFromSearchParams(searchParams)
  const hasShoppingFilters = hasActiveShoppingFilters(shoppingFilters)
  const taskView = getTodayTaskView(searchParams)
  const nextTaskView: TodayTaskView = taskView === 'cards' ? 'list' : 'cards'
  const taskViewToggleLabel =
    taskView === 'cards'
      ? 'Показать задачи списком'
      : 'Показать задачи плитками'

  function toggleTaskView() {
    const nextParams = new URLSearchParams(searchParams)

    if (nextTaskView === 'list') {
      nextParams.set(TASK_VIEW_SEARCH_PARAM, nextTaskView)
    } else {
      nextParams.delete(TASK_VIEW_SEARCH_PARAM)
    }

    navigateWithSearchParams(nextParams)
  }

  function selectCalendarViewMode(nextViewMode: CalendarTopViewMode) {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(CALENDAR_VIEW_SEARCH_PARAM, nextViewMode)

    navigateWithSearchParams(nextParams)
  }

  function selectCleaningFocusMode(nextMode: CleaningFocusMode) {
    const nextParams = new URLSearchParams(searchParams)

    if (nextMode === 'all') {
      nextParams.delete(CLEANING_FOCUS_QUERY_KEY)
    } else {
      nextParams.set(CLEANING_FOCUS_QUERY_KEY, nextMode)
    }

    navigateWithSearchParams(nextParams)
  }

  function resetShoppingFilters() {
    const nextParams = new URLSearchParams(searchParams)
    deleteShoppingFilterParams(nextParams)

    navigateWithSearchParams(nextParams)
  }

  function toggleShoppingCategory(category: ShoppingCategory) {
    const nextParams = new URLSearchParams(searchParams)
    const nextCategories = shoppingFilters.categories.includes(category)
      ? shoppingFilters.categories.filter((value) => value !== category)
      : [...shoppingFilters.categories, category]

    nextParams.delete(SHOPPING_FILTER_QUERY_KEYS.categories)
    for (const nextCategory of nextCategories) {
      nextParams.append(SHOPPING_FILTER_QUERY_KEYS.categories, nextCategory)
    }

    navigateWithSearchParams(nextParams)
  }

  function toggleShoppingFlag(
    param:
      | typeof SHOPPING_FILTER_QUERY_KEYS.favorite
      | typeof SHOPPING_FILTER_QUERY_KEYS.urgent,
  ) {
    const nextParams = new URLSearchParams(searchParams)

    if (nextParams.get(param) === '1') {
      nextParams.delete(param)
    } else {
      nextParams.set(param, '1')
    }

    navigateWithSearchParams(nextParams)
  }

  function openSphereComposer() {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(SPHERES_ACTION_SEARCH_PARAM, 'sphere')
    nextParams.set(SPHERES_ACTION_REQUEST_SEARCH_PARAM, createActionRequestId())

    navigateWithSearchParams(nextParams)
  }

  function openSelfCareComposer() {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
    nextParams.set(
      SELF_CARE_ACTION_REQUEST_SEARCH_PARAM,
      createActionRequestId(),
    )

    navigateWithSearchParams(nextParams)
  }

  function openTaskComposer() {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(TASK_CREATE_SEARCH_PARAM, createActionRequestId())

    navigateWithSearchParams(nextParams)
  }

  function navigateWithSearchParams(nextParams: URLSearchParams) {
    const nextSearch = nextParams.toString()

    void navigate({
      hash: location.hash,
      pathname: location.pathname,
      search: nextSearch ? `?${nextSearch}` : '',
    })
  }

  return (
    <nav
      aria-label="Верхние действия планера"
      className={cx(
        styles.topTabs,
        shouldHideMobileBrandText && styles.topTabsNoMobileBrand,
      )}
    >
      <Link
        aria-current={isHomeActive ? 'page' : undefined}
        aria-label="Chaotika, перейти на сегодня"
        className={styles.topHomeTab}
        title="Chaotika"
        to="/today"
      >
        <img
          aria-hidden="true"
          className={styles.topLogoImage}
          src="/favicon.png"
          alt=""
        />
      </Link>
      <span className={styles.topBrandText} aria-hidden="true">
        Chaotika
      </span>
      <SelectPicker
        className={styles.topWorkspaceSelect}
        ariaLabel="Workspace"
        value={session?.workspaceId ?? ''}
        disabled={!session}
        placeholder="Workspace"
        options={
          session
            ? session.workspaces.map((workspace) => ({
                label: workspace.name,
                value: workspace.id,
              }))
            : []
        }
        onChange={(nextWorkspaceId) => {
          setSelectedWorkspaceIdForActors(nextWorkspaceId, [
            auth.userId,
            session?.actorUserId,
          ])
        }}
      />

      {isCleaningSettingsActive ? (
        <div
          className={styles.topSegmentList}
          role="group"
          aria-label="Действия настроек уборки"
        >
          <Link className={styles.topSegmentTab} to="/cleaning">
            К уборке
          </Link>
        </div>
      ) : isCleaningActive ? (
        <div
          className={styles.topSegmentList}
          role="group"
          aria-label="Режим уборки"
        >
          <Link
            className={cx(styles.topSegmentTab, styles.topCleaningSettingsTab)}
            to="/cleaning/settings"
          >
            <GearIcon size={15} strokeWidth={2.1} />
            <span>Настройки зон</span>
          </Link>
          {CLEANING_FOCUS_TABS.map((tab) => {
            const isActive = cleaningFocusMode === tab.mode

            return (
              <button
                key={tab.mode}
                className={cx(
                  styles.topSegmentTab,
                  isCleaningPriorityMode(tab.mode) && styles.topPriorityTab,
                  isActive && styles.topSegmentTabActive,
                )}
                type="button"
                aria-label={getCleaningFocusModeAriaLabel(tab.mode)}
                aria-pressed={isActive}
                onClick={() => selectCleaningFocusMode(tab.mode)}
              >
                {isCleaningPriorityMode(tab.mode) ? (
                  <span
                    className={cx(
                      styles.topPriorityIcon,
                      tab.mode === 'low' && styles.topPriorityIconLow,
                      tab.mode === 'normal' && styles.topPriorityIconNormal,
                      tab.mode === 'high' && styles.topPriorityIconHigh,
                    )}
                    aria-hidden="true"
                  >
                    {Array.from({
                      length: getCleaningPriorityIconCount(tab.mode),
                    }).map((_, index) => (
                      <LightningIcon key={index} size={15} strokeWidth={2.1} />
                    ))}
                  </span>
                ) : (
                  tab.label
                )}
              </button>
            )
          })}
        </div>
      ) : isShoppingActive ? (
        <div
          className={styles.topSegmentList}
          role="group"
          aria-label="Фильтр покупок"
        >
          <button
            className={cx(
              styles.topSegmentTab,
              !hasShoppingFilters && styles.topSegmentTabActive,
            )}
            type="button"
            aria-pressed={!hasShoppingFilters}
            onClick={resetShoppingFilters}
          >
            Все
          </button>
          {SHOPPING_CATEGORY_FILTERS.map((filter) => {
            const isActive = shoppingFilters.categories.includes(filter.value)

            return (
              <button
                key={filter.value}
                className={cx(
                  styles.topSegmentTab,
                  styles.topSegmentTabWithIcon,
                  isActive && styles.topSegmentTabActive,
                )}
                type="button"
                aria-pressed={isActive}
                onClick={() => toggleShoppingCategory(filter.value)}
              >
                <img
                  className={styles.topSegmentIcon}
                  src={filter.iconSrc}
                  alt=""
                  aria-hidden="true"
                />
                <span>{filter.label}</span>
              </button>
            )
          })}
          {SHOPPING_FLAG_FILTERS.map((filter) => {
            const isActive = searchParams.get(filter.param) === '1'

            return (
              <button
                key={filter.param}
                className={cx(
                  styles.topSegmentTab,
                  styles.topSegmentIconTab,
                  isActive && styles.topSegmentTabActive,
                )}
                type="button"
                aria-label={filter.label}
                title={filter.label}
                aria-pressed={isActive}
                onClick={() => toggleShoppingFlag(filter.param)}
              >
                <img
                  className={styles.topSegmentIcon}
                  src={filter.iconSrc}
                  alt=""
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>
      ) : isCalendarActive ? (
        <div className={cx(styles.topActionList, styles.topCalendarActionList)}>
          <button
            className={cx(
              styles.topSegmentTab,
              styles.topSpheresActionTab,
              styles.topTodayCreateTab,
            )}
            type="button"
            aria-label="Создать задачу"
            title="Создать задачу"
            onClick={openTaskComposer}
          >
            <PlusIcon size={14} strokeWidth={2.2} />
            <span>Задача</span>
          </button>
          <div
            className={styles.topSegmentList}
            role="tablist"
            aria-label="Вид календаря"
          >
            {CALENDAR_VIEW_TABS.map((tab) => {
              const isActive = calendarViewMode === tab.mode

              return (
                <button
                  key={tab.mode}
                  className={cx(
                    styles.topSegmentTab,
                    isActive && styles.topSegmentTabActive,
                  )}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => selectCalendarViewMode(tab.mode)}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : isSpheresActive ? (
        <div
          className={cx(styles.topSegmentList, styles.topSpheresActionList)}
          role="group"
          aria-label="Действия сфер"
        >
          <button
            className={cx(
              styles.topSegmentTab,
              styles.topSpheresActionTab,
              styles.topTodayCreateTab,
            )}
            type="button"
            aria-label="Создать действие"
            title="Создать действие"
            onClick={openTaskComposer}
          >
            <PlusIcon size={14} strokeWidth={2.2} />
            <span>Действие</span>
          </button>
          <button
            className={cx(
              styles.topSegmentTab,
              styles.topSpheresActionTab,
              styles.topSpheresCreateTab,
            )}
            type="button"
            aria-label="Создать сферу"
            title="Создать сферу"
            onClick={openSphereComposer}
          >
            <PlusIcon size={14} strokeWidth={2.2} />
            <span>Сфера</span>
          </button>
        </div>
      ) : isSelfCareActive ? (
        <div
          className={cx(styles.topSegmentList, styles.topSpheresActionList)}
          role="group"
          aria-label="Действия заботы"
        >
          <button
            className={cx(
              styles.topSegmentTab,
              styles.topSpheresActionTab,
              styles.topHabitCreateTab,
            )}
            type="button"
            aria-label="Создать заботу"
            title="Создать заботу"
            onClick={openSelfCareComposer}
          >
            <PlusIcon size={14} strokeWidth={2.2} />
            <span>Забота</span>
          </button>
        </div>
      ) : isHomeActive ? (
        <div className={styles.topActionList}>
          <button
            className={cx(
              styles.topSegmentTab,
              styles.topSpheresActionTab,
              styles.topTodayCreateTab,
            )}
            type="button"
            aria-label="Создать задачу"
            title="Создать задачу"
            onClick={openTaskComposer}
          >
            <PlusIcon size={14} strokeWidth={2.2} />
            <span>Задача</span>
          </button>
          <button
            className={styles.topIconAction}
            type="button"
            aria-label={taskViewToggleLabel}
            title={taskViewToggleLabel}
            onClick={toggleTaskView}
          >
            {taskView === 'cards' ? (
              <MenuIcon size={17} strokeWidth={2} />
            ) : (
              <SpheresIcon size={17} strokeWidth={2} />
            )}
          </button>
        </div>
      ) : null}
    </nav>
  )
}

function deleteShoppingFilterParams(searchParams: URLSearchParams) {
  searchParams.delete(SHOPPING_FILTER_QUERY_KEYS.categories)
  searchParams.delete(SHOPPING_FILTER_QUERY_KEYS.favorite)
  searchParams.delete(SHOPPING_FILTER_QUERY_KEYS.urgent)
}

function isCleaningPriorityMode(
  mode: CleaningFocusMode,
): mode is 'low' | 'normal' | 'high' {
  return mode === 'low' || mode === 'normal' || mode === 'high'
}

function getCleaningPriorityIconCount(mode: 'low' | 'normal' | 'high') {
  if (mode === 'low') {
    return 1
  }

  if (mode === 'normal') {
    return 2
  }

  return 3
}

function getCalendarViewMode(
  searchParams: URLSearchParams,
): CalendarTopViewMode | null {
  const viewMode = searchParams.get(CALENDAR_VIEW_SEARCH_PARAM)

  if (
    viewMode === 'day' ||
    viewMode === 'week' ||
    viewMode === 'month' ||
    viewMode === 'schedule'
  ) {
    return viewMode
  }

  return null
}

function getTodayTaskView(searchParams: URLSearchParams): TodayTaskView {
  return searchParams.get(TASK_VIEW_SEARCH_PARAM) === 'list' ? 'list' : 'cards'
}

function createActionRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}
