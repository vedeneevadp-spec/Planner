# Time System Rules

В planner-логике запрещено использовать `Date` напрямую.

Все пользовательские даты и время проходят через shared `TimeService`.

Date-only значения хранятся и передаются как `YYYY-MM-DD`.
Они не являются UTC midnight.

Timed schedule хранится как:

```txt
local_date + local_time + IANA time_zone + calculated starts_at_utc
```

UTC / `timestamptz` используется только для instant-событий:
`created_at`, `updated_at`, `completed_at`, `sent_at`, audit, reminders.
