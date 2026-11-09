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

## Round 4 — collapsing header, business profiles, stock pictures (2026-11-09)
- **CollapsingHeader** (`useCollapsingHeader` in `ui.tsx`, the web form of KolabaTabbedScroll): one scroll offset drives
  everything — the section title moves up with the content and fades over 48 pt (`startOfTravel(titleFade)`); the one
  row of tabs scrolls with the content, pins at 62 pt (centred on the 44 pt controls) and its sides move in from 16
  to 68 pt (16 + 44 + 8) together with the underline; a release inside the 62 pt travel ends collapsed or expanded
  (KolabaHeaderSnapBehavior: fling 150 pt/s, else the nearer end). Used where iOS has it: job., creators., chat.
  (title only, no tabs) and the profiles (tabs pin, inset over the last 60 pt, never snapping — FIX 109). Pages are at
  least the area under the pinned tabs (`pageMinHeight`) so every page can collapse. The top blur sits under the
  tabs and over the content (backdrop blur 12 px plus a soft second layer, darkening 0.7 → 0.25, masked so no edge
  shows) and never takes taps.
- **Business profile** (BusinessProfileHeader, Figma 770:5495 / 770:6286): its own top — the 120 pt round logo 25 pt
  under the safe area, name + blue PRO, place, a centred description with a blue Show more, figures, Edit / Share or
  Message / Follow; no 400 pt photo, no intro video, no networks row (FIX 94). Tabs Job posts · Reviews · About; Job
  posts with Active / Archive (blue chip and count) and Sort; About with Description, Location and the links. Blue
  accents and the business glow, shown only for PRO (also for creators, as iOS does). The type comes from the API.
- **Stock pictures (demo content only)**: 149 Unsplash photos (Unsplash License), each URL checked: a themed logo
  for every demo business, a 2–3 photo cover gallery for every demo job, portraits for the four demo creators who
  have no videos (the others keep a frame of their own video, so the face matches their Reels). Generated by
  `api/seed/stock-images.mjs` from `stock-images.txt`; the SQL touches `is_demo = 1` rows only, never replaces a set
  avatar and is idempotent. Real profiles keep their uploads or the empty state.

## Round 5 — portfolio, paywall, roles, settings, closed test (2026-11-09)
- **Portfolio / job posts filters** (ProfileFilterRow): All · Collections subtabs with counts (KolabaCountBadge), Sort,
  48 × 40 + only when there is content; empty state = card fan → title → line → white "Add content" pill (no + circle).
  Business: Active / Archive + Sort, empty "Create new job". Contacts subtabs carry counts and no longer flash the
  previous list on switch.
- **Paywall** (`web/src/paywall.tsx`, ProComponents.swift): creator.pro / business.pro, feature copy, benefits sheet,
  yearly / monthly plans with the iOS prices, Restore, legal links, rise + fade, pull to close. Nothing is sold on the
  web: the call says so; no fake purchase. Opened by locked Collections, Intro video, and someone's PRO badge for a
  non-PRO viewer of the same type.
- **Roles** (`web/src/roles.tsx`, AccountRoles.roleSwitchAlert): creator → create job, business → apply, own job seen
  from the creator side → iOS alert "Switch to … Profile?" or "Create a … Profile?" (→ Create profile, then continue).
  The server still refuses a creator publishing a job (e2e H).
- **Job details**: gallery opens the viewer for videos only; requirements are Location + Languages; no bottom date /
  views, no tags (editor keeps stored tags untouched); standalone pink "Apply now" (no price plate); applicants
  counter = listed applicants (only submitted applications of active profiles, both in the count and the list).
- **Settings** (iOS structure): account card, Notifications (6 switches, `GET/PUT /v1/me/settings`), Privacy & Safety,
  Language, Switch to Business / Creator account, Help, About, Log out, ⋯ → Delete account (`DELETE /v1/me`
  {confirm:"DELETE"}: every owned row, sessions and R2 files; demo accounts refused; audit log entry).
