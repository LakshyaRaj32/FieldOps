# Authentication and Sessions

> Status: **implemented in Version 2.** Email and password sign-in, short-lived access tokens,
> rotating refresh tokens with reuse detection, server-side sessions, role-based authorization
> foundation, and Keystore-backed token storage on Android.

This document describes how authentication works end to end, why it is built this way, and
what is deliberately left for later versions. API conventions (envelope, error codes) are in
[api.md](api.md). The tables are described in [database.md](database.md).

## 1. Overview

```text
 Mobile app                                   API (NestJS)                       PostgreSQL
 ──────────                                   ────────────                       ──────────
 Register / Login ── email + password ──────▶ validate DTO
                                              verify Argon2id hash
                                              create session ─────────────────▶ sessions row
                                              (id, SHA-256 of refresh token,     (hash only)
                                               expiry, user agent)
               ◀── user + access + refresh ── sign access JWT (15 min)
                                              sign refresh JWT (session expiry)
 store tokens in Android Keystore
 Redux: signedIn(user)  → main app

 GET /auth/me ── Bearer access token ───────▶ verify JWT (HS256, iss, aud, exp)
                                              load session + user ────────────▶ PK lookup
                                              reject if revoked / expired /
                                              user disabled
               ◀── { success, data: user } ──

 (access token expired)
 any request ◀── 401 ACCESS_TOKEN_EXPIRED ──
 POST /auth/refresh ── refresh token ───────▶ verify refresh JWT
   (single flight,                            session current? hash matches?
    then retry once)                          rotate hash atomically ─────────▶ UPDATE ... WHERE hash = old
               ◀── new access + refresh ──
 persist new pair, retry the request

 POST /auth/logout ── Bearer access token ──▶ revoke session (reason LOGOUT) ──▶ revoked_at = now()
 clear Keystore, Redux signedOut → sign-in screen
```

## 2. Endpoints

All under `/api/v1/auth`. Every endpoint except `logout` and `me` is public.

