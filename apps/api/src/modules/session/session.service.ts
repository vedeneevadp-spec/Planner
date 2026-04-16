import type { SessionContext } from './session.model.js'
import type { SessionRepository } from './session.repository.js'

export class SessionService {
  constructor(private readonly repository: SessionRepository) {}

  resolveSession(context: SessionContext) {
    return this.repository.resolve(context)
  }
}
