# Live co-editing with presence

Teams write applications together: an executive director, a program lead and a consultant in the
same draft. Both applicant editors show it live:

- **Who is here.** The people in the draft right now, as initials at the top (name on hover and in
  the label a screen reader reads).
- **Where each person is.** A small "{name} is editing" chip (pencil icon and words) at the section
  in the editor's rail and at the question they are in. In an outside application, at the question.
- **Soft lock.** While someone types in a question, the others see it read-only with "Being edited by
  {name}" (lock icon and words). It lets go when they leave the question, after 60 seconds without a
  keystroke (`LOCK_IDLE_MS`, the one constant), or when they leave the draft. A question this person
  is already in is never locked under them.
- **Live updates.** When someone saves, the others read the answer again through the API within
  seconds, without reloading. What a person is typing is never overwritten: their unsaved changes are
  replayed on top of the new state (the rule of the v1.11.0 scoring-screen fix: the server's answer
  fills only what this person has not changed). If both changed the same question, theirs stays on
  screen with "{name} changed this", and **View their version**, **Use their version** and **Keep
  mine**.
- **Degrades cleanly.** Without the live channel (no pass, a dropped connection, Realtime switched
  off) the editor works exactly as before, saving field by field, and says quietly "Live updates are
  paused".

The lock is a courtesy, not a guard. The API merges saves field by field whoever holds a lock, as it
always has; the lock only keeps two people from typing over each other in the first place.

## Same reach as reading

The people who see each other are exactly the people who may open the draft: the applicant's team
and the consultants or cowriters the draft names. Reviewers and funders never see an applicant's
presence. A draft is the applicant's until it is submitted, and a funder's side reads an application
only after that.

## How it works

The transport is **Supabase Realtime** with **Realtime Authorization** (private channels and Row
Level Security on `realtime.messages`), already part of the stack (Supabase Auth signs people in).
See `docs/decisions.md` (2026-11-17, live co-editing) for why not a Cloudflare Durable Object.

1. The editor asks the API for a pass: `POST /gms/presence/passes` with
   `{ draft: { kind: "application" | "outside_application", id } }` (api/presence.tsp,
   `apps/api/src/services/presence.ts`). The API runs the same check that opens the draft:
   `access()` for a built-in application (applicant side only, draft or revision requested) and
   `loadOutside(…, { cowriter: true })` for an outside one. It refuses agents and API clients
   (`person_required`): presence is for people. The pass is bound to the person's Supabase Auth
   session (`session_id` of the access token), names one topic (`draft:application:<uuid>` or
   `draft:outside:<uuid>`), lives 10 minutes (`PRESENCE_PASS_TTL_MS`) and says whether the session
   may write (`applications:write`).
2. The editor joins the topic as a **private** channel. Realtime evaluates the policies of migration
   0050 on `realtime.messages`: a session may receive broadcast and presence, and track its presence,
   only with a live pass for that topic whose membership in the draft's workspace still stands
   (`gms.presence_pass_ok`, `gms.is_member`); it may send a broadcast (a lock, a saved nudge) only
   with a pass that may write.
3. While the editor is open it renews the pass every 4 minutes (`PRESENCE_PASS_RENEW_MS`); each
   renewal runs the access check again, and a refused renewal makes the editor leave the channel. The
   Realtime client takes the app's current access token on connect and on every heartbeat, so
   Realtime checks the policies again whenever the token is renewed.

What travels on the channel (`apps/web/src/lib/presence.ts`):

| | What | Never |
|---|---|---|
| Presence | `userId`, `name`, the section and question the person is in | an answer |
| Broadcast `lock` | who holds which question, or that they let go | an answer |
| Broadcast `saved` | who saved which form or question, and which fields | an answer |

Answers are read again through the API, which checks again on every read.

A name and a place on the channel are what each person's app says; the pass decides who may be on
the channel at all, so only the people who may open the draft can say anything there.

