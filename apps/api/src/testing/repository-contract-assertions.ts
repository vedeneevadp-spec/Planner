import { isHttpError } from '../bootstrap/http-error.js'

export function hasHttpErrorCode(error: unknown, code: string): boolean {
  return isHttpError(error) && error.code === code
}
