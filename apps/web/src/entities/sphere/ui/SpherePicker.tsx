import { useState } from 'react'

import { cx } from '@/shared/lib/classnames'
import { IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import type { Sphere } from '../model/sphere.types'
import styles from './SpherePicker.module.css'

interface SpherePickerProps {
  className?: string | undefined
  emptyLabel?: string | undefined
  label?: string | undefined
  spheres: Sphere[]
  uploadedIcons?: UploadedIconAsset[] | undefined
  value: string
  onChange: (sphereId: string) => void
}

export function SpherePicker({
  className,
  emptyLabel = 'Без сферы',
  label = 'Сфера',
  spheres,
  uploadedIcons = [],
  value,
  onChange,
}: SpherePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedSphere = spheres.find((sphere) => sphere.id === value) ?? null

  function selectSphere(sphereId: string) {
    onChange(sphereId)
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
        <SphereOptionContent
          emptyLabel={emptyLabel}
          sphere={selectedSphere}
          uploadedIcons={uploadedIcons}
        />
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.menu} role="listbox" tabIndex={-1}>
          <button
            className={cx(styles.option, !selectedSphere && styles.active)}
            type="button"
            role="option"
            aria-selected={!selectedSphere}
            onClick={() => selectSphere('')}
          >
            <SphereOptionContent
              emptyLabel={emptyLabel}
              sphere={null}
              uploadedIcons={uploadedIcons}
            />
          </button>
          {spheres.map((sphere) => (
            <button
              key={sphere.id}
              className={cx(
                styles.option,
                selectedSphere?.id === sphere.id && styles.active,
              )}
              type="button"
              role="option"
              aria-selected={selectedSphere?.id === sphere.id}
              onClick={() => selectSphere(sphere.id)}
            >
              <SphereOptionContent
                emptyLabel={emptyLabel}
                sphere={sphere}
                uploadedIcons={uploadedIcons}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface SphereOptionContentProps {
  emptyLabel: string
  sphere: Sphere | null
  uploadedIcons: UploadedIconAsset[]
}

function SphereOptionContent({
  emptyLabel,
  sphere,
  uploadedIcons,
}: SphereOptionContentProps) {
  if (!sphere) {
    return (
      <>
        <span className={styles.emptyIcon} aria-hidden="true" />
        <span className={styles.title}>{emptyLabel}</span>
      </>
    )
  }

  return (
    <>
      <span
        className={styles.sphereIcon}
        style={{ backgroundColor: sphere.color }}
        aria-hidden="true"
      >
        <IconMark value={sphere.icon} uploadedIcons={uploadedIcons} />
      </span>
      <span className={styles.title}>{sphere.name}</span>
    </>
  )
}
