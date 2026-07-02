import type { SelfCareTemplate, SelfCareTodayItem } from '@planner/contracts'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { cx } from '@/shared/lib/classnames'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import {
  SelfCareCustomCreateForm,
  SelfCareEditForm,
} from './SelfCarePage.components'
import {
  ADD_CARE_TEMPLATE_FILTERS,
  type AddCareTemplateFilter,
  CATEGORY_LABELS,
  getAddCareFilterCategories,
  getAddCareFilterLabel,
  getTemplateTypeLabel,
  type SelfCareCreateDialogMode,
  type SelfCareCustomCreatePayload,
  type SelfCareEditSubmitPayload,
} from './SelfCarePage.helpers'
import { isSelfCareIconPickerOpen } from './SelfCarePage.icon-picker-state'
import styles from './SelfCarePage.module.css'

const ADD_CARE_TEMPLATE_TILE_CLASS_NAMES: Record<
  AddCareTemplateFilter,
  string | undefined
> = {
  beauty: styles.addCareCategoryBeauty,
  health: styles.addCareCategoryHealth,
  movement: styles.addCareCategoryMovement,
  rest: styles.addCareCategoryRest,
}

export function SelfCareCreateDialog({
  defaultCurrency,
  disabledTemplateIds,
  errorMessage,
  isBusy,
  mode,
  onBack,
  onClose,
  onCreateCustom,
  onCreateFromTemplate,
  onSelectCustom,
  onSelectTemplate,
  templates,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  disabledTemplateIds: ReadonlySet<string>
  errorMessage: string | null
  isBusy: boolean
  mode: SelfCareCreateDialogMode
  onBack: () => void
  onClose: () => void
  onCreateCustom: (payload: SelfCareCustomCreatePayload) => void
  onCreateFromTemplate: (templateId: string) => void
  onSelectCustom: () => void
  onSelectTemplate: () => void
  templates: SelfCareTemplate[]
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const [templateFilter, setTemplateFilter] =
    useState<AddCareTemplateFilter | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const heading =
    mode === 'template'
      ? templateFilter
        ? `Шаблоны: ${getAddCareFilterLabel(templateFilter)}`
        : 'Выбрать из шаблона'
      : mode === 'custom'
        ? 'Создать свою заботу'
        : 'Добавить заботу'
  const filteredTemplates = templateFilter
    ? templates.filter((template) =>
        getAddCareFilterCategories(templateFilter).includes(template.category),
      )
    : templates

  function openTemplatePicker(filter: AddCareTemplateFilter | null): void {
    setTemplateFilter(filter)
    onSelectTemplate()
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-care-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть добавление заботы"
        onClick={onClose}
      />

      <section
        className={cx(
          styles.modalPanel,
          mode === 'choice' && styles.addCareChoicePanel,
        )}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="add-care-title">{heading}</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть добавление заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {mode !== 'choice' ? (
          <button
            className={styles.backLinkButton}
            type="button"
            disabled={isBusy}
            onClick={onBack}
          >
            <ChevronLeftIcon size={17} strokeWidth={2.2} />
            Назад к выбору
          </button>
        ) : null}

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        {mode === 'choice' ? (
          <div className={styles.addCareChoiceContent}>
            <div className={styles.createChoiceGrid}>
              <button
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareCreateCard,
                )}
                type="button"
                disabled={isBusy}
                onClick={onSelectCustom}
              >
                <strong>Создать свою</strong>
                <span className={styles.addCareChoiceText}>
                  Для ухода, процедуры, медицинского напоминания или регулярной
                  заботы.
                </span>
              </button>
              <section
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareTemplateCard,
                )}
                aria-labelledby="add-care-template-title"
              >
                <button
                  className={styles.addCareTemplateMainButton}
                  type="button"
                  disabled={isBusy}
                  onClick={() => openTemplatePicker(null)}
                >
                  <span className={styles.addCareTemplateCopy}>
                    <strong id="add-care-template-title">
                      Выбрать из шаблона
                    </strong>
                    <span className={styles.addCareChoiceText}>
                      Готовые идеи для ухода, здоровья и восстановления.
                    </span>
                  </span>
                  <span
                    className={styles.addCareArrowButton}
                    aria-hidden="true"
                  >
                    <ChevronRightIcon size={18} strokeWidth={2.15} />
                  </span>
                </button>
                <div
                  className={styles.addCareCategoryGrid}
                  aria-label="Категории шаблонов"
                >
                  {ADD_CARE_TEMPLATE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      className={cx(
                        styles.addCareCategoryButton,
                        ADD_CARE_TEMPLATE_TILE_CLASS_NAMES[filter.value],
                      )}
                      type="button"
                      disabled={isBusy}
                      onClick={() => openTemplatePicker(filter.value)}
                    >
                      <span>{filter.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {mode === 'custom' ? (
          <SelfCareCustomCreateForm
            defaultCurrency={defaultCurrency}
            isBusy={isBusy}
            todayKey={todayKey}
            uploadedIcons={uploadedIcons}
            onCreate={onCreateCustom}
          />
        ) : null}

        {mode === 'template' ? (
          filteredTemplates.length ? (
            <div className={styles.templateGrid}>
              {filteredTemplates.slice(0, 12).map((template) => {
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
                      {template.description ||
                        'Можно добавить и настроить под себя.'}
                    </p>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className={styles.mutedText}>Шаблоны загружаются.</p>
          )
        ) : null}
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareEditDialog({
  defaultCurrency,
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (payload: SelfCareEditSubmitPayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-edit-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть настройки заботы"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-edit-title">Настроить заботу</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть настройки заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        <SelfCareEditForm
          defaultCurrency={defaultCurrency}
          entry={entry}
          isBusy={isBusy}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </section>
    </div>,
    document.body,
  )
}
