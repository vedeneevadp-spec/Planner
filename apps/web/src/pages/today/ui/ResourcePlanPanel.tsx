import { useState } from 'react'

import { getTaskResource, type Task } from '@/entities/task'
import { TaskResourceMeter } from '@/entities/task/ui'
import { cx } from '@/shared/lib/classnames'

import {
  analyzeDailyLoad,
  ENERGY_MODE_CONFIGS,
  type EnergyMode,
  getLoadStateLabel,
  getUnloadCandidates,
} from '../lib/resource-plan'
import styles from './ResourcePlanPanel.module.css'

interface ResourcePlanPanelProps {
  energyMode: EnergyMode
  isTaskDataComplete?: boolean
  isTaskPending?: ((taskId: string) => boolean) | undefined
  tasks: Task[]
  onEnergyModeChange: (mode: EnergyMode) => void
  onMoveTaskTomorrow: (taskId: string) => void
}

const energyModes: EnergyMode[] = ['minimum', 'normal', 'maximum']

export function ResourcePlanPanel({
  energyMode,
  isTaskDataComplete = true,
  isTaskPending,
  tasks,
  onEnergyModeChange,
  onMoveTaskTomorrow,
}: ResourcePlanPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const analysis = analyzeDailyLoad(tasks, energyMode, isTaskDataComplete)
  const activeConfig = ENERGY_MODE_CONFIGS[energyMode]
  const unloadCandidates =
    analysis.assessedState === 'calm' ? [] : getUnloadCandidates(tasks, 3)
  const meterWidth = Math.min(analysis.overloadScore, 100)
  const isEmpty = isTaskDataComplete && analysis.totalTaskCount === 0
  const hasKnownLoad = analysis.assessedTaskCount > 0 || isEmpty
  const explanation = !isTaskDataComplete
    ? 'Список задач может быть неполным или устаревшим. Итоговую нагрузку пока нельзя оценить.'
    : isEmpty
      ? 'Задач для расчёта пока нет.'
      : analysis.assessedTaskCount === 0
        ? 'Нагрузка пока неизвестна. Ресурс можно указать при редактировании задачи; это необязательно.'
        : !analysis.isComplete
          ? `Без оценки: ${analysis.unassessedTaskCount}. Показана нагрузка только по оценённым задачам.`
          : analysis.state === 'calm'
            ? 'План задач укладывается в выбранный лимит.'
            : null

  return (
    <section
      className={cx(styles.panel, !isExpanded && styles.panelCollapsed)}
      aria-labelledby="resource-plan-title"
    >
      <div className={styles.header}>
        <div>
          <p id="resource-plan-title" className={styles.eyebrow}>
            Антиперегруз
          </p>
        </div>
        {!isExpanded ? (
          <span
            className={styles.selectedMode}
            aria-label={`Установленный режим: ${activeConfig.label}`}
          >
            {activeConfig.label}
          </span>
        ) : null}
        <div className={styles.headerControls}>
          <span className={cx(styles.stateBadge, styles[analysis.state])}>
            {isEmpty ? 'нет задач' : getLoadStateLabel(analysis.state)}
          </span>
          <button
            className={cx(
              styles.collapseToggle,
              isExpanded && styles.collapseToggleActive,
            )}
            type="button"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded ? 'Свернуть антиперегруз' : 'Открыть антиперегруз'
            }
            onClick={() => setIsExpanded((value) => !value)}
          >
            <span
              className={cx(
                styles.collapseChevron,
                isExpanded && styles.collapseChevronExpanded,
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      <p className={styles.coverage}>
        Оценено {analysis.assessedTaskCount} из {analysis.totalTaskCount}
        {!isTaskDataComplete ? ' · по загруженным задачам' : null}
      </p>
      {isExpanded ? (
        <h3 className={styles.title}>Сколько у тебя ресурса сегодня?</h3>
      ) : null}
      {isExpanded ? (
        <>
          <div className={styles.modeGrid}>
            {energyModes.map((mode) => {
              const config = ENERGY_MODE_CONFIGS[mode]
              const isActive = mode === energyMode

              return (
                <button
                  key={mode}
                  className={cx(
                    styles.modeButton,
                    isActive && styles.modeButtonActive,
                  )}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onEnergyModeChange(mode)}
                >
                  <strong>{config.label}</strong>
                  <span>{config.description}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.loadCard}>
            <div className={styles.loadHeader}>
              <div>
                <span>
                  {analysis.isComplete ? 'Нагрузка задач' : 'Оценённая часть'}
                </span>
                <strong>
                  {hasKnownLoad ? analysis.totalResource : '—'} из{' '}
                  {analysis.resourceLimit} ресурса
                </strong>
              </div>
              <div>
                <span>Режим</span>
                <strong>{activeConfig.label}</strong>
              </div>
            </div>

            {hasKnownLoad ? (
              <div className={styles.meterTrack} aria-hidden="true">
                <span
                  className={cx(
                    styles.meterFill,
                    styles[analysis.assessedState],
                  )}
                  style={{ width: `${meterWidth}%` }}
                />
              </div>
            ) : null}
          </div>

          <p className={styles.scope}>
            В расчёте задачи с планом на сегодня и выполненные сегодня.
            Отдельные разделы заботы, уборки и покупок в расчёт не входят.
          </p>
          {explanation ? (
            <p className={styles.helperText}>{explanation}</p>
          ) : null}

          {unloadCandidates.length > 0 ? (
            <div className={styles.unloadBox}>
              <div>
                <h4>
                  {analysis.isComplete
                    ? analysis.assessedState === 'overload'
                      ? 'Нагрузка задач выше лимита'
                      : 'Нагрузка задач близка к лимиту'
                    : analysis.assessedState === 'overload'
                      ? 'Оценённая часть выше лимита'
                      : 'Оценённая часть близка к лимиту'}
                </h4>
                <p>Можно мягко снять лишнее, не удаляя задачу.</p>
              </div>
              <div className={styles.unloadList}>
                {unloadCandidates.map((task) => (
                  <div key={task.id} className={styles.unloadItem}>
                    <span className={styles.unloadTask}>
                      <span className={styles.unloadTaskTitle}>
                        {task.title}
                      </span>
                      <TaskResourceMeter
                        className={styles.unloadTaskResource}
                        value={getTaskResource(task)}
                      />
                    </span>
                    <button
                      type="button"
                      disabled={isTaskPending?.(task.id)}
                      onClick={() => onMoveTaskTomorrow(task.id)}
                    >
                      На завтра
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
