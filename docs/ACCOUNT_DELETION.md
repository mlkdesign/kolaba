# Account deletion — the two modes (FIX 131)

| | **Delete account** (admin, box unchecked) | **Delete all data** (admin box checked · Settings → Delete account in the app) |
|---|---|---|
| Sign-in | Stops; sessions end | Stops; sessions, devices, Google identities and reset codes removed |
| E-mail | Kept, freed for a new sign-up (`released_email`) | Replaced by an unusable placeholder; nothing kept |
| Profiles | Hidden (`admin_hidden_at`), data untouched | Tombstone "Deleted account": ids kept, names, bio, place, links, settings, PRO removed |
| Media and files (R2) | Kept | Every file the account uploaded removed (media, posters, chat photos / videos, voice, files, review attachments, feedback attachments); rows marked unavailable |
| Chats | Hidden with the profile | Kept for the other person: text stays under "Deleted account", the deleted sender's attachments show "Media unavailable", no new messages (410 `account_deleted`) |
| Jobs | Hidden with the profile | Status `removed`, off every feed; kept for the admin with the title only (description cleared, media removed) |
| Applications it sent | Hidden | Withdrawn, text and chosen videos removed |
| Reviews | Hidden | Received reviews removed; reviews it wrote stay (other people's ratings) under "Deleted account" |
| Contacts, follows, likes, notifications to it | Kept | Removed |
| Reports it filed | Kept | Kept for moderators, without the reporter |
| Restore | Yes (unless a new account took the e-mail) | Never |
| Same e-mail later | New account; the old one keeps its data | New account with a new id; nothing of the old one |

**Operation** (`src/lib/erase.ts`, table `account_deletions`): requested → processing → completed, or failed (Retry in the
admin panel). Access ends first, the R2 objects are listed (`account_deletion_files`) before any row changes, the rows
are anonymized, then each file is removed and marked. Every step is idempotent; a retry skips what's done. Files are
only ever the deleted account's own (by `owner_profile_id` / sender) — what someone else sent to it stays theirs.

**Caches:** R2 objects are served through the Worker (no edge cache), so a removed file is gone at once; the app drops
a video's local copy when the server stops serving it and clears all copies on log out.
