# Haotika MCP Connector для ChatGPT Developer Mode

Документ описывает первый private/draft-подключаемый вариант Haotika App для
ChatGPT Developer Mode. Коннектор read-only: он не создает, не меняет и не
удаляет данные планера.

## MCP transport

Выбран Streamable HTTP-compatible transport на единственном endpoint:

```text
POST /mcp
```

`initialize` и `tools/list` доступны без bearer token. Это Mixed Auth модель:
список tools виден ChatGPT при создании Draft app, а каждый protected
`tools/call` требует OAuth access token и scopes из tool metadata.

Для production reverse proxy нужно проксировать root-path endpoints на API без
буферизации streaming responses:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/oauth/*
/mcp
```

## Required env

Минимальная production-конфигурация:

```env
HAOTIKA_MCP_ENABLED=true
HAOTIKA_MCP_PUBLIC_BASE_URL=https://chaotika.ru
HAOTIKA_MCP_DEV_NO_AUTH=false
HAOTIKA_MCP_RATE_LIMIT_PER_MINUTE=30
HAOTIKA_DEFAULT_TIMEZONE=Europe/Astrakhan
HAOTIKA_OAUTH_ISSUER=https://chaotika.ru
HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/...
```

Для локального smoke-flow можно добавить localhost redirect:

```env
HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS=http://127.0.0.1:4173/*
```

Для ChatGPT production callback не угадывается заранее: после Create app
ChatGPT покажет конкретный URL вида
`https://chatgpt.com/connector/oauth/{callback_id}`. Его нужно добавить в
`HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS`. Можно указать несколько URI через
запятую.

## Required migrations

Применить миграции:

```bash
npm run db:migrate
```

Нужная миграция создает:

```text
app.mcp_oauth_tokens
app.mcp_audit_logs
```

Plain access/refresh tokens не хранятся, в базе лежат только hashes. OAuth token
record хранит `issuer` и `resource`, чтобы MCP tool-call мог проверять
audience/resource.

## Public URLs

Для домена `https://chaotika.ru` должны открываться:

```text
POST https://chaotika.ru/mcp
GET  https://chaotika.ru/.well-known/oauth-protected-resource
GET  https://chaotika.ru/.well-known/oauth-authorization-server
GET  https://chaotika.ru/oauth/authorize
POST https://chaotika.ru/oauth/authorize
POST https://chaotika.ru/oauth/token
POST https://chaotika.ru/oauth/revoke
```

## OAuth metadata

Protected resource metadata:

```json
{
  "resource": "https://chaotika.ru/mcp",
  "authorization_servers": ["https://chaotika.ru"],
  "scopes_supported": [
    "haotika:tasks.read",
    "haotika:calendar.read",
    "haotika:shopping.read",
    "haotika:cleaning.read",
    "haotika:selfcare.read",
    "haotika:habits.read",
    "haotika:stats.read"
  ],
  "resource_documentation": "https://chaotika.ru/docs/mcp-haotika"
}
```

Authorization server metadata:

```json
{
  "issuer": "https://chaotika.ru",
  "authorization_endpoint": "https://chaotika.ru/oauth/authorize",
  "token_endpoint": "https://chaotika.ru/oauth/token",
  "revocation_endpoint": "https://chaotika.ru/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": [
    "haotika:tasks.read",
    "haotika:calendar.read",
    "haotika:shopping.read",
    "haotika:cleaning.read",
    "haotika:selfcare.read",
    "haotika:habits.read",
    "haotika:stats.read"
  ]
}
```

CIMD/DCR пока не объявляются.

## ChatGPT Developer Mode

1. Включить Developer Mode: ChatGPT Settings -> Apps -> Advanced settings ->
   Developer mode.
2. Открыть Apps settings и нажать Create app.
3. Указать remote MCP server:

   ```text
   https://chaotika.ru/mcp
   ```

4. Выбрать OAuth или Mixed Auth.
5. Скопировать показанный ChatGPT redirect URI вида
   `https://chatgpt.com/connector/oauth/{callback_id}`.
6. Добавить этот URI в `HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS` и перезапустить API.
7. Refresh app/tools в ChatGPT.
8. Нажать Connect OAuth и пройти форму Haotika: логин, read-only consent,
   redirect обратно в ChatGPT.

После подключения `tools/list` должен показать:

```text
get_today_context
get_week_context
search_planner
get_overload_context
get_selfcare_context
```

## Smoke test

Локально против запущенного API:

```bash
MCP_SMOKE_BASE_URL=http://127.0.0.1:3001 \
MCP_SMOKE_REDIRECT_URI=http://127.0.0.1:4173/mcp-smoke/callback \
MCP_SMOKE_CREATE_USER=true \
npm run smoke:mcp
```

Против staging/production с существующим тестовым пользователем:

```bash
MCP_SMOKE_BASE_URL=https://chaotika.ru \
MCP_SMOKE_REDIRECT_URI=https://chatgpt.com/connector/oauth/<callback_id> \
MCP_SMOKE_EMAIL='owner@example.com' \
MCP_SMOKE_PASSWORD='...' \
npm run smoke:mcp
```

Smoke проверяет:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
MCP initialize
MCP tools/list
unauthorized get_today_context -> WWW-Authenticate + mcp/www_authenticate
OAuth authorization-code + PKCE S256 + resource
authorized get_today_context
revoke token
revoked token rejected
```

## Golden prompts

```text
Use Haotika and tell me what is planned today.
Use Haotika get_today_context and summarize my day.
Use Haotika and analyze overload this week.
Use Haotika and search planner for машина.
Use Haotika and tell me what self-care is missing this week.
```

## Troubleshooting

`tools/list` не видит tools:

```text
- проверить, что /mcp отвечает на initialize и tools/list;
- проверить, что HAOTIKA_MCP_ENABLED=true;
- проверить, что reverse proxy проксирует POST /mcp в API, а не в web SPA.
```

OAuth UI не открывается:

```text
- unauthorized protected tools/call должен вернуть HTTP 401;
- response должен иметь WWW-Authenticate;
- MCP tool result должен иметь _meta["mcp/www_authenticate"];
- /.well-known/oauth-protected-resource должен быть доступен без auth.
```

`redirect_uri is not allowed`:

```text
- скопировать exact redirect URI из ChatGPT app management;
- добавить его в HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS;
- несколько URI разделяются запятой;
- wildcard поддержан только как суффикс, например https://chatgpt.com/connector/oauth/*.
```

`Requested resource is invalid` или 401 после token exchange:

```text
- resource в protected metadata должен быть exactly https://chaotika.ru/mcp;
- authorize request и token request должны передавать тот же resource;
- token record должен хранить этот resource;
- HAOTIKA_OAUTH_ISSUER должен совпадать с issuer в authorization metadata.
```

Streaming/proxy проблемы:

```text
- для Developer Mode поддержаны SSE и streaming HTTP;
- текущий transport использует POST /mcp;
- если ChatGPT видит timeout или broken stream, проверить buffering на CDN/load balancer/reverse proxy.
```

## Known limitations

```text
- Calendar context currently uses timed tasks if no separate calendar module exists.
- Authorization codes are in-memory in MVP mode and short-lived.
- Connector is intended for owner/private testing first.
- All tools are read-only.
- No write actions, OpenAI API key, OpenAI SDK or in-app AI chat are included.
```
