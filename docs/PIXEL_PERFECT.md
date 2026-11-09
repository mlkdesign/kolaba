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
