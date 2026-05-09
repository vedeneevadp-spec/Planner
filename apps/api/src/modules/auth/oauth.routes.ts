import { authPasswordSchema, type AuthTokenResponse } from '@planner/contracts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { AliceOAuthConfig } from '../../bootstrap/config.js'
import { HttpError } from '../../bootstrap/http-error.js'
import {
  assertInMemoryRateLimit,
  getClientAddress,
} from '../../bootstrap/rate-limit.js'
import type { AuthRequestMetadata } from './auth.model.js'
import type { AuthService } from './auth.service.js'

const authorizationQuerySchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  response_type: z.literal('code'),
  scope: z.string().optional().default(''),
  state: z.string().optional().default(''),
})

const authorizationFormSchema = authorizationQuerySchema.extend({
  displayName: z.string().trim().max(80).optional().default(''),
  email: z.string().trim().email().max(320),
  mode: z.enum(['login', 'register']).optional().default('login'),
  password: z.string().min(1).max(128),
})

const tokenRequestSchema = z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  code: z.string().optional(),
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  redirect_uri: z.string().url().optional(),
  refresh_token: z.string().optional(),
})

type AuthorizationQuery = z.infer<typeof authorizationQuerySchema>
type AuthorizationForm = z.infer<typeof authorizationFormSchema>
type TokenRequest = z.infer<typeof tokenRequestSchema>
type OAuthAuthorizeMode = AuthorizationForm['mode']

interface RegisterOAuthRoutesOptions {
  aliceOAuth: AliceOAuthConfig | null
  service: AuthService
}

interface OAuthError {
  error: string
  error_description?: string
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  options: RegisterOAuthRoutesOptions,
): void {
  registerUrlEncodedFormParser(app)

  app.get('/api/v1/oauth/alice/authorize', async (request, reply) => {
    const parsedQuery = authorizationQuerySchema.safeParse(request.query)

    if (!parsedQuery.success) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderAuthorizePage({
            errorMessage: 'Некорректный запрос авторизации.',
          }),
        )
    }

    const validationError = validateAuthorizeRequest(parsedQuery.data, options)

    return reply.type('text/html; charset=utf-8').send(
      renderAuthorizePage({
        ...(validationError ? { errorMessage: validationError } : {}),
        query: parsedQuery.data,
      }),
    )
  })

  app.post('/api/v1/oauth/alice/authorize', async (request, reply) => {
    const parsedForm = authorizationFormSchema.safeParse(request.body ?? {})

    if (!parsedForm.success) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderAuthorizePage({
            errorMessage: 'Проверьте email и пароль.',
            values: readAuthorizePageValues(request.body),
          }),
        )
    }

    const validationError = validateAuthorizeRequest(parsedForm.data, options)
    const pageState = {
      query: parsedForm.data,
      values: getAuthorizePageValues(parsedForm.data),
    }

    if (validationError) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          renderAuthorizePage({
            errorMessage: validationError,
            ...pageState,
          }),
        )
    }

    assertOAuthAuthorizeRateLimit(request, parsedForm.data.email)

    try {
      const metadata = getRequestMetadata(request)

      if (parsedForm.data.mode === 'register') {
        const passwordValidation = authPasswordSchema.safeParse(
          parsedForm.data.password,
        )

        if (!passwordValidation.success) {
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderAuthorizePage({
                errorMessage: 'Пароль должен быть не короче 6 символов.',
                ...pageState,
              }),
            )
        }

        await options.service.signUp(
          {
            ...(parsedForm.data.displayName
              ? { displayName: parsedForm.data.displayName }
              : {}),
            email: parsedForm.data.email,
            password: parsedForm.data.password,
          },
          metadata,
        )
      }

      const code = await options.service.createOAuthAuthorizationCode(
        {
          clientId: parsedForm.data.client_id,
          email: parsedForm.data.email,
          expiresAt: addSeconds(
            options.aliceOAuth!.authorizationCodeTtlSeconds,
          ),
          password: parsedForm.data.password,
          redirectUri: parsedForm.data.redirect_uri,
          scope: parsedForm.data.scope,
        },
        metadata,
      )
      const redirectUrl = new URL(parsedForm.data.redirect_uri)

      redirectUrl.searchParams.set('code', code)
      redirectUrl.searchParams.set('client_id', parsedForm.data.client_id)
      redirectUrl.searchParams.set('scope', parsedForm.data.scope)

      if (parsedForm.data.state) {
        redirectUrl.searchParams.set('state', parsedForm.data.state)
      }

      return reply.redirect(redirectUrl.toString(), 302)
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.code === 'auth_invalid_credentials'
      ) {
        return reply
          .code(401)
          .type('text/html; charset=utf-8')
          .send(
            renderAuthorizePage({
              errorMessage: 'Неверный email или пароль.',
              ...pageState,
            }),
          )
      }

      if (error instanceof HttpError && error.code === 'auth_email_taken') {
        return reply
          .code(409)
          .type('text/html; charset=utf-8')
          .send(
            renderAuthorizePage({
              errorMessage:
                'Аккаунт с таким email уже есть. Войдите или используйте другой email.',
              ...pageState,
            }),
          )
      }

      throw error
    }
  })

  app.post('/api/v1/oauth/alice/token', async (request, reply) => {
    const parsedRequest = tokenRequestSchema.safeParse(request.body ?? {})

    if (!parsedRequest.success) {
      return sendOAuthError(reply, 400, {
        error: 'invalid_request',
        error_description: 'Token request is malformed.',
      })
    }

    const clientValidation = validateTokenClient(
      request,
      parsedRequest.data,
      options.aliceOAuth,
    )

    if (clientValidation) {
      return sendOAuthError(reply, clientValidation.statusCode, {
        error: clientValidation.error,
        error_description: clientValidation.description,
      })
    }

    if (parsedRequest.data.grant_type === 'authorization_code') {
      return handleAuthorizationCodeGrant(
        request,
        reply,
        parsedRequest.data,
        options,
      )
    }

    return handleRefreshTokenGrant(request, reply, parsedRequest.data, options)
  })
}

