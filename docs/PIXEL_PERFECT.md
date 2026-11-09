# Pixel-Perfect Web Version — what was ported and how

Source of truth: the SwiftUI app (`kolaba-app/kolaba`), its design system (`Core/DesignSystem`) and simulator
screenshots of iPhone 17 Pro (402 × 874 pt). In the web build 1 CSS px = 1 pt; nothing is scaled with a transform
(on desktop only the phone picture is fitted to the window, the screen inside keeps real CSS pixels).

## Foundation
- **Tokens** (`web/src/styles/app.css`): KolabaColors, typography (Plus Jakarta Sans 300–800, Montserrat 400–800 —
  the same font files as the iOS bundle, Light and Montserrat Regular added), corners, spacing, motion.
- **Safe areas**: mockup `--safe-top: 62px`, `--safe-bottom: 34px` (iPhone 17 Pro); on phones `env(safe-area-inset-*)`,
  `viewport-fit=cover`, inputs 16 px (no zoom in Safari).
- **Liquid Glass** → `.glass`: translucent fill + `backdrop-filter: blur(14px) saturate(1.7)` + 1 px light edge.
- **Top blur** (KolabaTopBlur): #0B0B0B 0.7 → 0.5 → 0 over the header band plus an 8 px blur; on profiles it ramps
  in with the scroll, as on iOS.
- **Bottom gradient** (MainBottomGradient): 100 pt, 60 pt on chat., none on kolaba.
- **Glow** (`web/src/fx.tsx`): ProfileGlow and the authentication ambient use the iOS SVG blobs, their Figma matrices
  and centres, blur 50 and the same AmbientDrift sine motion, on one `requestAnimationFrame` clock that stops when
  hidden or with reduced motion.
- **Tab bar** (KolabaTabBar): 358 × 60 glass capsule 26 pt above the bottom, items 70 × 52, order job. · creators. ·
  kolaba. · chat. · My Profile (default), outline icons at 50 % → filled, white 12 % indicator sliding with a spring,
  profile avatar with the 1.5 pt pink / blue ring, unread badge; long press on the avatar opens Switch accounts.
- **Sections**: side by side, changed by the tab bar only (iOS FIX 106: no sideways swipe between sections); the
  inner tabs (Job posts · Applied · Saved, Creators · My Contacts, Portfolio · Reviews) swipe sideways with a 10 px
  direction lock and a 500 px/s flick, ignoring galleries and carousels.
- **Pushed screens** slide in from the right and go back with a drag from the left 24 px (past half or 700 px/s).
- **Sheets** (WebSheet): #1C1C1E, radius 38, grabber, spring in .35 / out .33, drag down to dismiss (a third or a
  flick), Escape closes.
- **Pull to refresh** on the feeds (threshold as on iOS).

## Screens
Start page (drifting photo collage rotated 15°, opacity 20 %, ambient glow), Create profile (red field + shake +
messages), Verify e-mail (six cells, paste, resend timer), Welcome back, password reset, first profile; My Profile and
public profiles (400 pt photo, glow, name + PRO, figures, Edit / Share or Message / Follow-Unfollow, social circles,
All Links, Portfolio · Reviews, All · Collections · Sort · +, ••• with contacts / review / report); Settings; Edit
profile; collections; job. feed (author row, 370:200 gallery with dots, price, languages, applicants, bookmark, View
project / Applied), job details (400 pt media, glass Apply bar), Apply sheet, applicants, editor; creators. (cards with
PRO glow, works strip, Message + In contacts / Add contact) and My Contacts; chat. list and the chat (bubbles with
tails, time outside, read ticks, day separators, glass composer); kolaba. (a page per creator, their videos sideways,
dots under the logo, like pill, pink Follow, bio, progress line); Notifications.

## Backend changes (additive)
- `follows` table (migration 0002) and `PUT/DELETE/GET /v1/profiles/:id/follow` (notification `followed`).
- `GET /v1/reels/creators` — the iOS feed grouped by creator.
- `bio` added to the catalog items (`GET /v1/profiles`).

## Checks
- `API=https://kolaba-api.mlkdesignweb.workers.dev node api/tests/e2e.mjs` — 14 scenarios on production, two and more
  accounts: jobs and applications, contacts, messages, reviews (request → notification → publish), uploads to R2,
  follows, grouped Reels, profile edits.
- Visual comparison against simulator screenshots at 402 × 874 (profile, public profile, job., creators., kolaba.,
  chat., chat, start, create profile with error, verify) and overflow checks at 375 × 812.

## Remaining differences
- The first profile figure is **Reviews**: the backend has no collaboration count yet (iOS shows Collabs).
- Profile hero shows the avatar photo only (the backend stores one profile photo; iOS pages several).
- No online indicator in chat rows (no presence data on the server).
- Liquid Glass refraction and the system's materials are approximated with CSS blur; Safari renders
  `backdrop-filter` slightly softer than iOS.
- Google / Apple sign-in are shown disabled ("iOS app") — they are not configured for the web.
- Find-in-chat uses the browser prompt.