## Limits and rules (verified 2026-11-17)

From Supabase's documentation:

- Realtime Authorization: "the validation is done when the user connects… Client access policies
  are cached for the duration of the connection… Realtime updates the access policy cache for a client
  … when a client connects to Realtime and subscribes to a Channel [or] a new JWT is sent to Realtime".
  A revoked user keeps receiving "until their JWT expires or a new one is sent", so the JWT expiry
  should be short. RLS is already on for `realtime.messages`; a migration must not `alter table … enable
  row level security` (it fails with `42501 must be owner`). To enforce private channels, turn off
  **Allow public access** in Realtime settings.
  <https://supabase.com/docs/guides/realtime/authorization>
- Limits per project (Free / Pro): 200 / 500 concurrent connections, 100 / 500 messages per second,
  100 channels per connection, 20 / 50 presence messages per second, **5 presence calls per client
  per 30 seconds**, broadcast payload 256 KB / 3,000 KB. The editor says where a person is at most
  once every 6.5 seconds (`PRESENCE_TRACK_EVERY_MS`) and sends locks and saves by broadcast, which the
  presence guide recommends for anything that changes often.
  <https://supabase.com/docs/guides/realtime/limits>, <https://supabase.com/docs/guides/realtime/presence>

How long someone removed from the team can still see presence. Realtime checks the policies when a
person joins and whenever a new access token is sent, not on every message, so:

- **The editor leaves at once** when any API call for that draft answers 403 or 404 (a save, reading
  the draft again after a teammate's save, inserting from the library, submitting, an outside
  application's answer, reload or stage change: `LEAVE_CHANNEL_ON_STATUS`, `apiFailed` in
  `apps/web/src/lib/presence.ts`), and stays out while that draft is open. The next pass renewal
  (every 4 minutes) is refused too, and leaves as well.
- **The window that remains** is for a client that makes no API call and does not leave (an idle
  tab, or a modified client): it keeps receiving presence and lock notices (names and the question
  each person is in, never an answer: answers are read through the API, which refuses it) until its
  access token is renewed or expires, at most the project's JWT expiry (an hour by default; 15
  minutes or less is advised below), when Realtime checks the policies again and refuses it.

## Setup (owner)

- Migration `0050_co_editing.sql` before the API. On a database without `realtime.messages` it skips
  the policies with a notice and the editors run with live updates paused.
- Supabase dashboard › Realtime › Settings: turn **Allow public access** off, so only private
  channels can be joined (the GMS uses no public channels).
- Keep Realtime enabled (docs/self-host.md). Consider a JWT expiry of 15 minutes or less (Auth ›
  Sessions) so a revoked session's open channel is refused sooner.
- No new secret, variable or vendor. The web app already reaches the Supabase project's WebSocket
  (`apps/web/build/headers.ts`).

## Tests

- `supabase/tests/database/50_co_editing.test.sql`: passes and the realtime policies, as Realtime
  checks a join (a pass opens one topic for one session; expired, other session, removed or expired
  membership, the funder, another workspace and visitors are refused; readers cannot send).
- `apps/api/test/presence.test.ts`: who gets a pass.
- `apps/web/test/co-editing.test.tsx`: the lock rules, who joins, both editors, degraded mode,
  leaving the channel on a 403 or 404 (and not on a 503), axe in English and Spanish.
  `apps/web/test/presence-transport.test.tsx`: the private channel and the presence limit.
  `apps/web/test/realtime-channels.test.ts`: every channel any app or package opens is private, none
  is built by hand and nothing listens for `postgres_changes` (v1.13.0: the editor's old public
  channel, `api/applicantRealtime.ts`, was removed).
- `apps/web/e2e/flow36-co-editing.spec.ts`: two people in two browser contexts. In mock mode the
  channel is an in-page hub (`apps/web/src/mocks/presence.ts`), relayed between the contexts.
