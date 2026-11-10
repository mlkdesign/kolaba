# Moderation, safety, feedback (APP STORE READINESS, 2026-11-10)

## Migration
`api/migrations/0005_moderation.sql` — additive (only `reports` is rebuilt; nothing references it). Every existing media / job /
review starts as `review_status = 'approved'`. Backup before applying to production:
`backups/app-store-readiness-2026-11-09/kolaba-db-before-moderation.sql` (taken 2026-11-09, before any change).

New tables: `report_evidence`, `moderation_actions`, `banned_identities`, `blocks`, `feedback`, `message_reactions`,
`message_voice`. New columns: `media/jobs/reviews.review_status…`, `users.restricted_until/restriction_reason/banned_at/
warnings_count/terms_accepted_at/terms_version`, `messages.client_id` (unique per sender), `conversations.created_by_profile_id`.

## App API
| Route | What |
|---|---|
| `GET /v1/config` | public: `monetizationEnabled`, legal page URLs |
| `POST /v1/reports` | `{targetType: user|post|media|message|conversation|review, targetId, category, details?, consentToShareMessages?}` — legacy `profile/job`, `reason` still accepted |
| `GET/POST /v1/blocks`, `DELETE /v1/blocks/:profileId` | account-level blocks |
| `POST /v1/feedback` | multipart: `category, message, appVersion, osVersion, platform, screenshot?` |
| `PUT/DELETE /v1/conversations/:id/messages/:messageId/like` | message likes |
| `POST /v1/conversations/:id/voice` | multipart voice message (AAC/M4A ≤ `MAX_VOICE_KB`, ≤ `MAX_VOICE_SECONDS`) |
| `GET /v1/media/voice/:messageId?exp&sig` | signed, short-lived audio URL |
| `POST /v1/conversations/:id/messages` | now takes `clientId` (retries never duplicate) |
| `DELETE /v1/me` | now needs `password` for accounts that have one |

Sign-up (`/v1/auth/signup`) and first Google sign-in need `acceptTerms: true`. A banned email can't sign up again.

## Admin API (`/v1/admin`, admin session only, every action in `admin_logs`)
`GET /moderation/stats`, `GET /reports` (tab, category, status, from/to, user, q, sort), `GET /reports/:id` (target, shared
messages — access logged as `report.evidence_view`, history, decisions), `POST /reports/:id/action` (review, dismiss, resolve,
remove_content, restore_content, warn, restrict{days}, unrestrict, suspend, unsuspend, ban — dangerous ones need `confirm: true`
and a reason), `POST /users/:id/sanction`, `GET /content-review?type=media|posts|reviews&status=…`,
`POST /content-review/:type/:id {decision, reason}`, `GET/PATCH /feedback`, `GET /feedback/:id/attachment`, `GET /counts`.

## Rules
- New public media (avatar, portfolio, intro, collection, job) → `pending`; only approved items are public; the owner sees
  pending/flagged ones. Rejected/removed files are served only through signed URLs (admin preview).
- Text checks (`lib/moderation.ts checkText`) only route to a human: flagged jobs leave the feed until approved; flagged reviews
  wait; flagged profile texts create an automatic report. Nothing is rejected or banned automatically.
- Optional Google Vision SafeSearch (`GOOGLE_VISION_API_KEY` secret) — **off**; enabling it needs the owner's approval and a
  Privacy Policy update.
- Restriction blocks posting (jobs, uploads, messages, applications, reviews, contact requests) — see `POSTING` in `src/index.ts`.
- Paid plans: `MONETIZATION_ENABLED=false` → no PRO in cards, entitlements all `available`, `PUT /v1/me/pro-test` refused.

## Retention (`lib/retention.ts`, daily cron `17 3 * * *`)
Shared report messages deleted `EVIDENCE_RETENTION_DAYS` (180) after the report closes; expired sessions and codes removed.
Account deletion removes the account and everything it owns (R2 files included); reports it filed stay without the reporter;
a ban keeps only `sha256("kolaba-ban:" + email)`.

## Tests (local only — never against production)
`node tests/moderation-e2e.mjs` (13), `node tests/e2e.mjs` (16), `PERSIST=… node tests/account-deletion-e2e.mjs` (4), with
`wrangler dev --env local --port 8790 --persist-to <copy of production D1>`.

## Deploy (needs the owner's go-ahead)
```
cd api && npx wrangler d1 export kolaba-db --remote --output ../../backups/<name>.sql
npx wrangler d1 migrations apply kolaba-db --remote
npx wrangler deploy
cd ../admin-web && npm run build
cd ../web && bash scripts/publish-pages.sh   # then commit + push main (GitHub Pages, legal/ included)
```