## Round 2 — Figma audit, fixed phone, long press (2026-11-09)
Sources compared: the Figma file (page xCode: My Profile PRO 921:9306, Rewiews 980:17859, Notifications 654:16140,
Projects view 654:15004, My Job 706:2366, My Contacts 996:19190, Review request Sheet 1035:19713, Settings 654:18389,
Edit profile 663:19090, switcher 885:6949), the iOS code and simulator screenshots, the web at 402 × 874.
Rule used where they differ: the iOS app is the newer decision (its FIX notes post-date the frames — e.g. the tab bar
order, Message + Follow on public profiles, compact My Contacts rows); Figma decides where iOS has no reference.

- **One logical screen**: always 402 × 874 (the frame picture is drawn at 452 × 920 so its opening is exactly that);
  the whole phone is scaled so it is 70 % of the window's height, centred; on phones the screen alone is scaled to fit.
  Gestures divide pointer distances by the scale (`src/scale.ts`); clicks map natively.
- **Tab bar**: outside every scroll view, absolute in the screen, z 35 — pushed screens slide over it (as in iOS, where
  it moves with the sections), sheets and menus sit above it, the account switcher sits under it.
- **Pinned tabs** in job. and creators. (iOS "area under the pinned tabs"); the profile's Portfolio / Reviews pin under
  the header.
- **Long press** (500 ms, the iOS context-menu delay; 10 pt of movement or a scroll cancels; the click after it is
  swallowed; no browser menu, no image callout): own media → Delete → the app's alert → `DELETE /v1/media/:id`
  (owner-only on the server; collection items, avatar / intro / cover links, the video's poster and the R2 objects go
  too) → the tile leaves, lists refresh; on error the tile stays and a toast says why. Someone else's media: Report
  content. Notifications: Delete notification. My Contacts rows: Accept / Decline / Cancel / Remove.
- **States**: the contact button's iOS chain (Add to contacts → Requested ▸ Cancel request → In contacts ✓ ▸ Remove
  contact; Accept request), Follow / Following pills, Request / Requested / Reviewed, busy labels, alerts instead of
  browser `confirm`, sheets instead of `<select>`, an in-header search instead of `prompt` in chats.
- **Screens redone from Figma / iOS**: Notifications (Today with its count, Last 30 days, liked-video thumbnail,
  Follow pill, unread dot), Settings (account card, grouped rows, red Log out, Privacy & Safety, Language), Switch
  accounts sheet, Request a Review sheet (Invite someone new card), Reviews (4.9 out of 5, pink bars, Sort), job details
  (author row with bookmark, price in the glass Apply bar, applicants with shortlist / Message / View profile), Edit
  profile (labelled fields with icons, counters, Save bar), chips (grey fill), Reviews count on the profile tab, Show more.
- **API (additive)**: notifications carry `media` (liked video) and `isFollowingActor`; `DELETE /v1/notifications/:id`;
  media delete also removes the poster. E2E scenario K covers deletion and notification removal (15/15 on production).

Remaining differences: Collabs → Reviews figure; one profile photo; no presence dot; Google / Apple disabled on the web;
CSS blur instead of Liquid Glass refraction; Language offers English only on the web.

## Round 3 — proportions (2026-11-09)
Method: web screenshots at the logical 402 × 874 (device pixel ratio 2) and simulator screenshots (1206 px = 402 pt)
normalised to points; bright-content boxes measured per region (`scratchpad/cmp/measure.py`) and side-by-side overlays.
Root causes found and fixed:
- **Section logos were 1.55× too large**: iOS draws `KolabaLogo(size: 20.677, height: 23)` in every section header;
  32 / 45 is the Start page only. Now `.logo` is 20.677 / 23 and only `.start-logo` uses 32 / 45.
- **Sizes guessed instead of taken from `KolabaTypography`**: auth titles headingLarge 32 (not 36); inputs and search
  bodySmall 14 (not 16); legal links caption 12; social sign-in buttons Medium 14; View project / project buttons
  Medium 12; settings rows 15, values 14, place 12; Apply bar price Bold 14; chat previews light grey at 50 %; profile
  social counts 16; bio line height 20; no letter-spacing anywhere (iOS uses none).
- **Spacing**: profile figures had 8 pt extra under them; Reels avatar 48 (not 56), Follow 40, like pill 40, ••• 48 × 32;
  no permanent "muted" glyph on Reels (iOS has none).
- **Empty states** rebuilt as KolabaEmptyState: the PortfolioCardFan (100 × 120 centre card, 80 × 96 sides at ±15°,
  spring 0.58 s, pink +), Bold 16 / Light 14 at 50 %.
- **No double scaling**: the app has no vw / vh / clamp inside the screen; only `.phone` is scaled (70 % of the window
  height, centred). Viewport `maximum-scale=1` keeps 14 pt inputs from zooming on phones.
After the fixes, measured on job., creators., chat., profile, kolaba., Start and Create profile: headers, tabs, names,
cards, buttons, tab bar and auth blocks within ±1–2 pt of iOS (differences left come from different demo data).

Demo accounts: kept. The "DEMO" labels and demo wording were removed from the interface (the data flag stays in the
API for internal logic).
