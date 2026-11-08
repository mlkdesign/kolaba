# kolaba. — web (WEB MVP 01)

Public test version of the KOLABA iOS app, inside the original iPhone mockup: **https://mlkdesign.github.io/kolaba/**
Backend: Cloudflare Worker **https://kolaba-api.mlkdesignweb.workers.dev** (D1 `kolaba-db`, R2 `kolaba-media` when enabled).

| Folder | What |
|---|---|
| `web/` | Vite + TypeScript + Preact app (source). `web/index.html` keeps the previous mockup shell (frame, status bar, preloader) |
| `api/` | Hono Worker, D1 migrations, demo seed generator, e2e tests |
| `docs/` | Audit, architecture, schema, API, deployment, tests, limitations |
| root (`index.html`, `app/`, `icons/`, `fonts/`, `demo/`, `assets/`) | **Generated** by `web/scripts/publish-pages.sh` — GitHub Pages serves `main` / root |

The previous prototype is kept in the tag `backup/pre-web-mvp-01`.

```bash
cd web && npm install && npm run dev            # http://127.0.0.1:5173 (uses VITE_API_URL from .env.development)
cd api && npm install && npx wrangler dev --env local
cd web && scripts/publish-pages.sh              # then commit + push main
```

See `docs/DEPLOYMENT.md` for Cloudflare commands, secrets and demo accounts.
