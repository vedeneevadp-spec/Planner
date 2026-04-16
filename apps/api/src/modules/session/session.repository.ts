import type { SessionContext, SessionSnapshot } from './session.model.js'

export interface SessionRepository {
  resolve(context: SessionContext): Promise<SessionSnapshot>
}
