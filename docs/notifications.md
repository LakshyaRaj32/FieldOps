# Notifications

> Status: **implemented in Phase 4 (Field Operations)**; push delivery needs a Firebase
> project, which is not configured in this repository. Not yet verified on a device (see
> [phase-status.md](phase-status.md#phase-4--field-operations)).

Three mechanisms, three jobs:

| Mechanism | For | Guarantee |
| --- | --- | --- |
| **Sync** (Phase 3) | Eventual consistency of the worker's data | Converges; the source of truth |
| **Realtime** (WebSocket) | Apps that are open right now | Best effort, hints only ([realtime.md](realtime.md)) |
| **Push** (FCM) + **inbox** | Things a person must know about, also when the app is closed | Inbox: durable. Push: best effort |

## Notification types

Decided in `apps/api/src/notifications/domain/notification-plan.ts` (pure, unit-tested):

| Type | Recipient | When |
| --- | --- | --- |
| `JOB_ASSIGNED` | The new assignee | A job is assigned or reassigned to them |
| `JOB_UNASSIGNED` | The previous assignee | A job is reassigned away from them |
| `JOB_CANCELLED` | The assigned worker | Their job is cancelled |
| `JOB_COMPLETED` | The manager who created the job | The worker completes it (also when replayed from an offline outbox) |
| `JOB_MESSAGE` | Worker's message → job creator; manager's message → assigned worker | A job message |

Nobody is notified of their own action. Starting a job, notes, photos and edits notify no one:
they reach open screens through realtime and everything through sync.

## Flow

```text
JobsService commit ─▶ DomainEvents ─▶ NotificationsService
                                        1. plan (who, what)
                                        2. INSERT notifications (the inbox: durable)
                                        3. for each recipient's active devices: FCM send
                                           └─ "unregistered" → delete that registration
```

Push runs after the commit, outside the request's transaction, and a failing FCM never fails
or delays the request. Before Phase 5 there is no retry queue: a push lost to an FCM outage
stays lost, but the inbox entry exists and sync delivers the data. BullMQ (Phase 5) adds
retries and backoff.

## Device tokens

Table `push_devices`, one row per **session** (a session is one signed-in device):

| Situation | Handling |
| --- | --- |
| Several phones per user | Several sessions, several rows |
| Token rotation (`onTokenRefresh`) | `PUT /notifications/devices/current` again: the session's row is updated |
| Same token registered by another session (phone changed hands, or signed in again) | The row moves to the new session (tokens are unique) |
| Sign-out | `session.ended` event → row deleted; the phone also calls `deleteToken()` |
| Revoked or expired session | Never pushed to (the send query joins active sessions), even before cleanup |
| FCM answers `UNREGISTERED` / 404 / invalid `message.token` | Row deleted |
| Other FCM errors (payload, quota, outage) | Logged; the registration is kept |

Tokens are validated (20–512 characters, `[A-Za-z0-9:_-]`) and never logged.

## Security

- **Payloads carry IDs only.** Push title and body are generic ("New job assigned" / "Open
  FieldOps to see the details."); `data` is `{ type, jobId, notificationId }`. No job title,
  customer, address, location or message text passes through Google or shows on a lock screen.
- The inbox (behind authentication) may show the job title.
- **Push data is untrusted input.** The app accepts only known types and UUID job IDs
  (`notificationRouting.ts`), then loads the job with the user's own credentials: a forged push
  can at most open a "not found" screen.
- The server sends only to the recipient's active sessions; every inbox endpoint acts on the
  caller's own rows (`404` for someone else's notification).
- The FCM service-account key is a server secret: `FCM_SERVICE_ACCOUNT_FILE` points to it; it
  is gitignored and never in the app. The app's `google-services.json` contains only public
  Firebase client identifiers (also gitignored, per developer).

## Delivery (server)

`FcmPushSender` calls the **FCM HTTP v1 API** directly: an OAuth 2.0 service-account assertion
signed RS256 with `@nestjs/jwt` (jsonwebtoken, already a dependency) is exchanged for an access
token (cached, renewed a minute early), then `messages:send`. The Firebase Admin SDK was not
added for one HTTP call (see [technology-decisions.md](technology-decisions.md#push-notifications-fcm-phase-4)).
Android options: `priority: high`, channel `jobs`.

Without `FCM_SERVICE_ACCOUNT_FILE` the API uses `DisabledPushSender` and says so at startup;
inbox and realtime still work.

## App

`apps/mobile/src/services/push/pushService.ts` wraps React Native Firebase (the only importer).
`app/providers/PushNotifications.tsx`:

| App state | What happens |
| --- | --- |
| **Foreground** | FCM does not show a system notification; the app refreshes (inbox, jobs) — the WebSocket usually already did |
| **Background** | Android shows the notification (channel "Jobs and messages"); a tap opens the job (`onNotificationOpenedApp`) |
| **Terminated** | Same display; a tap starts the app, which opens the job after the session is restored (`getInitialNotification` + a pending route in `navigationRef.ts`) |
| **Offline** | FCM delivers when the phone reconnects; the tap opens the job from SQLite, or shows "Looking for this job…" and syncs |

Tapping `JOB_UNASSIGNED` opens the inbox (the job is no longer the user's).

Permission: `POST_NOTIFICATIONS` (Android 13+) is requested after sign-in; if refused, push is
off (Profile › Live updates says so) and everything else works.

The Android channel `jobs` is created natively at application start (`MainApplication.kt`),
so a message arriving before the app was ever opened still has its channel.

## Inbox API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/notifications?limit&cursor` | Newest first, keyset pagination, `unreadCount` |
| `POST /api/v1/notifications/:id/read` | Mark one read (`404` if not yours) |
| `POST /api/v1/notifications/read-all` | Mark all read |
| `PUT /api/v1/notifications/devices/current` | Register this session's FCM token |
| `DELETE /api/v1/notifications/devices/current` | Stop push to this session |

**In the app** (UI/UX phase): the inbox is a compact list. Unread entries sit on the brighter
surface with a bold title, a filled colored icon and a dot, and screen readers hear
"Unread" first. Read entries use the page background, regular weight and an outline icon.
Tapping an entry marks it read and opens its job. **Mark all as read** changes only the read
state: entries stay in place, nothing navigates. Both actions update the cached inbox (and
the tab badge) at once, then call the API; if the call fails, the change is undone and an
inline message says so. The refetch that follows brings in the server's timestamps
(`markReadInPage` in `features/notifications/api/notificationsApi.ts`).

Not built (master plan "later" items): notification preferences, per-type mute, email/SMS.

## Setup (push)

1. Create a Firebase project (free). Add an Android app with package `com.fieldops.mobile`
   (and `com.fieldops.mobile.staging` if needed).
2. Download `google-services.json` to `apps/mobile/android/app/` (gitignored). The Gradle build
   applies the Google services plugin only when this file exists.
3. Firebase console › Project settings › Service accounts › Generate new private key. Save it
   outside git (for example `apps/api/firebase-service-account.json`, gitignored) and set
   `FCM_SERVICE_ACCOUNT_FILE` in `apps/api/.env`.
4. Rebuild the app. Profile › Live updates shows "Push notifications: On for this phone".

## Tests

- `notification-plan.spec.ts`: recipients, no self-notification, no content in push text.
- `fcm-push-sender.spec.ts`: signed assertion (verified with the public key), token caching and
  renewal, invalid-token detection, failures.
- `field-operations.e2e-spec.ts` › notifications: assignment → inbox + push with IDs only;
  completion (from an offline replay) → creator; reassignment → both workers, never others;
  messages; read/read-all/ownership; pagination; token rotation and move; invalid token
  removed; sign-out removes the device; token validation.
- `notificationRouting.test.ts`, `notificationsApi.test.ts` (app).
- **Not verified:** real FCM delivery and the three app states on a phone (no Firebase project
  and no device in the implementation session).
