# Развёртывание и окружение

## Cloudflare (из `api/`)
```bash
npx wrangler login
npx wrangler d1 migrations apply kolaba-db --remote
npx wrangler deploy
node seed/generate.mjs --check-media && npx wrangler d1 execute kolaba-db --remote --file seed/seed.sql --yes
API=https://kolaba-api.mlkdesignweb.workers.dev node tests/e2e.mjs
```
Локально: `npx wrangler d1 migrations apply kolaba-db --local`, `npx wrangler dev --env local` (+ `.dev.vars` с `MEDIA_URL_SECRET`).

### Включить загрузки (R2)
1. Dashboard → R2 → Enable (Cloudflare просит платёжный метод; 10 ГБ/мес бесплатно).
2. `npx wrangler r2 bucket create kolaba-media`
3. В `wrangler.jsonc` добавить `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "kolaba-media" }]`, `npx wrangler deploy`.
`/v1/health` покажет `"storage": true`; e2e-тест E переключится на полный цикл загрузки.

### Включить регистрацию (Resend)
1. resend.com → API key; `npx wrangler secret put RESEND_API_KEY` (вводите ключ сами).
2. Без подтверждённого домена Resend шлёт письма только на адрес владельца аккаунта Resend — для настоящих пользователей подтвердите свой домен и поменяйте `EMAIL_FROM` в `wrangler.jsonc`.

## Переменные (`wrangler.jsonc` → vars)
`ALLOWED_ORIGINS`, `APP_URL`, `API_URL`, `EMAIL_FROM`, `SIGNUPS_PER_DAY`, `MAX_PHOTO_MB`, `MAX_VIDEO_MB`, `MAX_VIDEO_SECONDS`. Секреты: `RESEND_API_KEY`, `MEDIA_URL_SECRET`. Веб: `web/.env.production` → `VITE_API_URL`.

## GitHub Pages
`web/scripts/publish-pages.sh` → коммит корня → `git push origin main`. Pages: ветка `main`, папка `/`. Прежняя версия — тег `backup/pre-web-mvp-01`.

## Демо-аккаунты
Пароли генерируются локально в `api/seed/.demo-credentials.json` (git-ignored). Аккаунты: `creator.pro@`, `creator.free@`, `business.pro@`, `multi@demo.kolaba.test` (creator + 2 business). Остальные 76 демо-профилей без пароля (вход невозможен).

## Мониторинг стоимости
Workers Free: 100k запросов/день; D1 Free: 5M чтений, 100k записей/день, 5 ГБ. Смотреть: Dashboard → Workers & Pages → kolaba-api → Metrics, D1 → kolaba-db → Metrics. Polling ~4 запроса/мин на открытую вкладку (в чате ~15/мин).
