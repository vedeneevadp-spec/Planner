import 'fastify'

import type { AuthenticatedRequestContext } from './request-auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthenticatedRequestContext | null
  }
}
