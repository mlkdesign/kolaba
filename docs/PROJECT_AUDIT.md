# WEB MVP 01 — аудит

## Что найдено
| Источник | Факт |
|---|---|
| iOS | `~/Desktop/KOLABA/kolaba-app` — SwiftUI, Swift 6, вкладки `projects · creators · reels · messages · myProfile`, Notifications из Reels. Полный разбор моделей — `kolaba-app/docs/backend/PROJECT_AUDIT.md` (BACKEND FOUNDATION 01). Токены дизайна, шрифты (Plus Jakarta Sans, Montserrat) и SVG-иконки взяты из `Assets.xcassets` 1:1. |
| GitHub | Пользователь `mlkdesign`. **Ветки `Colaba` нет ни в одном репозитории.** Мокап iPhone — `mlkdesign/kolaba` (ветка `main`, Pages из `main` / root, без Actions, без custom domain) → https://mlkdesign.github.io/kolaba/. Рядом `kolaba-web` (та же кодовая база без мокапа) — не тронут. По решению владельца заменён `mlkdesign/kolaba`. |
| Старая версия | Vanilla JS-прототип без бэкенда (моки). Сохранена: тег `backup/pre-web-mvp-01` (d9c8de7). |
| Мокап | `assets/iphone.png` 434×887, экран 386×841 (`left 24, top 23, radius 58`), фейковый статус-бар по Dynamic Island, прелоадер «create → inspire → collab → kolaba». Перенесён без изменения геометрии (`web/index.html`, `web/src/styles/shell.css`). |
| Cloudflare | Аккаунт mlkdesignweb@gmail.com (90c268d0…). До начала: 1 Worker `mlk-studio-requests` (не тронут), D1 нет, **R2 не включён**, Durable Objects нет, поддомен `mlkdesignweb.workers.dev`. |
| Figma | Отдельно не открывалась: источник визуала — актуальное iOS-приложение (его токены, иконки, шрифты). |
