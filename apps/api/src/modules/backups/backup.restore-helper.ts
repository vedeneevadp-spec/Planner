import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import {
  USER_BACKUP_MAX_REQUEST_BYTES,
  userBackupArchiveSchema,
  userBackupRestoreResponseSchema,
} from '@planner/contracts/backup'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type { UserBackupRestoreInput } from './backup.model.js'
import type { UserBackupRestoreExecutor } from './backup.restore-executor.js'
import {
  createUserBackupArchiveDigest,
  getUserBackupRestoreWarnings,
} from './backup.service.js'

export const USER_BACKUP_RESTORE_HELPER_BODY_LIMIT =
  USER_BACKUP_MAX_REQUEST_BYTES + 1024
export const USER_BACKUP_RESTORE_SIGNATURE_HEADER =
  'x-planner-restore-signature'
export const USER_BACKUP_RESTORE_TIMESTAMP_HEADER =
  'x-planner-restore-timestamp'
export const USER_BACKUP_RESTORE_SIGNATURE_MAX_AGE_MS = 60_000

const internalRestoreInputSchema = z
  .object({
    archive: userBackupArchiveSchema,
    archiveDigest: z.string().regex(/^[a-f0-9]{64}$/),
    context: z
      .object({
        actorUserId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        workspaceKind: z.literal('personal'),
        workspaceName: z.string().optional(),
      })
      .strict(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/),
    restoreProfile: z.boolean(),
    restoreWorkspaceSettings: z.boolean(),
  })
  .strict()

type InternalRestoreInput = z.infer<typeof internalRestoreInputSchema>

interface RestoreHelperClientConfig {
  secret: string
  url: string
}

type FetchImplementation = typeof fetch

export class HttpUserBackupRestoreClient implements UserBackupRestoreExecutor {
  constructor(
    private readonly config: RestoreHelperClientConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  async restorePersonalWorkspace(
    input: UserBackupRestoreInput,
  ): Promise<ReturnType<typeof userBackupRestoreResponseSchema.parse>> {
    const body = JSON.stringify(toInternalRestoreInput(input))
    const timestamp = String(Date.now())
    const signature = createUserBackupRestoreSignature(
      this.config.secret,
      timestamp,
      body,
    )
    let response: Response

    try {
      response = await this.fetchImplementation(this.config.url, {
        body,
        headers: {
          'content-type': 'application/json',
          [USER_BACKUP_RESTORE_SIGNATURE_HEADER]: signature,
          [USER_BACKUP_RESTORE_TIMESTAMP_HEADER]: timestamp,
        },
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
      })
    } catch (error) {
      throw new HttpError(
        503,
        'backup_restore_unavailable',
        'Backup restore helper is unavailable.',
        error instanceof Error ? { cause: error.name } : undefined,
      )
    }

    const payload = await readJsonResponse(response)

    if (!response.ok) {
      const helperError = parseHelperError(payload)

      throw new HttpError(
        response.status,
        helperError.code,
        helperError.message,
        helperError.details,
      )
    }

    const parsed = userBackupRestoreResponseSchema.safeParse(payload)

    if (!parsed.success) {
      throw new HttpError(
        503,
        'backup_restore_invalid_helper_response',
        'Backup restore helper returned an invalid response.',
      )
    }

    return parsed.data
  }
}

export function parseUserBackupRestoreHelperBody(
  body: Buffer,
): UserBackupRestoreInput {
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(
      400,
      'invalid_backup_restore_helper_request',
      'Backup restore helper request must contain valid JSON.',
    )
  }

  const parsed = internalRestoreInputSchema.safeParse(parsedJson)

  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_backup_restore_helper_request',
      'Backup restore helper request is invalid.',
    )
  }

  assertInternalRestoreInput(parsed.data)

  return {
    ...parsed.data,
    context: createRestoreContext(parsed.data.context),
  }
}

export function createUserBackupRestoreSignature(
  secret: string,
  timestamp: string,
  body: Buffer | string,
): string {
  const bodyDigest = createHash('sha256').update(body).digest('hex')

  return createHmac('sha256', secret)
    .update(`${timestamp}.${bodyDigest}`)
    .digest('hex')
}

export function verifyUserBackupRestoreSignature({
  body,
  now = Date.now(),
  secret,
  signature,
  timestamp,
}: {
  body: Buffer
  now?: number
  secret: string
  signature: string | undefined
  timestamp: string | undefined
}): void {
  const parsedTimestamp = Number(timestamp)

  if (
    !timestamp ||
    !Number.isSafeInteger(parsedTimestamp) ||
    Math.abs(now - parsedTimestamp) >
      USER_BACKUP_RESTORE_SIGNATURE_MAX_AGE_MS ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  ) {
    throw createAuthenticationError()
  }

  const expected = createUserBackupRestoreSignature(secret, timestamp, body)
  const actualBuffer = Buffer.from(signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw createAuthenticationError()
  }
}

function assertInternalRestoreInput(input: InternalRestoreInput): void {
  if (createUserBackupArchiveDigest(input.archive) !== input.archiveDigest) {
    throw new HttpError(
      400,
      'backup_restore_digest_mismatch',
      'Backup restore archive digest does not match the archive.',
    )
  }

  const context = createRestoreContext(input.context)
  const warnings = getUserBackupRestoreWarnings(context, input.archive)

  if (warnings.length > 0) {
    throw new HttpError(
      422,
      'backup_archive_not_restorable',
      'Backup archive failed restore validation.',
      { warnings },
    )
  }
}

function createRestoreContext(context: InternalRestoreInput['context']): {
  actorUserId: string
  auth: null
  workspaceId: string
  workspaceKind: 'personal'
  workspaceName?: string
} {
  return {
    actorUserId: context.actorUserId,
    auth: null,
    workspaceId: context.workspaceId,
    workspaceKind: context.workspaceKind,
    ...(context.workspaceName === undefined
      ? {}
      : { workspaceName: context.workspaceName }),
  }
}

function toInternalRestoreInput(
  input: UserBackupRestoreInput,
): InternalRestoreInput {
  return internalRestoreInputSchema.parse({
    archive: input.archive,
    archiveDigest: input.archiveDigest,
    context: {
      actorUserId: input.context.actorUserId,
      workspaceId: input.context.workspaceId,
      workspaceKind: input.context.workspaceKind,
      ...(input.context.workspaceName
        ? { workspaceName: input.context.workspaceName }
        : {}),
    },
    idempotencyKey: input.idempotencyKey,
    restoreProfile: input.restoreProfile,
    restoreWorkspaceSettings: input.restoreWorkspaceSettings,
  })
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (response.ok) {
      throw new HttpError(
        503,
        'backup_restore_invalid_helper_response',
        'Backup restore helper returned an invalid response.',
      )
    }

    return null
  }
}

function parseHelperError(payload: unknown): {
  code: string
  details?: unknown
  message: string
} {
  const result = z
    .object({
      error: z.object({
        code: z.string(),
        details: z.unknown().optional(),
        message: z.string(),
      }),
    })
    .safeParse(payload)

  return result.success
    ? result.data.error
    : {
        code: 'backup_restore_unavailable',
        message: 'Backup restore helper failed.',
      }
}

function createAuthenticationError(): HttpError {
  return new HttpError(
    401,
    'backup_restore_helper_unauthorized',
    'Backup restore helper authentication failed.',
  )
}
