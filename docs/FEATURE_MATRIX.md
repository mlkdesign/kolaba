# SwiftUI screen → Web screen → API

| iOS (SwiftUI) | Web | API v1 | Статус |
|---|---|---|---|
| StartPageView / Create profile / Log in / Verify e-mail | `AuthFlow` (start, signup, verify, login, forgot/reset) | `/auth/signup · verify · resend-code · login · logout · session · password/forgot · password/reset` | ✅ вход; регистрация ждёт ключ Resend |
| ProfileSetupView, Settings → Add business | `CreateProfile` | `POST /profiles` | ✅ (1 creator + ≤5 business) |
| Profile switch (FIX 72) | Settings → Profiles | `X-Profile-Id`, `/auth/session` | ✅ |
| ProjectsView (Job posts · Applied · Saved / My jobs) | `JobsScreen` | `GET /jobs?tab=` | ✅ |
| ProjectDetailsView, ProjectApplyBar | `JobScreen` | `GET /jobs/:id` | ✅ |
| ProjectApplySheet | `ApplySheet` | `POST /jobs/:id/apply`, `/jobs/applications/:id/withdraw` | ✅ (медиа — PRO) |
| ProjectEditorView | `JobEditor` | `POST/PATCH/DELETE /jobs`, `/jobs/:id/publish · close` | ✅ |
| ProjectApplicantsSection | `Applicants` | `GET /jobs/:id/applications`, `PUT …/shortlist` | ✅ |
| MessagesView / ChatView / Messages search | `ChatListScreen`, `ConversationScreen` | `/conversations…`, `/search?scope=messages` | ✅ (polling) |
| ReelsView | `ReelsScreen` | `GET /reels`, `PUT/DELETE /media/:id/like`, `POST /media/:id/view` | ✅ |
| NotificationsView (из Reels) | `NotificationsScreen` | `/notifications`, `/read`, `/read-all`, `/sync` | ✅ |
| CreatorsView | `CreatorsScreen` | `GET /profiles?type=&q=` | ✅ |
| My Contacts (All · Requests · Sent) | `ContactsScreen` | `/contacts…` | ✅ |
| MyProfileView / VisitorProfileView | `ProfileScreen` | `/profiles/:id`, `/media`, `/collections`, `/jobs` | ✅ |
| Portfolio / folders / Intro Video | `Portfolio`, `Collections`, Edit profile | `/media/uploads`, `/media/collections…` | ⏸ загрузка ждёт R2; просмотр ✅ |
| Reviews, Request a Review, review form, invites | `Reviews`, `RequestReview`, `ReviewForm`, `InviteScreen` | `/reviews…` | ✅ |
| Paywalls / PRO | бейджи, locked-карточки | entitlements в `/auth/session` | ✅ test entitlements (без оплаты) |
| Report / block | меню профиля и чата | `POST /reports`, `/admin/*` | ✅ жалобы; блокировки — через admin |
