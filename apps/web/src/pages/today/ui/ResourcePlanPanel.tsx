import { useState } from 'react'

import { getTaskResource, type Task, TaskResourceMeter } from '@/entities/task'
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
  isTaskPending?: ((taskId: string) => boolean) | undefined
  tasks: Task[]
  onEnergyModeChange: (mode: EnergyMode) => void
  onMoveTaskTomorrow: (taskId: string) => void
}

const energyModes: EnergyMode[] = ['minimum', 'normal', 'maximum']

export function ResourcePlanPanel({
  energyMode,
  isTaskPending,
  tasks,
  onEnergyModeChange,
  onMoveTaskTomorrow,
}: ResourcePlanPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const analysis = analyzeDailyLoad(tasks, energyMode)
  const activeConfig = ENERGY_MODE_CONFIGS[energyMode]
  const unloadCandidates =
    analysis.state === 'calm' ? [] : getUnloadCandidates(tasks, 3)
  const meterWidth = Math.min(analysis.overloadScore, 100)

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
        <div className={styles.headerControls}>
          <span className={cx(styles.stateBadge, styles[analysis.state])}>
            {getLoadStateLabel(analysis.state)}
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
                <span>Лимит дня</span>
                <strong>
                  {analysis.totalResource}/{analysis.resourceLimit} ресурса
                </strong>
              </div>
              <div>
                <span>Режим</span>
                <strong>{activeConfig.label}</strong>
              </div>
            </div>

            <div className={styles.meterTrack} aria-hidden="true">
              <span
                className={cx(styles.meterFill, styles[analysis.state])}
                style={{ width: `${meterWidth}%` }}
              />
            </div>
          </div>

          {unloadCandidates.length > 0 ? (
            <div className={styles.unloadBox}>
              <div>
                <h4>Похоже, день перегружен</h4>
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
          ) : (
            <p className={styles.helperText}>
              План выглядит реалистично. Если добавишь тяжелую задачу, индикатор
              покажет перегруз до того, как день сорвется.
            </p>
          )}
        </>
      ) : null}
    </section>
  )
}
