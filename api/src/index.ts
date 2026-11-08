// kolaba-api — Cloudflare Worker (Hono). REST API v1 for the KOLABA web app.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ZodError } from 'zod';
import type { AppEnv } from './env';
import { ApiError } from './lib/util';
import { optionalAuth } from './lib/auth';
import auth from './routes/auth';
import profiles from './routes/profiles';
import media from './routes/media';
import jobs from './routes/jobs';
import contacts from './routes/contacts';
import messages from './routes/messages';
import reviews from './routes/reviews';
import { admin, notifications, reels, reports, search, sync } from './routes/social';

const app = new Hono<AppEnv>();

// CORS: only the listed origins get CORS headers (never "*" — requests carry a bearer token). CORS is not the
// protection: every route checks the session and the acting profile itself.
app.use('*', async (c, next) => {
  const allowed = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
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

app.use('/v1/*', optionalAuth);

app.get('/v1/health', async (c) => {
  const db = await c.env.DB.prepare(`SELECT COUNT(*) AS profiles FROM profiles`).first<{ profiles: number }>().catch(() => null);
  const seed = await c.env.DB.prepare(`SELECT version FROM demo_seed_versions ORDER BY applied_at DESC LIMIT 1`).first<{ version: string }>()
    .catch(() => null);
  return c.json({ status: db ? 'ok' : 'degraded', version: 'v1', database: Boolean(db), storage: Boolean(c.env.MEDIA),
                  email: Boolean(c.env.RESEND_API_KEY), profiles: db?.profiles ?? null, seed: seed?.version ?? null, time: Date.now() });
});

app.route('/v1/auth', auth);
app.route('/v1/profiles', profiles);
app.route('/v1/media', media);
app.route('/v1/jobs', jobs);
app.route('/v1/contacts', contacts);
app.route('/v1/conversations', messages);
app.route('/v1/reviews', reviews);
app.route('/v1/notifications', notifications);
app.route('/v1/reels', reels);
app.route('/v1/search', search);
app.route('/v1/sync', sync);
app.route('/v1/reports', reports);
app.route('/v1/admin', admin);

app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof ZodError) {
    const custom = error.issues.find((i) => i.code === 'custom')?.message;
    return c.json({ error: { code: custom ?? 'invalid_request', fields: error.issues.map((i) => i.path.join('.')) } }, 400);
  }
  if (error instanceof SyntaxError) return c.json({ error: { code: 'invalid_json' } }, 400);
  console.error('unhandled', c.req.method, c.req.path, error);
  return c.json({ error: { code: 'internal_error' } }, 500);
});

export default app;
