import {
  newTaskInputSchema,
  shoppingProductUrlSchema,
} from '@planner/contracts'

import type { IncomingShare } from '../native-incoming-shares'

export function parseSharedContent(share: IncomingShare) {
  const text = share.text.trim()
  const subject = share.subject.trim()
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const candidates = text.match(/https?:\/\/[^\s<>"]+/giu) ?? []
  const parsed = shoppingProductUrlSchema.safeParse(
    candidates.length === 1 ? candidates[0] : null,
  )
  const url = parsed.success ? parsed.data : null
  // Browsers can supply a bare URL, "title\nURL", or a subject and inline URL.
  // Preserve ordinary chat prose (including any inline links) as a task.
  const linkShare =
    url !== null &&
    (lines.includes(url) || (subject !== '' && text.endsWith(url)))
  const pageTitle =
    subject && subject !== url
      ? subject
      : lines.filter((line) => line !== url).join(' ')
  const title = linkShare
    ? pageTitle || new URL(url).hostname
    : lines[0] || subject
  const titleLimit = linkShare ? 5000 : 240
  return {
    initialKind: linkShare ? ('purchase' as const) : ('task' as const),
    initialTitle: title.slice(0, titleLimit).replace(/[\uD800-\uDBFF]$/u, ''),
    originalText: text,
    url,
  }
}

export function sharedTaskInput(
  share: IncomingShare,
  title: string,
  dueDate: string | null,
) {
  const text = share.text.trim()
  return newTaskInputSchema.parse({
    id: share.requestId,
    title,
    note: text === title ? '' : text,
    project: '',
    plannedDate: null,
    dueDate,
  })
}
