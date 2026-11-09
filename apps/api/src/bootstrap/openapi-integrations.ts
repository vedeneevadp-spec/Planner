import {
  publicShoppingListSchema,
  publicTaskListSchema,
} from '@planner/contracts'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from 'zod'

import {
  emptyResponse,
  errorResponse,
  jsonRequestBody,
  jsonResponse,
} from './openapi-helpers.js'

const idParameter: OpenAPIV3.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
}
function queryParameters(schema: z.ZodType): OpenAPIV3.ParameterObject[] {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
  }) as OpenAPIV3.SchemaObject
  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    required: false,
    schema: value,
  }))
}
function operation(
  id: string,
  summary: string,
  scope: string,
  response: string,
  input?: string,
  status = 200,
): OpenAPIV3.OperationObject {
  return {
    operationId: id,
    summary,
    tags: ['integrations'],
    servers: [{ url: '/' }],
    description: `Требуется разрешение \`${scope}\`. Пространство определяется ключом.`,
    security: [{ apiKeyAuth: [] }],
    ...(input ? { requestBody: jsonRequestBody(input) } : {}),
    responses: {
      [status]: jsonResponse(response),
      400: errorResponse(),
      401: errorResponse(),
      403: errorResponse(),
      404: errorResponse(),
      409: errorResponse(),
      415: errorResponse(),
      429: errorResponse(),
    },
  }
}
export function createIntegrationPaths(): OpenAPIV3.PathsObject {
  return {
    '/api/v1/api-keys': {
      get: {
        operationId: 'listApiKeys',
        summary: 'Список своих API-ключей',
        tags: ['apiKeys'],
        security: [{ bearerAuth: [] }],
        responses: {
          200: jsonResponse('ApiKeyListResponse'),
          401: errorResponse(),
        },
      },
      post: {
        operationId: 'createApiKey',
        summary: 'Создать API-ключ (секрет показывается один раз)',
        tags: ['apiKeys'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/requiredWorkspaceIdHeader' },
        ],
        requestBody: jsonRequestBody('CreateApiKeyInput'),
        responses: {
          201: jsonResponse('CreatedApiKeyResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          409: errorResponse(),
        },
      },
    },
    '/api/v1/api-keys/{id}': {
      delete: {
        operationId: 'revokeApiKey',
        summary: 'Отозвать свой API-ключ',
        tags: ['apiKeys'],
        security: [{ bearerAuth: [] }],
        parameters: [idParameter],
        responses: {
          204: emptyResponse('Ключ отозван.'),
          401: errorResponse(),
          404: errorResponse(),
        },
      },
    },
    '/api/public/v1/tasks': {
      get: {
        ...operation(
          'publicListTasks',
          'Найти задачи',
          'tasks:read',
          'TaskListPageResponse',
        ),
        parameters: queryParameters(publicTaskListSchema),
      },
      post: operation(
        'publicCreateTask',
        'Создать задачу',
        'tasks:write',
        'TaskRecord',
        'PublicTaskCreate',
        201,
      ),
    },
    '/api/public/v1/tasks/{id}': {
      parameters: [idParameter],
      get: operation(
        'publicGetTask',
        'Получить задачу',
        'tasks:read',
        'TaskRecord',
      ),
      patch: operation(
        'publicUpdateTask',
        'Изменить поля задачи (expectedVersion обязателен)',
        'tasks:write',
        'TaskRecord',
        'PublicTaskUpdate',
      ),
    },
    '/api/public/v1/tasks/{id}/status': {
      parameters: [idParameter],
      patch: operation(
        'publicSetTaskStatus',
        'Изменить статус задачи',
        'tasks:write',
        'TaskRecord',
        'PublicTaskStatus',
      ),
    },
    '/api/public/v1/shopping': {
      get: {
        ...operation(
          'publicListShopping',
          'Найти покупки',
          'shopping:read',
          'ChaosInboxListRecordResponse',
        ),
        parameters: queryParameters(publicShoppingListSchema),
      },
      post: operation(
        'publicCreateShopping',
        'Добавить покупку',
        'shopping:write',
        'ChaosInboxItemRecord',
        'PublicShoppingCreate',
        201,
      ),
    },
    '/api/public/v1/shopping/{id}': {
      parameters: [idParameter],
      get: operation(
        'publicGetShopping',
        'Получить покупку',
        'shopping:read',
        'ChaosInboxItemRecord',
      ),
      patch: operation(
        'publicUpdateShopping',
        'Изменить покупку; archived — куплено, new — вернуть в список',
        'shopping:write',
        'ChaosInboxItemRecord',
        'PublicShoppingUpdate',
      ),
    },
  }
}

export const INTEGRATIONS_DESCRIPTION = `
API v1 для собственных скриптов, ботов и автоматизаций.

Создайте ключ в **Ещё → Настройки → API и интеграции**. Ключ привязан к выбранному пространству;
срок действия — от 1 до 365 дней, максимум 20 действующих ключей на пользователя.
Скопируйте секрет сразу и сохраните в переменной окружения HAOTIKA_API_KEY.
Передавайте его только в заголовке Authorization: Bearer, по HTTPS.
Разрешения на чтение и изменение независимы. Сохраняются обычные права участника пространства.
Отзыв ключа или потеря доступа к пространству запрещают следующие запросы.

### cURL: первые 10 задач
\`\`\`bash
curl --fail-with-body 'https://chaotika.ru/api/public/v1/tasks?limit=10' \\
  -H "Authorization: Bearer $HAOTIKA_API_KEY"
\`\`\`

### Python: добавить покупку (стандартная библиотека)
\`\`\`python
import json, os, urllib.request
request = urllib.request.Request(
    'https://chaotika.ru/api/public/v1/shopping',
    data=json.dumps({'text': 'Молоко', 'shoppingCategory': 'groceries'}).encode(),
    headers={'Authorization': 'Bearer ' + os.environ['HAOTIKA_API_KEY'],
             'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=20) as response:
    print(json.load(response))
\`\`\`

### JavaScript / Node.js: создать задачу
\`\`\`javascript
const response = await fetch('https://chaotika.ru/api/public/v1/tasks', {
  method: 'POST',
  headers: {Authorization: 'Bearer ' + process.env.HAOTIKA_API_KEY,
            'Content-Type': 'application/json'},
  body: JSON.stringify({title: 'Оплатить интернет'})
});
if (!response.ok) throw new Error(await response.text());
const task = await response.json();
console.log(task.id, task.version);
\`\`\`

### Изменения и повторы
PATCH задачи принимает только изменяемые поля и обязательный expectedVersion из последнего GET.
PATCH /tasks/{id}/status с {"status":"done","expectedVersion":1} отмечает выполнение.
PATCH /shopping/{id} с {"status":"archived"} отмечает покупку, new возвращает её в список.
Поля задач: title, note, project, plannedDate, dueDate, importance, necessity, resource.
Даты — YYYY-MM-DD; null очищает дату. plannedDate — план, dueDate — дедлайн.
Создание без дат оставляет задачу гибкой. PATCH покупок также поддерживает text, priority,
isFavorite, shoppingCategory, productUrl, dueDate. Последняя запись полей покупки побеждает.

Чтобы безопасно повторять POST, передавайте необязательное поле id — UUIDv7,
созданное один раз для этой операции. Повторяйте тот же id и тело; повтор возвращает существующую запись.
Без id повтор POST может создать дубликат. Общего заголовка Idempotency-Key в v1 нет.
Обновления приложения должны сохранять совместимость опубликованных методов /api/public/v1.

### Страницы, ошибки и лимиты
Задачи: limit (1–100), offset, nextOffset и hasMore. Фильтры: search, status, plannedDate.
Покупки: page (с 1), limit (1–100), total. Фильтры: search, status (new/archived).
Страницы не являются снимком данных: список может измениться между запросами.
Ошибки: error.code, error.message, error.details. 400 — поля запроса, 401 — ключ,
403 — права, 404 — запись, 409 — конфликт версии или идентификатора.
При 409 перечитайте запись и согласуйте изменения. 429 — лимит запросов: ждите Retry-After.
Лимиты: 120 запросов/мин на ключ, 240 на пользователя и 300 на IP.

### n8n
Используйте HTTP Request: метод GET, URL https://chaotika.ru/api/public/v1/tasks,
Header Auth с именем Authorization и значением Bearer ВАШ_КЛЮЧ.
Для POST/PATCH включите JSON Body. Храните ключ в credentials.
`
