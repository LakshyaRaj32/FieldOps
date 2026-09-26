# API Conventions

> Status: **Version 2.** Applies to every endpoint of the FieldOps API.

## Base URL and versioning

| Path | Contents |
| --- | --- |
| `/api/v1/...` | The versioned REST API (URI versioning via NestJS `enableVersioning`) |
| `/health/live`, `/health/ready` | Unversioned platform probes |
| `/api/docs` | Swagger UI (not in production unless `SWAGGER_ENABLED=true`) |
| `/api/docs-json` | OpenAPI document |

A breaking change ships as `/api/v2/...` next to v1. Additive changes (new optional fields,
new endpoints) stay in v1.

## Response envelope

Every JSON response has the same outer shape. The TypeScript types live in
`@fieldops/types` (`packages/types/src/api.ts`) and are shared by the API and the app.

**Success**

```json
{
  "success": true,
  "data": { "id": "…", "email": "worker@example.com" }
}
```

`204 No Content` responses (logout) have no body.

**Error**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password.",
    "requestId": "mbx2k1-4f8a9c2e"
  }
}
```

Validation errors add `details`:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are missing or invalid.",
    "details": [
      { "field": "email", "message": "Enter a valid email address." },
      { "field": "password", "message": "Password must be at least 8 characters." }
    ],
    "requestId": "…"
  }
}
```

Rules:

- Clients branch on `code`, never on `message`. Codes are stable; messages may change.
- `message` is safe to show to users, but the mobile app uses its own copy per code.
- Stack traces, database errors and framework messages are never returned. Unexpected
  failures return `500 INTERNAL_ERROR` with a generic message, and are logged server-side with
  the request ID.
- Submitted values are never echoed in validation messages (passwords).

**Why an envelope instead of RFC 9457 Problem Details** (the V0 plan): the V2 brief asked for
one consistent `success`/`data`/`error` structure, and the envelope gives both success and error
bodies the same discriminant. The information Problem Details would carry (a stable code, a
readable message, the request ID) is all present.

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid or unknown fields; see `details` |
| `BAD_REQUEST` | 400 | Malformed request, for example invalid JSON |
| `UNAUTHENTICATED` | 401 | No access token on a protected endpoint |
| `ACCESS_TOKEN_EXPIRED` | 401 | Refresh the token and retry |
| `ACCESS_TOKEN_INVALID` | 401 | Malformed, forged, or not an access token |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (the same for both) |
| `REFRESH_TOKEN_INVALID` | 401 | Malformed, forged or expired refresh token |
| `REFRESH_TOKEN_REUSED` | 401 | An already-rotated refresh token was presented; the session is revoked |
| `SESSION_REVOKED` | 401 | The session was signed out or revoked |
| `SESSION_EXPIRED` | 401 | The session reached its expiry |
| `ACCOUNT_DISABLED` | 403 | The user is deactivated |
| `FORBIDDEN` | 403 | Authenticated, but the role is not allowed |
| `NOT_FOUND` | 404 | Unknown route or resource |
| `EMAIL_ALREADY_REGISTERED` | 409 | Registration with an existing email |
| `CONFLICT` | 409 | Generic conflict |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit (100 kB) |
| `INTERNAL_ERROR` | 500 | Unexpected failure; see server logs with the request ID |
| `SERVICE_UNAVAILABLE` | 503 | A dependency (the database) is down; readiness probe |

The runtime list (`apps/api/src/common/errors/error-codes.ts`) is checked at compile time
against the shared union type, so the two cannot drift.

## Request correlation

Clients may send `X-Request-Id` (the mobile app does, on every request). The API accepts it if it
is 1 to 64 characters of `[A-Za-z0-9._-]`, otherwise it generates a UUID. The ID is echoed in
the `X-Request-Id` response header, included in error bodies and written to the access log.

## Authentication

Protected endpoints require `Authorization: Bearer <accessToken>`. Every route is protected
unless it is explicitly public. The full model is in [authentication.md](authentication.md).

## Swagger

Start the API (`npm run api:dev`) and open <http://localhost:3000/api/docs>.

1. Run `POST /api/v1/auth/register` or `POST /api/v1/auth/login` with **Try it out**.
2. Copy `data.tokens.accessToken` from the response.
3. Click **Authorize**, paste the token (without the `Bearer ` prefix) and confirm.
4. Protected endpoints (`GET /api/v1/auth/me`, `POST /api/v1/auth/logout`) now work. In
   development the token is kept across page reloads.

When the access token expires (after 15 minutes), call `POST /api/v1/auth/refresh` with the
refresh token and authorize again with the new access token.

## Postman

Import [`docs/postman/FieldOps-API.postman_collection.json`](postman/FieldOps-API.postman_collection.json).

- Collection variables: `baseUrl` (default `http://localhost:3000`), `email` (generated per
  run), `password`, and the tokens, which the requests' test scripts fill in.
- Run the **Auth** folder top to bottom: Register, duplicate Register (`409`), Login, wrong
  password (`401`), Me, Me without a token (`401`), Refresh (rotates both tokens), Reuse old
  refresh token (`401 REFRESH_TOKEN_REUSED`, which revokes the session), Logout.
- After the reuse request the session is revoked by design: run **Login** again before
  **Logout**.
- The collection uses bearer auth with `{{accessToken}}` by default; public requests override
  it with "No Auth".

The Postman collection is for manual exploration. The automated regression suite is the E2E
tests (`npm run api:test:e2e`).