- **Chats**: long press → Mute, Mark as read, Delete chat (`DELETE /v1/conversations/:id` hides it and clears the
  history for this side only; the other side keeps everything; a new message brings it back empty).
- **Reels** exclude every profile of the viewer's own account. **Business** accents are blue (Message, rating bars,
  tab line). **Collapsing header**: tab switches restore each tab's own offset; the title is centred by insets (no
  half-pixel blur). **Mobile (no mockup)**: the screen is the viewport (100 dvh, safe-area insets), fluid by width.

### Closed test (temporary — revert before a public launch)
- `TEST_CODE_INBOX` (wrangler vars): all verification codes go to the owner's inbox with the target address in the
  subject; sign-up is open to any address while it is set. Such accounts get `users.email_verification =
  'test_inbox'` and are not treated as verified by their owners; existing accounts are not taken over (a code proves
  only control of the test inbox, sign-in still needs the account's password). Before launch: remove the var, and
  make `test_inbox` accounts re-verify.
- `PRO_TEST_EMAILS`: the only accounts that see `{type}.pro (Testing)` in Settings (`PUT /v1/me/pro-test`, 403
  otherwise; subscriptions source `test`).
- The tester account's password was set as a PBKDF2 hash only (never in git or the client); it is temporary and must
  be changed by its owner.
- `api/seed/test-account-reviews.mjs`: 10 demonstration reviews (9 × 5, 1 × 4 → 4.9) from ten different demo
  businesses to the tester's creator profile, idempotent (`INSERT OR IGNORE`, fixed ids). They are demo content, not
  confirmed collaborations.
- E2E scenario L (16/16 on production): settings persist, PRO test switch and account deletion refused to demo
  accounts, deleted chat clears one side only, own profiles not in Reels. Account deletion itself was verified on a
  local disposable account (rows gone, sessions revoked, others untouched).

## Round 6 — layers, blur, galleries, empty profile (2026-11-09)
- **Top blur** (`TopBlur` in `ui.tsx`): KolabaTopBlur's progressive blur — four stacked 4 px backdrop blurs with ramps
  ending at 100 / 75 / 50 / 25 % (radius 8 at the top → 0, no edge) over the 70 → 50 → 0 % darkening; at least 100 pt.
  On screens with pinned tabs the band lives *inside* the scroll view as a zero-height sticky anchor (z 21), so the
  pinned tabs (z 22) are always above it in one stacking context — also in Safari's composited scrolling (the cause of
  tabs drawn under the blur); there it reaches 64 pt under the safe area, so content passing under the tabs is blurred.
- **Sections** are each a backdrop root (`clip-path` + `isolation` on `.pager__page`): blur and brightness never change
  when a slide starts or ends (late darkening, titles briefly under the blur). The bottom gradient fades instead of
  vanishing on Reels.
- **Profile glow** is part of the page (inside the scroll): it scrolls away, above the blur like iOS's chrome layer.
- **No pull-to-refresh** imitation; `overscroll-behavior: none` on phones (no browser refresh or rubber band).
- **Galleries**: a gallery owns drags that start inside it (it used to ignore itself) — swipe with finger or mouse,
  spring settle, no fullscreen for job photos.
- **Profile photos**: creators up to 10 (hero pager with dots; Edit profile strip: Make profile photo / Remove / +);
  businesses one logo (+ replaces; the server allows no second photo and retires the replaced one).
- **Empty My Profile** (Figma 707:3736 …): Add Profile Photos, Add location, Add bio, the Add links card, Collabs ·
  Rating "–" · Contacts, Collections locked (lock, no count, paywall), card fan ▶ / photos for the portfolio.
- **Video length** on every video tile from the API or the file's own metadata (never a made-up value).
- **Links & Contact** sheet (KolabaContactsSheet): Social Media · Contact · More Links, each platform once, Telegram /
  WhatsApp / Email, original marks; Edit profile has YouTube, Telegram, WhatsApp, Email fields.
