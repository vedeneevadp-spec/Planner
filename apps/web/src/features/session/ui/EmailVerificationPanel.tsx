import { emailVerificationStatusSchema } from '@planner/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { plannerApiConfig } from '@/shared/config/planner-api'
import { createApiRequester } from '@/shared/lib/api-client'

import { SessionApiError } from '../lib/session-api'
import { usePlannerSession } from '../lib/usePlannerSession'
import { useSessionAuth } from '../lib/useSessionAuth'
import styles from './ProfileDialog.module.css'

export function EmailVerificationPanel() {
  const auth = useSessionAuth()
  const session = usePlannerSession().data
  const client = useQueryClient()
  const codeId = useId()
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const key = ['email-verification', session?.actorUserId] as const
  const { request } = createApiRequester(
    {
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      accessToken: auth.accessToken ?? undefined,
    },
    (message, options) => new SessionApiError(message, options),
  )
  const status = useQuery({
    enabled: Boolean(auth.accessToken && session),
    queryKey: key,
    queryFn: ({ signal }) =>
      request({
        path: '/api/v1/email-verification',
        responseSchema: emailVerificationStatusSchema,
        signal,
      }),
    staleTime: 30_000,
  })
  const send = useMutation({
    mutationFn: () =>
      request<void>({
        path: '/api/v1/email-verification/request',
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      setSent(true)
      setCode('')
    },
  })
  const confirm = useMutation({
    mutationFn: () =>
      request({
        path: '/api/v1/email-verification/confirm',
        method: 'POST',
        body: { code },
        responseSchema: emailVerificationStatusSchema,
      }),
    onSuccess: async (next) => {
      client.setQueryData(key, next)
      setCode('')
      await client.invalidateQueries({
        queryKey: ['workspace-invitations', 'received'],
      })
    },
  })
  const busy = send.isPending || confirm.isPending
  const error = confirm.error ?? send.error ?? status.error

  if (!auth.accessToken) return null

  return (
    <section className={styles.fields} aria-label="Подтверждение email">
      <div className={styles.sectionHeader}>
        <h3>
          {status.data?.verified ? 'Email подтверждён' : 'Подтверждение email'}
        </h3>
        <p>
          {status.data?.verified
            ? 'Вы можете принимать приглашения в общие пространства.'
            : 'Чтобы увидеть и принять приглашения в общие пространства, подтвердите адрес своей почты.'}
        </p>
      </div>
      {!status.data?.verified ? (
        <>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={busy || !status.data}
            onClick={() => {
              confirm.reset()
              send.mutate()
            }}
          >
            {send.isPending
              ? 'Отправляем…'
              : sent
                ? 'Отправить новый код'
                : 'Отправить код на почту'}
          </button>
          <label className={styles.field} htmlFor={codeId}>
            <span>Код из письма</span>
            <input
              id={codeId}
              value={code}
              autoComplete="one-time-code"
              maxLength={24}
              placeholder="ABCD-1234-EF56"
              onChange={(event) => {
                setCode(event.target.value)
                confirm.reset()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (code.trim() && !busy) confirm.mutate()
                }
              }}
            />
          </label>
          <button
            type="button"
            className={styles.ghostButton}
            disabled={busy || !code.trim()}
            onClick={() => confirm.mutate()}
          >
            Подтвердить email
          </button>
          {sent ? (
            <p role="status">
              Код отправлен на {status.data?.email}. Он действует 30 минут.
            </p>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{verificationErrorMessage(error)}</p> : null}
    </section>
  )
}

function verificationErrorMessage(error: unknown): string {
  if (error instanceof SessionApiError && error.status === 429)
    return 'Слишком много попыток. Попробуйте позже.'
  return error instanceof Error
    ? error.message
    : 'Не удалось подтвердить email. Попробуйте позже.'
}
