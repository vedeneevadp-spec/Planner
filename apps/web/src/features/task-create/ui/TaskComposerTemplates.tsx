import type { Sphere } from '@/entities/sphere'
import type { TaskTemplate } from '@/entities/task-template'
import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import { getTemplateDisplayProject } from '../model/task-composer-model'
import styles from './TaskComposer.module.css'

interface TaskComposerTemplatesProps {
  isExpanded: boolean
  pendingTemplateId: string | null
  selectedTemplateId: string | null
  spheres: Sphere[]
  templates: TaskTemplate[]
  uploadedIcons: UploadedIconAsset[]
  onApplyTemplate: (template: TaskTemplate) => void
  onCreateFromTemplate: (template: TaskTemplate) => void
  onExpandedChange: (isExpanded: boolean) => void
  onRemoveTemplate: (template: TaskTemplate) => void
}

export function TaskComposerTemplates({
  isExpanded,
  pendingTemplateId,
  selectedTemplateId,
  spheres,
  templates,
  uploadedIcons,
  onApplyTemplate,
  onCreateFromTemplate,
  onExpandedChange,
  onRemoveTemplate,
}: TaskComposerTemplatesProps) {
  if (templates.length === 0) {
    return null
  }

  return (
    <section
      className={cx(
        styles.columnSection,
        styles.templateSection,
        styles.templatePanel,
      )}
    >
      <div className={styles.templatePanelHeader}>
        <p className={styles.eyebrow}>
          Шаблоны
          <span className={styles.templateCount}>{templates.length}</span>
        </p>
        <button
          className={styles.templateToggle}
          type="button"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Свернуть шаблоны' : 'Показать шаблоны'}
          onClick={() => {
            onExpandedChange(!isExpanded)
          }}
        >
          <span
            className={cx(
              styles.templateChevron,
              isExpanded && styles.templateChevronExpanded,
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {isExpanded ? (
        <div className={styles.templateList}>
          {templates.map((template) => (
            <TaskComposerTemplateRow
              key={template.id}
              isSelected={selectedTemplateId === template.id}
              pendingTemplateId={pendingTemplateId}
              spheres={spheres}
              template={template}
              uploadedIcons={uploadedIcons}
              onApplyTemplate={onApplyTemplate}
              onCreateFromTemplate={onCreateFromTemplate}
              onRemoveTemplate={onRemoveTemplate}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function TaskComposerTemplateRow({
  isSelected,
  pendingTemplateId,
  spheres,
  template,
  uploadedIcons,
  onApplyTemplate,
  onCreateFromTemplate,
  onRemoveTemplate,
}: {
  isSelected: boolean
  pendingTemplateId: string | null
  spheres: Sphere[]
  template: TaskTemplate
  uploadedIcons: UploadedIconAsset[]
  onApplyTemplate: (template: TaskTemplate) => void
  onCreateFromTemplate: (template: TaskTemplate) => void
  onRemoveTemplate: (template: TaskTemplate) => void
}) {
  const templateProject = getTemplateDisplayProject(template, spheres)

  return (
    <article
      className={cx(styles.templateRow, isSelected && styles.templateRowActive)}
    >
      <button
        className={styles.templateSelectButton}
        type="button"
        title={`Подставить шаблон «${template.title}»`}
        onClick={() => {
          onApplyTemplate(template)
        }}
      >
        <span className={styles.templateIconSlot}>
          {template.icon ? (
            <IconMark
              className={styles.templateTaskIcon}
              value={template.icon}
              uploadedIcons={uploadedIcons}
            />
          ) : null}
        </span>

        <span className={styles.templateText}>
          <strong>{template.title}</strong>
          {template.note ? <span>{template.note}</span> : null}
        </span>

        <span
          className={cx(
            styles.templateProjectChip,
            !templateProject.hasProject && styles.templateProjectChipMuted,
          )}
        >
          {templateProject.project ? (
            <span
              className={styles.templateProjectIcon}
              style={{
                backgroundColor: templateProject.project.color,
              }}
              aria-hidden="true"
            >
              <IconMark
                value={templateProject.project.icon}
                uploadedIcons={uploadedIcons}
              />
            </span>
          ) : null}
          {templateProject.title}
        </span>
      </button>

      <div className={styles.templateActions}>
        <button
          className={cx(styles.ghostButton, styles.iconButton)}
          type="button"
          disabled={pendingTemplateId !== null}
          aria-label={`Создать задачу из шаблона ${template.title}`}
          title="Создать"
          onClick={() => {
            onCreateFromTemplate(template)
          }}
        >
          <CheckIcon size={17} />
        </button>
        <button
          className={cx(
            styles.ghostButton,
            styles.iconButton,
            styles.dangerButton,
          )}
          type="button"
          aria-label={`Удалить шаблон ${template.title}`}
          title="Удалить"
          onClick={() => {
            onRemoveTemplate(template)
          }}
        >
          <TrashIcon size={17} />
        </button>
      </div>
    </article>
  )
}
