import { HttpError } from '../../bootstrap/http-error.js'

export class LifeSphereNotFoundError extends HttpError {
  constructor(sphereId: string) {
    super(
      404,
      'life_sphere_not_found',
      `Life sphere "${sphereId}" was not found.`,
    )
  }
}
