# D1 schema (`api/migrations/0001_init.sql`)

Accounts: `users`, `sessions` (sha256 токена), `auth_identities` (OAuth, подготовлено), `email_codes`, `user_settings`.
Profiles: `profiles` (creator/business, owner_user_id), `profile_links`, `profile_social_accounts`, `profile_settings`, `subscriptions` (test entitlements).
Media: `media` (единая модель: r2 / external, poster, лицензия и атрибуция для стоков), `collections`, `collection_items`, `media_views`, `likes`.
Jobs: `jobs` (draft/published/closed/removed), `job_media`, `applications` (один активный на пару — частичный UNIQUE), `application_media`, `saved_jobs`.
Contacts: `contact_requests` (pair_key, одна живая связь на пару — частичный UNIQUE).
Messages: `conversations` (UNIQUE pair_key + job), `conversation_participants`, `conversation_read_state`, `messages`, `message_attachments`.
Reviews: `reviews` (один опубликованный на аккаунт автора на профиль), `review_requests` (один pending на пару), `review_invites` (sha256 токена).
System: `notifications`, `reports`, `audit_logs`, `demo_seed_versions`.
Индексы под каждую ленту: jobs_feed, media_reels, messages_conversation, notifications_recipient/unread, contact_requests_*.
