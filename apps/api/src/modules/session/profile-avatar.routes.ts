import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import { parseOrThrow } from '../../bootstrap/validation.js'

const profileAvatarParamsSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(260)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
})

const mimeTypesByExtension = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

export function registerProfileAvatarRoutes(
  app: FastifyInstance,
  profileAvatarDirectory: string,
): void {
  const rootDirectory = path.resolve(profileAvatarDirectory)

  app.get('/api/v1/profile-assets/:fileName', async (request, reply) => {
    const params = parseOrThrow(
      profileAvatarParamsSchema,
      request.params,
      'invalid_params',
    )
    const extension = path.extname(params.fileName).toLowerCase()
    const mimeType = mimeTypesByExtension.get(extension)

    if (!mimeType) {
      throw new HttpError(
        404,
        'profile_avatar_not_found',
        'Profile avatar was not found.',
      )
    }

    try {
      const file = await readFile(path.join(rootDirectory, params.fileName))

      reply.header('cache-control', 'public, max-age=31536000, immutable')
      reply.type(mimeType)

      return file
    } catch {
      throw new HttpError(
        404,
        'profile_avatar_not_found',
        'Profile avatar was not found.',
      )
    }
  })
}
