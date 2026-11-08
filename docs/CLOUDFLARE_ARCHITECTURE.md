# Cloudflare

| Ресурс | Имя | Статус |
|---|---|---|
| Worker | `kolaba-api` → https://kolaba-api.mlkdesignweb.workers.dev | развёрнут, observability включена |
| D1 | `kolaba-db` (880ac093-6e95-43b9-8c39-d42a8f539316, EEUR) | миграция `0001_init.sql` применена удалённо, seed `web-mvp-01` |
| R2 | `kolaba-media` | **не создан: R2 не включён на аккаунте** (нужно включить в Dashboard) |
| Rate limiting | `RL_AUTH` 10/мин, `RL_WRITE` 60/мин (Workers Rate Limiting binding) | работает |
| Secrets | `MEDIA_URL_SECRET` (подпись приватных ссылок); `RESEND_API_KEY` — нет | |

**API**: Hono, `/v1/*`, JSON-ошибки `{error:{code}}`, zod-валидация, параметризованный SQL, keyset-пагинация, CORS-allowlist (`https://mlkdesign.github.io`, без `*`), CSP/nosniff/no-store, `GET /v1/health`.

**Auth**: собственная, e-mail+пароль. PBKDF2-HMAC-SHA256 **600 000 итераций** (6×100 000 цепочкой: WebCrypto в Workers не принимает >100 000 за вызов), соль 16 байт. Замер на Free: 30/30 запросов, ~0,2 с — в лимит укладывается. Сессии: случайный 256-битный токен, в БД только sha256, 30 дней со скольжением. Блокировка после 8 неудач на 15 мин, rate limit по IP и e-mail, коды 6 цифр (хеш, 15 мин, 5 попыток), дневной лимит регистраций (`SIGNUPS_PER_DAY=50`).

**Медиа**: `POST /media/uploads` (тип, размер, лимиты, PRO) → `PUT` тела потоком в R2 через `FixedLengthStream` (без буферизации, проверка сигнатуры файла по первым байтам) → `ready`. Отдача с Range (Safari), приватные файлы по подписанной ссылке на 1 час. Лимиты: фото 10 МБ, видео 50 МБ / 60 с (`MAX_*`). Демо-медиа — та же модель `media`, `provider='external'`.

**Realtime**: polling `/v1/sync` (одна лёгкая выборка счётчиков). Durable Objects — следующий шаг.

**Откат**: `npx wrangler deployments list` / `npx wrangler rollback <version>`; D1 Time Travel (`wrangler d1 time-travel restore`).
