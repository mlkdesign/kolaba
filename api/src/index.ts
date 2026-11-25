// kolaba-api — Cloudflare Worker (Hono). REST API v1 for the KOLABA web app.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import type { AppEnv } from './env';
import { ApiError } from './lib/util';
import { optionalAuth } from './lib/auth';
import auth from './routes/auth';
import profiles from './routes/profiles';
import comments from './routes/comments';
import media from './routes/media';
import jobs from './routes/jobs';
import contacts from './routes/contacts';
import messages from './routes/messages';
import reviews from './routes/reviews';
import me from './routes/me';
import { notifications, reels, search, sync } from './routes/social';
import { blocks, feedback, reports } from './routes/safety';
import { assertCanPost, monetizationEnabled } from './lib/moderation';
import { purgeExpired } from './lib/retention';
import admin from './routes/admin';
import { billing } from './routes/billing';
import { ChatHub } from './realtime';
import { fail as failWith } from './lib/util';

const app = new Hono<AppEnv>();

// CORS: only the listed origins get CORS headers (never "*" — requests carry a bearer token). CORS is not the
// protection: every route checks the session and the acting profile itself.
app.use('*', async (c, next) => {
  // The admin API answers only the admin panel's origin(s); the app API only the app's.
  const list = c.req.path.startsWith('/v1/admin') ? (c.env.ADMIN_ORIGINS ?? '') : c.env.ALLOWED_ORIGINS;
  const allowed = list.split(',').map((o) => o.trim()).filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'X-Profile-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Range', 'Accept-Ranges'],
    maxAge: 86400,
  })(c, next);
});

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  if (!c.res.headers.get('Content-Type')?.startsWith('video/') && !c.res.headers.get('Content-Type')?.startsWith('image/')) {
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  }
});

// App sessions only — the admin API has its own (routes/admin.ts) and never reads app sessions.
app.use('/v1/*', async (c, next) => (c.req.path.startsWith('/v1/admin') ? next() : optionalAuth(c, next)));

// A moderator's restriction stops publishing (jobs, uploads, messages, applications, reviews, contact requests) while
// it lasts; reading, reporting, blocking, feedback and account deletion keep working.
const POSTING = /^\/v1\/(jobs(\/[^/]+(\/(apply|publish))?)?|media\/uploads.*|conversations(\/[^/]+\/(messages|voice|files))?|reviews|contacts\/requests)$/;
app.use('/v1/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method) && POSTING.test(c.req.path)) await assertCanPost(c);
  await next();
});

// Shared links (no auth): `/p/<profile id>`, `/j/<job id>` — Universal Links. With the iOS app installed iOS opens them
// in the app (the association file below); otherwise the browser lands here and goes on to the web app. A download
// page can replace the redirect later.
const APPLE_APP_IDS = ['XU9738YN8V.com.kolaba.app', 'XU9738YN8V.com.jackmilka.kolaba'];
app.get('/.well-known/apple-app-site-association', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ applinks: { details: [{ appIDs: APPLE_APP_IDS, components: [{ '/': '/p/*' }, { '/': '/j/*' }] }] } });
});
const SHARE_ID = /^[A-Za-z0-9_-]{3,80}$/;
for (const [prefix, route] of [['p', 'profile'], ['j', 'job']] as const) {
  app.get(`/${prefix}/:id`, (c) => {
    const id = c.req.param('id');
    if (!SHARE_ID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    return c.redirect(`${c.env.APP_URL.replace(/\/?$/, '/')}#/${route}/${id}`, 302);
  });
}

// Public app configuration (no auth): what the clients may show.
app.get('/v1/config', (c) => c.json({ monetizationEnabled: monetizationEnabled(c.env),
  legal: { privacy: `${c.env.APP_URL.replace(/\/?$/, '/')}legal/privacy.html`, terms: `${c.env.APP_URL.replace(/\/?$/, '/')}legal/terms.html`,
           guidelines: `${c.env.APP_URL.replace(/\/?$/, '/')}legal/community-guidelines.html`, support: `${c.env.APP_URL.replace(/\/?$/, '/')}legal/support.html` } }));

app.get('/v1/health', async (c) => {
  const db = await c.env.DB.prepare(`SELECT COUNT(*) AS profiles FROM profiles`).first<{ profiles: number }>().catch(() => null);
  const seed = await c.env.DB.prepare(`SELECT version FROM demo_seed_versions ORDER BY applied_at DESC LIMIT 1`).first<{ version: string }>()
    .catch(() => null);
  return c.json({ status: db ? 'ok' : 'degraded', version: 'v1', database: Boolean(db), storage: Boolean(c.env.MEDIA),
                  email: Boolean(c.env.RESEND_API_KEY), profiles: db?.profiles ?? null, seed: seed?.version ?? null, time: Date.now() });
});

app.route('/v1/auth', auth);
app.route('/v1/profiles', profiles);
app.route('/v1/comments', comments);
app.route('/v1/media', media);
app.route('/v1/jobs', jobs);
app.route('/v1/contacts', contacts);
app.route('/v1/conversations', messages);
app.route('/v1/reviews', reviews);
app.route('/v1/me', me);
app.route('/v1/notifications', notifications);
app.route('/v1/reels', reels);
app.route('/v1/search', search);
app.route('/v1/sync', sync);
app.route('/v1/reports', reports);
app.route('/v1/blocks', blocks);
app.route('/v1/feedback', feedback);
app.route('/v1/admin', admin);
app.route('/v1/billing', billing);

// GET /v1/realtime?profile= (WebSocket) — the acting profile's event stream. The session comes from the Authorization
// header as everywhere else; the profile must belong to it.
app.get('/v1/realtime', async (c) => {
  const user = c.get('user') ?? failWith(401, 'not_signed_in');
  if (!c.env.CHAT_HUB) failWith(503, 'realtime_unavailable');
  const profileId = c.req.query('profile') ?? c.req.header('X-Profile-Id') ?? failWith(400, 'profile_required');
  const profile = await c.env.DB.prepare(`SELECT owner_user_id, status FROM profiles WHERE id = ?`).bind(profileId)
    .first<{ owner_user_id: string; status: string }>();
  if (!profile || profile.owner_user_id !== user.id || profile.status !== 'active') failWith(403, 'not_profile_owner');
  if (c.req.header('Upgrade') !== 'websocket') failWith(400, 'websocket_required');
  const hub = c.env.CHAT_HUB!.get(c.env.CHAT_HUB!.idFromName(profileId));
  return hub.fetch(new Request(`https://hub/connect?profile=${encodeURIComponent(profileId)}`, c.req.raw));
});

app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { ...error.details, code: error.code, message: error.message } }, error.status);
  if (error instanceof ZodError) {
    const custom = error.issues.find((i) => i.code === 'custom')?.message;
    return c.json({ error: { code: custom ?? 'invalid_request', fields: error.issues.map((i) => i.path.join('.')) } }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: { code: 'invalid_json' } }, 400);
  console.error('unhandled', c.req.method, c.req.path, error);
  return c.json({ error: { code: 'internal_error' } }, 500);
});

export { ChatHub };

export default {
  fetch: app.fetch,
  // Daily (wrangler.jsonc triggers): shared report messages past their retention, expired sessions.
  async scheduled(_event: ScheduledEvent, env: AppEnv['Bindings'], ctx: ExecutionContext) {
    ctx.waitUntil(purgeExpired(env));
  },
};
