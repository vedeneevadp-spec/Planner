import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { createPlannerApiClient, usePlanner } from '@/features/planner'
import { useSessionFeatureReadiness } from '@/features/session'
import { useCreateShoppingListItem } from '@/features/shopping-list'

import { parseSharedContent, sharedTaskInput } from './model/share-content'
import type { IncomingShare } from './native-incoming-shares'
import {
  AndroidShareDialog,
  type AndroidShareDraft,
} from './ui/AndroidShareDialog'

export function SharedDraft({
  share,
  onClose,
}: {
  share: IncomingShare
  onClose: (message?: string) => void
}) {
  const { session, apiConfig } = useSessionFeatureReadiness()
  const { addTask } = usePlanner()
  const createPurchase = useCreateShoppingListItem()
  const queryClient = useQueryClient()
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const content = parseSharedContent(share)
  if (!session) return null
  const { workspaceId } = session
  const workspaces = session.workspaces.filter((item) =>
    item.kind === 'shared'
      ? item.role === 'owner' || Boolean(item.groupRole)
      : item.role !== 'guest',
  )

  async function save(draft: AndroidShareDraft) {
    if (saving.current) return
    const target = workspaces.find((item) => item.id === draft.workspaceId)
    if (!target) {
      setError('Выберите доступное пространство.')
      return
    }
    saving.current = true
    setBusy(true)
    setError(null)
    try {
      if (draft.kind === 'purchase') {
        const saved = await createPurchase.mutateAsync({
          id: share.requestId,
          workspaceId: target.id,
          text: draft.title,
          productUrl: content.url,
          shoppingCategory: draft.shoppingCategory,
        })
        const messages = {
          created: 'Покупка добавлена',
          updated: 'Ссылка добавлена к покупке',
          restored: 'Покупка возвращена в список',
          duplicate: 'Уже в списке — ' + saved.text,
        }
        onClose(messages[saved.creationOutcome] + ' · ' + target.name)
        return
      }
      const input = sharedTaskInput(share, draft.title, draft.dueDate)
      if (target.id === workspaceId) {
        if (!(await addTask(input))) throw new Error('Could not save task')
      } else {
        if (!apiConfig) throw new Error('Session unavailable')
        await createPlannerApiClient({
          ...apiConfig,
          workspaceId: target.id,
        }).createTask(input)
        void queryClient.invalidateQueries({
          queryKey: ['planner', 'tasks', target.id],
        })
      }
      onClose('Задача добавлена · ' + target.name)
    } catch {
      setError(
        'Не удалось сохранить запись. Проверьте подключение и доступ к пространству, затем попробуйте ещё раз.',
      )
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <AndroidShareDialog
      {...content}
      initialWorkspaceId={workspaceId}
      workspaces={workspaces}
      busy={busy}
      error={error}
      onCancel={() => {
        if (!saving.current) onClose()
      }}
      onSave={(draft) => {
        void save(draft)
      }}
    />
  )
}
