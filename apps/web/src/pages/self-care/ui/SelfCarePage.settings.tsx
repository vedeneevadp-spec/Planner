import type { SelfCareTemplate } from '@planner/contracts'
import { useState } from 'react'

import type { useSelfCareSettings } from '@/features/self-care'

import {
  CATEGORY_LABELS,
  getTemplateTypeLabel,
  normalizeOptionalText,
  type SelfCareSettingsPatch,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'
import { SelfCareSection } from './SelfCarePage.sections'

export function SelfCareSettingsTab({
  disabledTemplateIds,
  isBusy,
  onCreateFromTemplate,
  onUpdateSettings,
  settings,
  templates,
}: {
  disabledTemplateIds: ReadonlySet<string>
  isBusy: boolean
  onCreateFromTemplate: (templateId: string) => void
  onUpdateSettings: (input: SelfCareSettingsPatch) => Promise<void>
  settings: ReturnType<typeof useSelfCareSettings>['data'] | undefined
  templates: SelfCareTemplate[]
}) {
  const currentSettings = settings?.settings

  return (
    <div className={styles.tabPanel}>
      <section className={styles.panel}>
        <h3>Настройки раздела</h3>
        {currentSettings ? (
          <SelfCareSettingsForm
            key={currentSettings.id}
            isBusy={isBusy}
            settings={currentSettings}
            onUpdateSettings={onUpdateSettings}
          />
        ) : (
          <p className={styles.mutedText}>
            Настройки загружаются. Форма станет доступна после ответа API.
          </p>
        )}
      </section>

      <TemplatesPicker
        templates={templates}
        isBusy={isBusy}
        disabledTemplateIds={disabledTemplateIds}
        onCreateFromTemplate={onCreateFromTemplate}
      />
    </div>
  )
}

function SelfCareSettingsForm({
  isBusy,
  onUpdateSettings,
  settings,
}: {
  isBusy: boolean
  onUpdateSettings: (input: SelfCareSettingsPatch) => Promise<void>
  settings: NonNullable<
    ReturnType<typeof useSelfCareSettings>['data']
  >['settings']
}) {
  const [currency, setCurrency] = useState(settings.currency ?? '')
  const [showSelfCareInMainTasks, setShowSelfCareInMainTasks] = useState(
    settings.showSelfCareInMainTasks,
  )
  const [showAppointmentsInCalendar, setShowAppointmentsInCalendar] = useState(
    settings.showAppointmentsInCalendar,
  )
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')

  return (
    <form
      className={styles.settingsForm}
      onSubmit={(event) => {
        event.preventDefault()
        setSaveStatus('idle')
        void onUpdateSettings({
          currency: normalizeOptionalText(currency),
          showAppointmentsInCalendar,
          showSelfCareInMainTasks,
        })
          .then(() => {
            setSaveStatus('saved')
          })
          .catch(() => undefined)
      }}
    >
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Валюта процедур</span>
          <input
            type="text"
            autoComplete="off"
            maxLength={8}
            placeholder="RUB"
            value={currency}
            disabled={isBusy}
            onChange={(event) => {
              setSaveStatus('idle')
              setCurrency(event.target.value)
            }}
          />
        </label>
      </div>
      <label className={styles.toggleField}>
        <input
          type="checkbox"
          checked={showSelfCareInMainTasks}
          disabled={isBusy}
          onChange={(event) => {
            setSaveStatus('idle')
            setShowSelfCareInMainTasks(event.target.checked)
          }}
        />
        <span>Показывать заботу в общем списке задач</span>
      </label>
      <label className={styles.toggleField}>
        <input
          type="checkbox"
          checked={showAppointmentsInCalendar}
          disabled={isBusy}
          onChange={(event) => {
            setSaveStatus('idle')
            setShowAppointmentsInCalendar(event.target.checked)
          }}
        />
        <span>Показывать записи в календаре</span>
      </label>

      <div className={styles.modalActions}>
        <span className={styles.settingsSaveStatus} role="status">
          {saveStatus === 'saved' ? 'Сохранено' : ''}
        </span>
        <button className={styles.doneButton} type="submit" disabled={isBusy}>
          Сохранить настройки
        </button>
      </div>
    </form>
  )
}

function TemplatesPicker({
  disabledTemplateIds,
  isBusy,
  onCreateFromTemplate,
  templates,
}: {
  disabledTemplateIds: ReadonlySet<string>
  isBusy: boolean
  onCreateFromTemplate: (templateId: string) => void
  templates: SelfCareTemplate[]
}) {
  if (!templates.length) {
    return null
  }

  return (
    <SelfCareSection title="Шаблоны">
      <div className={styles.templateGrid}>
        {templates.slice(0, 12).map((template) => {
          const isTemplateDisabled = disabledTemplateIds.has(template.id)

          return (
            <button
              key={template.id}
              className={styles.templateCard}
              type="button"
              disabled={isBusy || isTemplateDisabled}
              onClick={() => onCreateFromTemplate(template.id)}
            >
              <strong>{template.title}</strong>
              <span>
                {CATEGORY_LABELS[template.category]} ·{' '}
                {getTemplateTypeLabel(template)}
                {isTemplateDisabled ? ' · уже добавлено' : ''}
              </span>
              <p>
                {template.description || 'Можно добавить и настроить под себя.'}
              </p>
            </button>
          )
        })}
      </div>
    </SelfCareSection>
  )
}
