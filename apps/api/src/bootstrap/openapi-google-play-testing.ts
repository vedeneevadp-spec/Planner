import type { OpenAPIV3 } from 'openapi-types'

import {
  errorResponse,
  jsonRequestBody,
  jsonResponse,
  userIdParameter,
} from './openapi-helpers.js'

function operation(
  operationId: string,
  summary: string,
  response: string,
  input?: string,
): OpenAPIV3.OperationObject {
  return {
    operationId,
    summary,
    tags: ['googlePlayTesting'],
    security: [{ bearerAuth: [] }],
    ...(input ? { requestBody: jsonRequestBody(input) } : {}),
    responses: {
      200: jsonResponse(response),
      400: errorResponse(),
      401: errorResponse(),
      403: errorResponse(),
      409: errorResponse(),
      429: errorResponse(),
    },
  }
}
export function createGooglePlayTestingPaths(): OpenAPIV3.PathsObject {
  return {
    '/api/v1/google-play-testing': {
      get: operation(
        'getGooglePlayTesting',
        'Своя заявка и ссылки после подтверждения доступа',
        'GooglePlayTestingState',
      ),
    },
    '/api/v1/google-play-testing/request': {
      put: operation(
        'submitGooglePlayTesting',
        'Отправить или изменить Google-почту для теста',
        'GooglePlayTestingState',
        'GooglePlayTestingInput',
      ),
    },
    '/api/v1/admin/google-play-testing': {
      get: operation(
        'listGooglePlayTesting',
        'Заявки на тест: только owner/admin',
        'GooglePlayTestingAdmin',
      ),
      patch: operation(
        'setGooglePlayTestingOpen',
        'Открыть или закрыть набор: только owner/admin',
        'GooglePlayTestingSettings',
        'GooglePlayTestingSettingsInput',
      ),
    },
    '/api/v1/admin/google-play-testing/requests/{userId}': {
      patch: {
        ...operation(
          'reviewGooglePlayTesting',
          'Подтвердить ручное добавление в Google Play: только owner/admin',
          'GooglePlayTestingRequest',
          'GooglePlayTestingReview',
        ),
        parameters: [userIdParameter()],
      },
    },
  }
}