async function handleAuthorizationCodeGrant(
  request: FastifyRequest,
  reply: FastifyReply,
  input: TokenRequest,
  options: RegisterOAuthRoutesOptions,
) {
  if (!input.code || !input.redirect_uri || !input.client_id) {
    return sendOAuthError(reply, 400, {
      error: 'invalid_request',
      error_description: 'code, client_id, and redirect_uri are required.',
    })
  }

  try {
    const token = await options.service.exchangeOAuthAuthorizationCode(
      {
        clientId: input.client_id,
        code: input.code,
        redirectUri: input.redirect_uri,
      },
      getRequestMetadata(request),
    )

    return sendOAuthTokenResponse(reply, token)
  } catch (error) {
    if (error instanceof HttpError && error.code === 'oauth_invalid_grant') {
      return sendOAuthError(reply, 400, {
        error: 'invalid_grant',
        error_description: error.message,
      })
    }

    throw error
  }
}

async function handleRefreshTokenGrant(
  request: FastifyRequest,
  reply: FastifyReply,
  input: TokenRequest,
  options: RegisterOAuthRoutesOptions,
) {
  if (!input.refresh_token) {
    return sendOAuthError(reply, 400, {
      error: 'invalid_request',
      error_description: 'refresh_token is required.',
    })
  }

  try {
    const token = await options.service.refresh(
      input.refresh_token,
      getRequestMetadata(request),
    )

    return sendOAuthTokenResponse(reply, token)
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === 'auth_refresh_token_invalid'
    ) {
      return sendOAuthError(reply, 400, {
        error: 'invalid_grant',
        error_description: error.message,
      })
    }

    throw error
  }
}

function validateAuthorizeRequest(
  query: AuthorizationQuery,
  options: RegisterOAuthRoutesOptions,
): string | null {
  if (!options.aliceOAuth) {
    return 'OAuth-связка Алисы не настроена на сервере.'
  }

  if (query.client_id !== options.aliceOAuth.clientId) {
    return 'Некорректный OAuth client_id.'
  }

  if (query.redirect_uri !== options.aliceOAuth.redirectUri) {
    return 'Некорректный OAuth redirect_uri.'
  }

  return null
}

function validateTokenClient(
  request: FastifyRequest,
  input: TokenRequest,
  config: AliceOAuthConfig | null,
): { description: string; error: string; statusCode: number } | null {
  if (!config) {
    return {
      description: 'Alice OAuth is not configured.',
      error: 'temporarily_unavailable',
      statusCode: 503,
    }
  }

  const credentials = readClientCredentials(request, input)

  if (
    credentials.clientId !== config.clientId ||
    credentials.clientSecret !== config.clientSecret
  ) {
    return {
      description: 'Client authentication failed.',
      error: 'invalid_client',
      statusCode: 401,
    }
  }

  return null
}

function readClientCredentials(
  request: FastifyRequest,
  input: TokenRequest,
): { clientId: string | undefined; clientSecret: string | undefined } {
  const rawAuthorization = request.headers.authorization as
    | string
    | string[]
    | undefined
  const authorization = Array.isArray(rawAuthorization)
    ? rawAuthorization[0]
    : rawAuthorization

  if (authorization?.toLowerCase().startsWith('basic ')) {
    const encodedCredentials = authorization.slice('basic '.length)
    const decodedCredentials = Buffer.from(
      encodedCredentials,
      'base64',
    ).toString('utf8')
    const separatorIndex = decodedCredentials.indexOf(':')

    if (separatorIndex >= 0) {
      return {
        clientId: decodedCredentials.slice(0, separatorIndex),
        clientSecret: decodedCredentials.slice(separatorIndex + 1),
      }
    }
  }

  return {
    clientId: input.client_id,
    clientSecret: input.client_secret,
  }
}

