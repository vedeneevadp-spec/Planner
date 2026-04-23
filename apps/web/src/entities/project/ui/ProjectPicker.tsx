import { useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import type { Project } from '../model/project.types'
import styles from './ProjectPicker.module.css'

interface ProjectPickerProps {
  className?: string | undefined
  label?: string | undefined
  projects: Project[]
  uploadedIcons?: UploadedIconAsset[] | undefined
  value: string
  onChange: (projectId: string) => void
}

export function ProjectPicker({
  className,
  label = 'Сфера',
  projects,
  uploadedIcons = [],
  value,
  onChange,
}: ProjectPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedProject =
    projects.find((project) => project.id === value) ?? null

  function selectProject(projectId: string) {
    onChange(projectId)
    setIsOpen(false)
  }

  return (
    <div
      className={cx(styles.picker, className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsOpen(false)
        }
      }}
    >
      <span className={styles.label}>{label}</span>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((value) => !value)}
      >
        <ProjectOptionContent
          project={selectedProject}
          uploadedIcons={uploadedIcons}
        />
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.menu} role="listbox" tabIndex={-1}>
          <button
            className={cx(styles.option, !selectedProject && styles.active)}
            type="button"
            role="option"
            aria-selected={!selectedProject}
            onClick={() => selectProject('')}
          >
            <ProjectOptionContent
              project={null}
              uploadedIcons={uploadedIcons}
            />
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              className={cx(
                styles.option,
                selectedProject?.id === project.id && styles.active,
              )}
              type="button"
              role="option"
              aria-selected={selectedProject?.id === project.id}
              onClick={() => selectProject(project.id)}
            >
              <ProjectOptionContent
                project={project}
                uploadedIcons={uploadedIcons}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface ProjectOptionContentProps {
  project: Project | null
  uploadedIcons: UploadedIconAsset[]
}

function ProjectOptionContent({
  project,
  uploadedIcons,
}: ProjectOptionContentProps) {
  if (!project) {
    return (
      <>
        <span className={styles.emptyIcon} aria-hidden="true" />
        <span className={styles.title}>Без сферы</span>
      </>
    )
  }

  return (
    <>
      <span
        className={styles.projectIcon}
        style={{ backgroundColor: project.color }}
        aria-hidden="true"
      >
        <IconMark value={project.icon} uploadedIcons={uploadedIcons} />
      </span>
      <span className={styles.title}>{project.title}</span>
    </>
  )
}
