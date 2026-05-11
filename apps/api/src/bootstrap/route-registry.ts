import type { FastifyInstance } from 'fastify'

export interface RegisteredApiRoute {
  method: string
  path: string
}

const registeredApiRoutes = new WeakMap<FastifyInstance, RegisteredApiRoute[]>()

const TRACKED_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put'])

export function registerApiRouteRegistry(app: FastifyInstance): void {
  const routes: RegisteredApiRoute[] = []
  registeredApiRoutes.set(app, routes)

  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method]

    for (const method of methods) {
      const normalizedMethod = method.toLowerCase()

      if (!TRACKED_METHODS.has(normalizedMethod)) {
        continue
      }

      routes.push({
        method: normalizedMethod,
        path: normalizeFastifyRoutePath(routeOptions.url),
      })
    }
  })
}

export function getRegisteredApiRoutes(
  app: FastifyInstance,
): RegisteredApiRoute[] {
  return [...(registeredApiRoutes.get(app) ?? [])]
}

function normalizeFastifyRoutePath(path: string): string {
  return path.replaceAll(/:([A-Za-z0-9_]+)/g, '{$1}')
}