- **Location**: one field — "Ukraine, all cities" or "Kharkiv, Ukraine" (countries in en/uk/ru, big cities, typed
  "City, Country"); no Niche field anywhere.
- **Phones**: theme-color / page background #0B0B0B, dark color-scheme.
- **API**: a login to a not yet verified account sends its code at once (it used to need Resend); PRO test switch also
  for accounts verified through the closed-test inbox; one business photo.

## Round 7 — one fixed top blur, native galleries, paywall glass, Microsoft Clarity (2026-11-09)
- **Three layers** (`app.tsx`): 1) the sections' scrolling content (the pager); 2) the app's ONE top blur
  (`.app-blur`, z 30) — there from the first frame, never moving, never re-created by a slide, no scroll dependency
  (My Profile's scroll ramp is gone); 3) the header layer (z 31): a slot per section, sliding exactly like the pager,
  into which each section portals its header, pinned tabs (`PinnedTabs`, moved by `--tabs-dy` from the collapsing
  scroll, a same-size placeholder left in the content) and photo dots (`InHeader`). Titles, Filter, Search and tabs
  are therefore always over the blur; collapsing moves only their geometry. Pushed screens keep their own blur.
- **Galleries** are native horizontal scroll views with `scroll-snap` (touch, trackpad and wheel with the browser's
  inertia) plus mouse drag (settles on the nearest picture, flick to the next); dots follow; drags inside never reach
  the inner pages or the sections; job photos never open full screen.
- **Paywall**: the sheet is the glass cards' backdrop root from the first frame (`clip-path`) — before, its fade-in
  opacity made it one only during the animation, so the cards' blur switched sources (and "popped") when it ended.
- **Microsoft Clarity** (web project `zaxrlwua97`): the official tag once in `index.html`, only with consent (Settings
  → Privacy & Safety → Usage analytics; off under GPC / DNT); CSP allows `*.clarity.ms` and `c.bing.com`; SPA screens
  named via `clarity('set','screen',…)` + events (`src/analytics.ts`), paywall events; auth, chats, notifications,
  settings, forms and every sheet carry `data-clarity-mask`. No user id or e-mail is sent. Privacy Policy updated.
- **iOS**: Clarity SDK 4.1.2 (SPM `microsoft/clarity-apps`), `KolabaAnalytics` starts it in `KolabaApp.init()` only with
  a **mobile** project id in Info.plist `KolabaClarityProjectID` (empty until that project exists) and consent;
  section / screen names and paywall events; `clarityMask()` on auth, chats, messages, notifications and settings.

## Round 8 — tabs geometry, KOLABA confirmations, Switch accounts, PRO switch (2026-11-09)
- **Tabs (root cause)**: the floating tabs are placed from a placeholder left in the content. The tab classes carry
  `top: var(--safe-top)` (for sticky); the placeholder was `position: relative`, so it took that offset and every row
  of tabs sat one safe area too low (62 pt in the mockup), over the subtabs and cards under it. The placeholder is now
  static; the tabs' place is also recomputed whenever anything above them changes size (ResizeObserver on every child
  of the scroll view, fonts), and they stay hidden until placed. The sections' band reaches 28 pt under the pinned tabs
  at full strength there, so content passing under them is blurred out of the way.
- **Confirmations** (`confirmDialog` in `ui.tsx`, used by every alert): the iOS 26 alert in KOLABA colours — 300 pt
  dark glass card, radius 34, title / message, two full-width 48 pt capsules stacked (action tinted: blue for the
  business switch, pink for the creator one; destructive in red), scale-and-fade in and out.
- **Switch accounts** (SwitchAccountsSheet + KolabaGlassModalContainer): 6 pt inset glass modal, radius 34, grabber,
  title, round glass close; 56 pt rows radius 20, active lit with the green check, others with a caret; 21 pt
  separator; Add business account → Create Business Profile; pull down to close.
- **PRO (Testing)**: SettingsToggleRow with the crown, 15 / 12 pt text, and the iOS 26 switch (63 × 28, capsule thumb,
  pink when on); moves at once, the server decides, reverts on an error.
