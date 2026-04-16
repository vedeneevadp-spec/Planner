import type { ZodType } from 'zod'

import { HttpError } from './http-error.js'

export function parseOrThrow<T>(
  schema: ZodType<T>,
  input: unknown,
  code: string,
): T {
  const result = schema.safeParse(input)

  if (!result.success) {
    throw new HttpError(
      400,
      code,
      'Request validation failed.',
      result.error.flatten(),
    )
  }

  return result.data
}
