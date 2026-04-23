import { getTaskResource, type Task } from '@/entities/task'
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
  onAutoBuild: () => void
  onEnergyModeChange: (mode: EnergyMode) => void
  onMoveTaskTomorrow: (taskId: string) => void
}

const energyModes: EnergyMode[] = ['minimum', 'normal', 'maximum']

export function ResourcePlanPanel({
  energyMode,
  isTaskPending,
  tasks,
  onAutoBuild,
  onEnergyModeChange,
  onMoveTaskTomorrow,
}: ResourcePlanPanelProps) {
  const analysis = analyzeDailyLoad(tasks, energyMode)
  const activeConfig = ENERGY_MODE_CONFIGS[energyMode]
  const unloadCandidates =
    analysis.state === 'calm' ? [] : getUnloadCandidates(tasks, 3)
  const meterWidth = Math.min(analysis.overloadScore, 140)

  return (
    <section className={styles.panel} aria-labelledby="resource-plan-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Антиперегруз</p>
          <h3 id="resource-plan-title">Сколько у тебя ресурса сегодня?</h3>
        </div>
        <span className={cx(styles.stateBadge, styles[analysis.state])}>
          {getLoadStateLabel(analysis.state)}
        </span>
      </div>

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
            <span>Фокус</span>
            <strong>до {activeConfig.focusLimit}</strong>
          </div>
          <div>
            <span>Поддержка</span>
            <strong>{activeConfig.supportLimit}</strong>
          </div>
        </div>

        <div className={styles.meterTrack} aria-hidden="true">
          <span
            className={cx(styles.meterFill, styles[analysis.state])}
            style={{ width: `${meterWidth}%` }}
          />
        </div>
        <button className={styles.autoBuildButton} type="button" onClick={onAutoBuild}>
          Собрать мне день
        </button>
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
                <span>
                  {task.title} · {getTaskResource(task)} ресурса
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
    </section>
  )
}