| Method and path | Auth | Success | Notable errors |
| --- | --- | --- | --- |
| `POST /register` | none | `201` `{ user, tokens }` | `400 VALIDATION_ERROR`, `409 EMAIL_ALREADY_REGISTERED` |
| `POST /login` | none | `200` `{ user, tokens }` | `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `403 ACCOUNT_DISABLED` |
| `POST /refresh` | refresh token in body | `200` `tokens` | `401 REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED`, `SESSION_REVOKED`, `SESSION_EXPIRED`; `403 ACCOUNT_DISABLED` |
| `POST /logout` | Bearer | `204` (no body) | `401` (any access token failure) |
| `GET /me` | Bearer | `200` user | `401 UNAUTHENTICATED`, `ACCESS_TOKEN_EXPIRED`, `ACCESS_TOKEN_INVALID`, `SESSION_REVOKED`, `SESSION_EXPIRED`; `403 ACCOUNT_DISABLED` |

`GET /api/v1/users` (ADMIN only) is the reference example for role-based authorization.

## 3. Passwords

- **Argon2id** through the `argon2` library, with the first OWASP profile: 19 MiB memory,
  2 iterations, parallelism 1. The parameters are stored inside each hash (PHC string), and
  hashes created with older parameters are upgraded on the user's next successful login
  (`needsRehash`).
- Why Argon2id rather than bcrypt: it is memory-hard (resists GPU/ASIC cracking), it is the
  current OWASP recommendation, and it has no input-length truncation (bcrypt ignores
  everything after 72 bytes).
- **Policy** (NIST SP 800-63B): 8 to 128 characters, no composition rules, never trimmed. The
  upper bound stops a request from making the server hash megabytes.
- **Login does not reveal which emails exist.** An unknown email and a wrong password return
  the same `401 INVALID_CREDENTIALS`, and for an unknown email the server still verifies the
  password against a dummy hash so response times match. `ACCOUNT_DISABLED` is only revealed
  after a correct password.
- Registration does reveal whether an email is registered (`409`); a sign-up form has to say
  so. Rate limiting (V11) is the mitigation against enumeration through it.
- Self-registration always creates a `WORKER`. Unknown body fields are rejected, so
  `"role": "ADMIN"` in a registration request fails validation.

## 4. Tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Format | JWT, HS256 | JWT, HS256 |
| Secret | `JWT_ACCESS_SECRET` | `JWT_REFRESH_SECRET` (must differ) |
| Audience | `fieldops:access` | `fieldops:refresh` |
| Lifetime | `ACCESS_TOKEN_EXPIRATION` (15 min) | `REFRESH_TOKEN_EXPIRATION` (30 days, sliding) |
| Claims | `sub` (user ID), `sid` (session ID), `role`, `iss`, `aud`, `iat`, `exp` | `sub`, `sid`, `jti` (random), `iss`, `aud`, `iat`, `exp` |
| Stored by the server | nothing | SHA-256 hash in `sessions.refresh_token_hash` |
| Stored on the phone | Android Keystore (encrypted) | Android Keystore (encrypted) |

- **No personal data in tokens.** JWT payloads are only base64-encoded. There is no email or
  name in either token.
- **Verification pins everything**: algorithm (`HS256` only, which prevents algorithm-confusion
  attacks), issuer, audience and expiry. Different secrets *and* audiences mean an access token
  is never accepted as a refresh token or the other way round (both cases are tested).
- **Why HS256** (the V0 design suggested asymmetric keys): in V2 the API is the only issuer and
  the only verifier, so a shared secret is simpler and equally safe. Asymmetric signing
  (EdDSA/RS256 with key IDs) becomes worthwhile when another service must verify tokens without
  being able to issue them, or for zero-downtime key rotation. Revisit in V18.
- **Why the refresh token is a JWT** rather than an opaque random string: it carries its session
  ID, so the server finds the session by primary key and can tell "genuine but already rotated"
  apart from "forged" (see reuse detection below). Its security still rests on the database:
  a valid signature alone is never enough.
- **Why SHA-256 and not a password hash** for the stored refresh token: the token is already
  high-entropy random data, so a slow hash adds nothing, and bcrypt would silently truncate a
  JWT at 72 bytes. Comparisons are constant-time.

### Access tokens are checked against the session

After the JWT is verified, the guard loads the session and its user by primary key and rejects
the request if the session is revoked or expired or the user is disabled. The principal it
attaches (`userId`, `sessionId`, `role`) uses the role **from the database**.

Trade-off: one indexed lookup per authenticated request. In exchange, logout, reuse-triggered
revocation and account deactivation take effect immediately instead of after up to 15 minutes,
and role changes apply to existing sessions at once. If this lookup ever shows up in profiles,
V10 can cache it in Redis with invalidation on revoke.

## 5. Sessions

One row in `sessions` per signed-in device (per login or registration):

| Column | Purpose |
| --- | --- |
| `id` | UUIDv7, also the `sid` claim in both tokens |
| `user_id` | Owner (FK, cascade on user delete) |
| `refresh_token_hash` | SHA-256 of the **current** refresh token only |
| `user_agent` | Truncated header, to help a user recognize a session later. Nothing else about the device is collected |
| `created_at`, `last_used_at` | Auditing; `last_used_at` moves on every refresh |
| `expires_at` | Sliding expiry: every successful refresh pushes it forward by `REFRESH_TOKEN_EXPIRATION` |
| `revoked_at`, `revoked_reason` | `LOGOUT`, `LOGOUT_ALL` or `REFRESH_TOKEN_REUSE` |

- **Multiple devices**: each login is independent. Logging out on one device leaves the others
  signed in (tested).
- **Logout** (`POST /auth/logout`) revokes the session named by the access token's `sid`. It is
  idempotent.
- **Logout everywhere** is prepared: `AuthService.logoutAll()` and
  `SessionsService.revokeAllForUser()` exist (reason `LOGOUT_ALL`, served by the `user_id`
  index). Exposing `POST /auth/logout-all` is a one-method controller change when a client
  needs it.
- **Sliding vs absolute expiry**: a worker who opens the app at least once a month stays signed
  in. An absolute maximum session age (for example 90 days regardless of use) is a V18
  hardening option.
- **Auditing**: the session rows already record who signed in, when, from which user agent,
  when the session was last used, and how and when it ended. A general append-only
  `audit_log` arrives with Phase 5 security work ([backend-architecture.md](backend-architecture.md#13-audit-logging)).

## 6. Refresh token rotation and reuse detection

Every successful refresh **replaces** the refresh token: the old one becomes useless and the
response carries a new pair.

`POST /auth/refresh` runs these checks in order:

1. **Genuine?** Verify the JWT (signature, `HS256`, issuer, refresh audience, expiry). If not:
   `401 REFRESH_TOKEN_INVALID`.
2. **Session usable?** Load the session named by `sid`. It must exist and belong to `sub`
   (`REFRESH_TOKEN_INVALID`), not be revoked (`SESSION_REVOKED`), not be expired
   (`SESSION_EXPIRED`), and its user must be active (`403 ACCOUNT_DISABLED`).
3. **Current token?** Compare the SHA-256 of the presented token with the stored hash
   (constant time).
   - **Match**: rotate.
   - **No match**: the token is genuine (step 1) and belongs to this session, so it can only be
     a token this session already rotated away. Someone is replaying an old token: either an
     attacker who stole it, or the legitimate app replaying after the attacker already used it.
     We cannot tell which, so **the whole session is revoked** (`REFRESH_TOKEN_REUSE`) and the
     response is `401 REFRESH_TOKEN_REUSED`. Every token of that session, including the newest
     pair, stops working, and the legitimate user signs in again.
4. **Rotate atomically.** A compare-and-swap update
   (`UPDATE sessions SET refresh_token_hash = new ... WHERE id = sid AND refresh_token_hash = old
   AND revoked_at IS NULL`). If it updates no row, another request rotated this token first,
   which means the same token was presented twice: this is also treated as reuse.

No history of old tokens is needed: a genuine token for this session whose hash is not the
current one is, by construction, an old one.

**Consequence for clients: refreshes must never race.** Two refreshes with the same token look
exactly like theft. The mobile app therefore shares one in-flight refresh between all
concurrent requests (single flight). There is no grace period for a lost response (for example
the phone loses signal after the server rotated but before the response arrived). In that case
the user has to sign in again. A short grace window is a possible V13 reliability improvement,
at some cost to reuse detection.

## 7. Authorization foundation

- **Authentication is on by default.** `JwtAuthGuard` is a global guard; routes opt out with
  `@Public()`. A forgotten decorator therefore fails closed.
- **Role gate.** `@Roles(Role.MANAGER, Role.ADMIN)` on a route or controller, enforced by the
  global `RolesGuard` after authentication. `401` means "we don't know who you are", `403`
  means "we know, and the answer is no".
- **Roles**: `WORKER`, `MANAGER`, `ADMIN`. The Prisma enum and `@fieldops/types` are checked
  against each other at compile time.
- Granting roles: there is no role-management API yet. Operators use
  `npm run user:set-role -w @fieldops/api -- <email> <ROLE>`.
- Not yet: permissions (`job:assign`), resource policies ("is this worker assigned to this
  job?") and tenancy. They arrive with the resources they protect (jobs in Phase 2; organizations later),
  as described in [backend-architecture.md](backend-architecture.md#9-authorization).

## 8. Mobile app

| Concern | Where | Notes |
| --- | --- | --- |
| Token storage | `services/storage/secureStorage.ts` | `react-native-keychain`: AES-GCM with a key held in the Android Keystore (hardware-backed where available), no biometric prompt so background refresh works. `allowBackup="false"` keeps it out of backups |
| Credential ownership | `services/auth/credentialStore.ts` | The only code that reads or writes tokens. Secure storage is the source of truth; an in-memory copy serves synchronous header reads |
| Session state | `store/slices/sessionSlice.ts` | `restoring`, `signedOut` (with reason) or `signedIn` (with the user profile). **No tokens** |
| HTTP | `services/api/baseQuery.ts` | Adds `Authorization`, unwraps the envelope, single-flight refresh on `401`, one retry |
| Endpoints | `features/auth/api/authApi.ts` | Login/register write tokens straight into the credential store (`queryFn`); only the user profile reaches Redux. They run untracked so the password argument is not kept in the store |
| Flows | `features/auth/session.ts` | `restoreSession` (start-up), `signOut` |

- **Tokens never enter Redux**: not in state, not in action payloads, not in the RTK Query
  cache. A test serializes the whole store after sign-in and asserts that neither token nor
  the password appears.
- **Start-up**: while the stored session is read, the navigator renders a loading screen. With
  stored credentials the app opens signed in immediately, using the last known profile, so a
  field worker without signal can still work. It then revalidates with `GET /auth/me`: a new
  profile is applied, a rejected refresh signs the user out, and offline keeps the session.
- **Refresh outcomes**: `4xx` from `/auth/refresh` means the server ended the session, so
  credentials are cleared and the sign-in screen shows "Your session has ended". A network
  error or `5xx` is transient: the session is kept and the request fails normally.
- **Sign-out** calls `POST /auth/logout`, then clears local credentials even if the call failed
  (offline). The orphaned server session then expires on its own.
- **Messages**: the app maps error codes to its own copy (`utils/errors.ts`) and never shows
  server text for `5xx` errors.

## 9. Security checklist (V2)

| Control | Status |
| --- | --- |
| Password hashing (Argon2id, upgradeable parameters) | Done |
| No plaintext refresh tokens at rest on the server (SHA-256) | Done |
| Tokens encrypted at rest on the device (Keystore) | Done |
| Short access-token lifetime, pinned algorithm, issuer and audience | Done |
| Refresh rotation, reuse detection, session revocation | Done |
| Authentication by default (global guard), role guard | Done |
| DTO validation with unknown fields rejected; values never echoed | Done |
| Safe errors: stable codes, no stack traces, no database or framework messages | Done |
| Secrets only from the environment, validated at start-up; placeholders refused outside development | Done |
| No passwords, hashes or tokens in logs (access log has method, path, status, duration, request ID; Prisma query logging off) | Done |
| `helmet` security headers, no `X-Powered-By` | Done |
| CORS off unless explicit origins are configured (never `*`) | Done |
| JSON body size limit (Express default 100 kB) | Done |

## 10. Future work

### Rate limiting (V11)

The custom distributed limiter arrives in V11. These endpoints are its first targets:

| Endpoint | Threat | Planned keys |
| --- | --- | --- |
| `POST /auth/login` | Credential stuffing, password guessing | IP and normalized email, with a stricter per-email budget |
| `POST /auth/register` | Account enumeration (`409`), mass sign-ups | IP |
| `POST /auth/refresh` | Token brute force, runaway client loops | IP and session ID |
| `POST /auth/logout`, `GET /auth/me` | Low risk | General per-user budget |

The client already maps `429` to a friendly message.

### Remaining security work

This version is a sound foundation, **not** a production-hardened system. Known gaps:

- **Rate limiting and lockout** (V11): until then, login can be brute-forced at network speed.
- **Email verification, password reset, password change** (with "revoke all other sessions"):
  not implemented.
- **Audit log** of authentication events (Phase 5), and alerting on `REFRESH_TOKEN_REUSE`.
- **Key management** (V18): asymmetric signing with key IDs and rotation; secrets in the
  platform's secret manager (V16).
- **Absolute session lifetime** and an idle timeout separate from the sliding expiry.
- **Refresh grace window** for lost responses (V13, see section 6).
- **Session list and remote sign-out** in the app (`GET /auth/sessions`, `POST /auth/logout-all`).
- **Tenancy**: users are not yet scoped to organizations (V3); the admin user list is global.
- **Transport**: HTTPS is required for staging and production builds (enforced by the mobile
  config), but certificate pinning and HSTS preload are V18 topics.
- **Device security**: rooted-device detection and local database encryption (V5/V18).
- **Dependency and container scanning** in CI (V16).
- **Threat model review and penetration test** (V18).
