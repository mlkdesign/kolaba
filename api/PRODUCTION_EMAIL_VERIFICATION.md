# Production email verification rollout

Do not deploy until both secrets are present on `kolaba-api`. Secret values must never be committed or pasted into
logs. The OTP HMAC secret must be independent from the Resend API key and other application secrets.

```bash
cd api
./node_modules/.bin/wrangler secret list
./node_modules/.bin/wrangler secret put RESEND_API_KEY
openssl rand -base64 48 | ./node_modules/.bin/wrangler secret put OTP_HASH_SECRET
```

`secret list` prints names only. Confirm that `RESEND_API_KEY` and `OTP_HASH_SECRET` are listed. Do not configure
`TEST_CODE_INBOX`, `SIGNUP_ALLOWED_EMAILS`, or `RESEND_API_URL` in production. `RESEND_API_URL` exists only so the
automated test can use a local Resend-compatible capture server.

## Pre-deploy validation

```bash
npm test
./node_modules/.bin/wrangler deploy --dry-run --env=""
```

The automated test uses local D1 and never calls Resend. Before deployment, use a staging Worker and staging D1 to
send to controlled addresses at Gmail, Outlook, iCloud and another provider. Verify delivery, HTML and plain-text
rendering, spam placement, registration, login of an unverified account, resend after 30 seconds, password reset and
both steps of an email change.

## Safe production order

1. Back up production D1. This release has no D1 migration and does not rewrite existing rows.
2. Add `OTP_HASH_SECRET`, then confirm both required secret names with `wrangler secret list`.
3. Deploy to staging and complete the provider matrix above.
4. Review the Worker version diff and deploy `kolaba-api` only after explicit approval.
5. Run one controlled production signup. Confirm the message comes from `KOLABA <verify@kolaba.app>` and the OTP is
   accepted once only. Then test resend and password reset with the same controlled account.
6. Monitor Resend delivery events and Worker `email_failed`/429 rates without logging recipients, OTPs or response
   bodies. Keep the previous Worker version available for rollback.

Existing unconsumed legacy SHA-256 OTP rows remain valid only until their original TTL. Every newly issued OTP is
stored as `hmac:v1:…`, tied to user, purpose, record and expiration. No existing user or profile data is modified by
the rollout.
