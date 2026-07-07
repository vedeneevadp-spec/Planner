import {
  type UserBackupArchive,
  userBackupArchiveSchema,
  type UserBackupPreviewResponse,
  userBackupPreviewResponseSchema,
} from '@planner/contracts'

import { plannerApiConfig } from '@/shared/config/planner-api'
import {
  createApiRequester,
  readResponsePayload,
  throwApiError,
} from '@/shared/lib/api-client'

export class UserBackupApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'UserBackupApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export interface UserBackupApiOptions {
  accessToken: string
  actorUserId: string
  workspaceId: string
}

export interface DownloadUserBackupResult {
  fileName: string
  text: string
}

export async function downloadUserBackup(
  options: UserBackupApiOptions,
  fetchFn: typeof fetch = fetch,
): Promise<DownloadUserBackupResult> {
  const { send } = createUserBackupRequester(options, fetchFn)
  const response = await send({
    actorHeader: 'always',
    fallbackErrorMessage: 'Failed to download backup.',
    path: '/api/v1/backups/export',
  })

  if (!response.ok) {
    const payload = await readResponsePayload(response)

    throwApiError({
      createError: (message, errorOptions) =>
        new UserBackupApiError(message, errorOptions),
      fallbackCode: 'backup_export_failed',
      fallbackMessage: 'Failed to download backup.',
      payload,
      response,
    })
  }

  return {
    fileName: getBackupFileName(response.headers),
    text: await response.text(),
  }
}

export async function previewUserBackupImport(
  options: UserBackupApiOptions & { archive: UserBackupArchive },
  fetchFn: typeof fetch = fetch,
): Promise<UserBackupPreviewResponse> {
  const { request } = createUserBackupRequester(options, fetchFn)

  return request({
    actorHeader: 'always',
    body: userBackupArchiveSchema.parse(options.archive),
    fallbackErrorMessage: 'Failed to preview backup.',
    method: 'POST',
    path: '/api/v1/backups/import/preview',
    responseSchema: userBackupPreviewResponseSchema,
  })
}

export function parseUserBackupArchiveText(text: string): UserBackupArchive {
  return userBackupArchiveSchema.parse(JSON.parse(text) as unknown)
}

export function getUserBackupErrorMessage(error: unknown): string {
  if (error instanceof UserBackupApiError) {
    if (error.code === 'backup_personal_workspace_required') {
      return 'Резервные копии пока доступны только для личного пространства.'
    }

    if (error.status === 401) {
      return 'Войдите в аккаунт, чтобы работать с резервными копиями.'
    }

    return error.message
  }

  if (error instanceof SyntaxError) {
    return 'Файл не похож на JSON-архив Planner.'
  }

  return 'Не удалось обработать резервную копию.'
}

function createUserBackupRequester(
  options: UserBackupApiOptions,
  fetchFn: typeof fetch,
) {
  return createApiRequester(
    {
      accessToken: options.accessToken,
      actorUserId: options.actorUserId,
      apiBaseUrl: plannerApiConfig.apiBaseUrl,
      workspaceId: options.workspaceId,
    },
    (message, errorOptions) => new UserBackupApiError(message, errorOptions),
    fetchFn,
    {
      fallbackErrorCode: 'backup_request_failed',
    },
  )
}

function getBackupFileName(headers: Headers): string {
  const disposition = headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/i.exec(disposition)

  return match?.[1] ?? 'planner-backup.json'
}
