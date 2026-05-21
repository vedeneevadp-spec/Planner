# ADR 0002: Критическая стабильность авторизации

## Status

Accepted

## Контекст

Пользователь мобильного приложения после входа ожидает сразу попадать в свой
контент. После недавних auth/runtime рефакторингов приложение регрессировало в
состояния, где пользователя могло выбросить, при старте мог мелькать экран
проверки доступа, либо UI показывал connected-состояние при недоступных
защищенных данных.

Для Chaotika это продуктово-критичный инвариант, а не косметическое UX-правило:
авторизованный мобильный пользователь должен оставаться авторизованным, пока он
сам явно не выйдет или сервер не подтвердит ревокацию текущей сессии.

## Решение

Mobile auth lifecycle считается критической инфраструктурой.

Обязательные инварианты:

- приложение не должно разлогинивать мобильного пользователя из-за retryable
  network errors, временно пустого storage-read, race при app resume, stale
  local snapshots или refresh retry storm
- native auth storage можно очищать только при явном sign-out пользователя или
  после подтвержденной серверной ревокации текущей device session
- startup и resume должны предпочитать показ последнего валидного cached content,
  пока идет auth restore; блокирующий экран проверки доступа допустим только
  когда нет безопасной cached session для отображения
- UI не должен показывать "connected", если нет usable auth state или явного
  restoring state, который сохраняет существующий контент на экране
- refresh-token rotation с точки зрения клиента должен быть single-flight и
  устойчивым к повторным mobile resume/startup запросам с того же устройства
- same-device refresh replay на native runtime должен опираться на стабильный
  `deviceId` установленного приложения; user-agent допустим только как legacy
  fallback для старых refresh-токенов без `deviceId`
- SQL runtime functions, используемые auth, являются частью auth boundary;
  изменения требуют PostgreSQL-тестов на success, replay, stale token, revoked
  token и cross-device cases
- feature code не должен превращать session readiness errors в ложные offline
  или success states

## Правила реализации

- явный sign-out остается единственным штатным путем очистки мобильного auth
  state пользователя
- restore, refresh и resume моделируются как единый lifecycle, а не как
  независимые UI effects
- cache можно использовать, чтобы сохранять контент видимым во время native
  restore, но protected writes все равно требуют текущий access token
- любое изменение в `SessionProvider`, `AuthGate`, auth storage, planner session
  bootstrap, refresh endpoints или auth SQL functions должно включать тесты
  mobile restore path
- релиз, меняющий mobile auth behavior, проходит native release checklist; web
  deploy сам по себе не обновляет уже установленные Capacitor apps

## Validation Gate

Перед merge или release auth/session изменений:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:mobile-auth`
4. `npm run test:web:run`
5. `npm run test:api`
6. `npm run test:api:postgres`, если меняются SQL, RLS, auth repository или
   refresh-token behavior
7. `npm run test:e2e`, если меняются auth, routing или first-screen behavior
8. native smoke на симуляторе или физическом устройстве, если меняется поведение
   установленного приложения

Минимальный ручной mobile smoke:

1. открыть уже авторизованное установленное приложение
2. проверить, что при наличии cached session контент появляется без блокирующего
   flash экрана проверки доступа
3. свернуть и вернуть приложение
4. выключить и включить сеть во время resume
5. перезагрузить или заново открыть приложение
6. подтвердить, что пользователя не разлогинило без нажатия на sign-out

## Последствия

- auth fixes должны предпочитать ясную state-machine модель и тестовое покрытие
  локальным UI-патчам
- cached content во время restore допустим; silent logout недопустим
- "connected but empty" считается сломанным состоянием, если empty data не
  подтверждена успешным server response для авторизованного пользователя
- database auth changes ревьюятся так же строго, как frontend auth changes,
  потому что любая из сторон может выбросить мобильного пользователя
