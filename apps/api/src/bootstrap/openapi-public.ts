import type { OpenAPIV3 } from 'openapi-types'

// Filtering paths alone still exposes internal models in Swagger's Schemas panel.
// Keep only components reachable from the integration operations.
export function createPublicOpenApiDocument(
  document: OpenAPIV3.Document,
): OpenAPIV3.Document {
  const paths = Object.fromEntries(
    Object.entries(document.paths).filter(([path]) =>
      path.startsWith('/api/public/v1/'),
    ),
  )
  const components: OpenAPIV3.ComponentsObject = {
    securitySchemes: {
      apiKeyAuth: document.components!.securitySchemes!.apiKeyAuth!,
    },
  }
  const visited = new Set<string>()
  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (typeof object.$ref === 'string') {
      const ref = object.$ref
      if (!ref.startsWith('#/components/') || visited.has(ref)) return
      visited.add(ref)
      const [, , group, name] = ref.split('/')
      const source = document.components as Record<
        string,
        Record<string, unknown>
      >
      const component = source[group!]?.[name!]
      if (!component)
        throw new Error(`Unresolved public OpenAPI reference: ${ref}`)
      const target = components as Record<string, Record<string, unknown>>
      ;(target[group!] ??= {})[name!] = component
      collect(component)
    }
    for (const child of Object.values(object)) collect(child)
  }
  collect(paths)
  return {
    openapi: document.openapi,
    info: {
      title: 'Хаотика — Public API',
      version: '1.0.0',
      description:
        'API для своих скриптов, ботов и автоматизаций. Создайте ключ в настройках → API и интеграции. Доступны задачи и покупки в пространстве ключа.',
    },
    ...(document.servers ? { servers: document.servers } : {}),
    tags: document.tags?.filter((tag) => tag.name === 'integrations') ?? [],
    paths,
    components,
  }
}