function sendOAuthTokenResponse(reply: FastifyReply, token: AuthTokenResponse) {
  return reply.send({
    access_token: token.accessToken,
    expires_in: Math.max(
      0,
      Math.floor((new Date(token.expiresAt).getTime() - Date.now()) / 1000),
    ),
    refresh_token: token.refreshToken,
    token_type: 'Bearer',
  })
}

function sendOAuthError(
  reply: FastifyReply,
  statusCode: number,
  error: OAuthError,
) {
  return reply.code(statusCode).send(error)
}

function renderAuthorizePage({
  errorMessage,
  query,
  values,
}: {
  errorMessage?: string | undefined
  query?: Partial<AuthorizationQuery> | undefined
  values?: AuthorizePageValues | undefined
}): string {
  const pageValues = values ?? {}
  const hiddenFieldEntries: Array<[string, string]> = [
    ['response_type', query?.response_type ?? 'code'],
    ['client_id', query?.client_id ?? ''],
    ['redirect_uri', query?.redirect_uri ?? ''],
    ['scope', query?.scope ?? ''],
    ['state', query?.state ?? ''],
  ]
  const hiddenFields = hiddenFieldEntries
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(
          value,
        )}">`,
    )
    .join('\n')
  const errorBlock = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : ''
  const modeCopy =
    pageValues.mode === 'register'
      ? 'Создайте аккаунт Chaotika и сразу свяжите его с навыком.'
      : 'Войдите в существующий аккаунт Chaotika или создайте новый.'

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Связать Chaotika с Алисой</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #17202a; }
    main { width: min(420px, calc(100vw - 32px)); background: #fff; border: 1px solid #d8dee8; border-radius: 8px; padding: 24px; box-shadow: 0 12px 28px rgba(25, 35, 55, 0.08); }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 18px; color: #526071; line-height: 1.45; }
    .hint { margin-top: 14px; margin-bottom: 0; font-size: 13px; }
    label { display: grid; gap: 6px; margin: 14px 0; font-size: 14px; color: #2e3a47; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #c7d0dd; border-radius: 6px; padding: 11px 12px; font: inherit; }
    .actions { display: grid; gap: 8px; margin-top: 8px; }
    button { width: 100%; border: 0; border-radius: 6px; padding: 12px; background: #1f6feb; color: white; font: inherit; font-weight: 600; cursor: pointer; }
    button.secondary { background: #eef2f7; color: #1f2937; border: 1px solid #c7d0dd; }
    .error { color: #a42020; background: #fff0f0; border: 1px solid #ffc9c9; border-radius: 6px; padding: 10px 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Связать Chaotika с Алисой</h1>
    <p>${escapeHtml(modeCopy)}</p>
    ${errorBlock}
    <form method="post" action="/api/v1/oauth/alice/authorize">
      ${hiddenFields}
      <label>Имя
        <input type="text" name="displayName" autocomplete="name" maxlength="80" value="${escapeHtml(
          pageValues.displayName ?? '',
        )}">
      </label>
      <label>Email
        <input type="email" name="email" autocomplete="email" value="${escapeHtml(
          pageValues.email ?? '',
        )}" required>
      </label>
      <label>Пароль
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <div class="actions">
        <button type="submit" name="mode" value="login">Войти и связать</button>
        <button class="secondary" type="submit" name="mode" value="register">Создать и связать</button>
      </div>
      <p class="hint">Для нового аккаунта укажите пароль от 6 символов.</p>
    </form>
  </main>
</body>
</html>`
}

interface AuthorizePageValues {
  displayName?: string
  email?: string
  mode?: OAuthAuthorizeMode
}

function getAuthorizePageValues(input: AuthorizationForm): AuthorizePageValues {
  return {
    displayName: input.displayName,
    email: input.email,
    mode: input.mode,
  }
}

function readAuthorizePageValues(body: unknown): AuthorizePageValues {
  if (!isRecord(body)) {
    return {}
  }

  return {
    displayName:
      typeof body.displayName === 'string' ? body.displayName.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim() : '',
    mode:
      body.mode === 'login' || body.mode === 'register' ? body.mode : 'login',
  }
}

function registerUrlEncodedFormParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    return
  }

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))))
    },
  )
}

function getRequestMetadata(request: FastifyRequest): AuthRequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : undefined,
  }
}

function assertOAuthAuthorizeRateLimit(
  request: FastifyRequest,
  email: string,
): void {
  assertInMemoryRateLimit({
    key: `oauth:alice:authorize:${getClientAddress(request)}:${email.trim().toLowerCase()}`,
    limit: 5,
    windowMs: 15 * 60_000,
  })
}

function addSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return character
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
