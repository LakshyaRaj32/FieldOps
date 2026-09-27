# Location

> Status: **implemented in Phase 4 (Field Operations); not yet verified on a physical
> device** (see [phase-status.md](phase-status.md#phase-4--field-operations)).

FieldOps uses the worker's position **on demand, in the foreground, at the moments that
matter**: when a job is started, when it is completed, and when the worker asks how far they
are from the site. It does **not** track workers continuously. Background tracking (a
foreground service, batching, geofences) stays out of scope until a product requirement needs
it; the master plan lists it "where justified", and nothing in the current workflow does.

## What is collected

| Moment | Collected | Stored where | Sent to |
| --- | --- | --- | --- |
| Worker taps **Start job** | One fix: latitude, longitude, accuracy (m), time of the fix | The outbox entry's payload (SQLite) until synced | `POST /jobs/:id/start` → `job_events` row of the STARTED entry |
| Worker taps **Complete job** | Same | Same | `POST /jobs/:id/complete` → COMPLETED entry |
| Worker taps **Check my distance** | One fix | Memory only (shown, then forgotten) | Nowhere |

Nothing else: no altitude, speed, heading, provider, device model or location history. The
server stores the four values plus the distance **it** computes from the job site
(`job_events.latitude`, `longitude`, `accuracy_m`, `located_at`, `distance_m`, with a CHECK
constraint: all set or all absent, and only on STARTED/COMPLETED entries).

The job itself has had optional `latitude`/`longitude` since Phase 2; Phase 4 did not add job
location fields.

## Architecture

```text
WorkerJobDetail ("Start job")
   │  getCurrentLocation({ request: true })          services/location/locationService.ts
   │     ├─ PermissionsAndroid.check / requestMultiple (FINE + COARSE)
   │     ├─ FieldOpsLocation.isLocationEnabled()      Kotlin Turbo Module
   │     └─ FieldOpsLocation.getCurrentPosition()     Android LocationManager
   ▼
LocationResult  { ok, location } | permission_denied | permission_blocked
                | services_disabled | timeout | unavailable        (locationResult.ts)
   ▼
LocalJobStore.startJob(jobId, location | null)
   │  one SQLite transaction: outbox row { type: job.start, payload: { location } }
   ▼                         + recomputed local view (startLocation with the phone's estimate)
JobSyncEngine (Phase 3, unchanged rules)
   │  POST /jobs/:id/start   Idempotency-Key: <mutation id>   body { location }
   ▼
JobsService.start → eventLocation(job, fix): distance computed server-side → job_events
```

**Getting a fix never blocks the work.** If there is no permission, location is off, or no
fix arrives within 15 s, the command is saved without a location and the worker is told why
("Saved without your position. …"). A worker in a basement must still be able to start a job.

## Native module (Kotlin)

`FieldOpsLocation` (`android/app/src/main/java/com/fieldops/mobile/location/FieldOpsLocationModule.kt`),
a Turbo Module generated from the TypeScript spec `src/services/native/NativeFieldOpsLocation.ts`
(`codegenConfig` in `apps/mobile/package.json`, registered by `FieldOpsPackage.kt`).

**Why native code.** React Native no longer ships a geolocation API. The options were:

| Option | Why not chosen |
| --- | --- |
| `@react-native-community/geolocation` | A dependency for what is three platform calls; no "is location switched on?" query, so a disabled GPS and "no fix" look the same to the worker |
| `react-native-geolocation-service` / Expo Location | Pull in Google Play services location or the Expo modules runtime |
| **Small Kotlin module on `LocationManager`** | Chosen: no dependency, no Play services, exact error codes, and the architecture already planned Kotlin for location |

**What it exposes.**

| Method | Behavior |
| --- | --- |
| `isLocationEnabled(): boolean` (synchronous) | `LocationManager.isLocationEnabled` (API 28+), otherwise GPS or network provider enabled |
| `getCurrentPosition(timeoutMs, maximumAgeMs): Promise<LocationFix>` | A cached fix no older than `maximumAgeMs` (2 min) with the best accuracy, otherwise asks every usable provider for one fix (`getCurrentLocation` on API 30+, `requestSingleUpdate` before); first fix wins, the others are cancelled; `TIMEOUT` after `timeoutMs`. Rejects `PERMISSION_DENIED`, `SERVICES_DISABLED`, `UNAVAILABLE`, `TIMEOUT` |
| `openLocationSettings()` | Opens Android's location settings |

GPS is used only with precise permission; with "approximate" (Android 12+), the network
provider gives a coarse fix, which is still recorded with its (larger) accuracy.

**Lifecycle.** Nothing runs between calls: no service, no listener left registered, no
wake lock. The promise settles exactly once (an `AtomicBoolean` guards timeout versus fix).

**Business logic stays in TypeScript.** The module returns a fix; what it means (distance,
whether to record it) is decided in TypeScript and on the server.

## Permissions

Manifest: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`. **No** `ACCESS_BACKGROUND_LOCATION`.

| State | What the app does |
| --- | --- |
| Not asked yet | Asked in context: when the worker taps Start/Complete or "Check my distance", after the card explains why |
| Granted (precise or approximate) | Fix taken |
| Denied (can ask again) | Command saved without a location; explanation shown; asked again next time |
| Denied permanently ("Don't ask again") | Explanation plus **Open app settings** |
| Location switched off | Explanation plus **Turn on location** (system settings) |
| No fix in time | "Move to an open area…"; the command is saved without a location |

The permission is never requested at app start.

## Distance and the trust boundary

- Distance is the haversine great-circle distance (`@fieldops/shared/geo`, shared by the API
  and the app; within 0.5% of the ellipsoid, far below GPS error).
- **The server computes the distance itself** from the reported coordinates and the job's
  coordinates. A client-sent distance is rejected by validation (unknown field).
- **Location is never used for authorization.** A fix can be inaccurate (indoors ±50 m or
  more) or spoofed (mock-location apps). Proximity is therefore *recorded for review* (the
  manager sees "Started 120 m from the site (±15 m)") and not enforced. Enforcing a geofence
  would block honest workers with bad signal while stopping no determined cheater. If a
  customer ever needs enforcement, it belongs on the server, with a tolerance tied to the
  reported accuracy, and with mock-location detection reported as a signal.
- The phone shows its own estimate for a pending command; the server's value replaces it
  after sync.

## Offline behavior

The fix is part of the outbox payload of `job.start` / `job.complete`, written in the same
SQLite transaction as the command. It therefore survives app restarts and long offline
periods and is sent exactly once (Idempotency-Key). A retried command keeps the **first**
fix (the server's replay returns the recorded job). Outbox entries written before Phase 4
have no payload and are sent without a location.

## Privacy

- Collected only at explicit worker actions; never in the background; never continuously.
- Only the assigned worker and managers/admins can see a job's visit locations (the job
  policy); other workers get 404 for the job.
- Photos have their EXIF (which contains GPS) removed on the server ([evidence.md](evidence.md)),
  so a photo never leaks a position the worker did not choose to record.
- Push payloads never contain locations ([notifications.md](notifications.md)).
- Retention: location stays with the job's history. A retention period for closed jobs is a
  Phase 5 decision (with the rest of data retention).

## Accuracy limitations

- Indoors, network fixes can be off by hundreds of meters; the accuracy is always shown.
- A cached fix up to 2 minutes old may be used (saves battery and time); a worker who drove
  in the last two minutes may see an older position.
- Device clocks: `capturedAt` is device time, informational only.

## Tests

- `packages/shared/src/geo.spec.ts`: known distances, symmetry, antimeridian, bounds.
- `apps/api/src/jobs/domain/job-location.spec.ts`: server-side distance, missing coordinates.
- `apps/api/test/field-operations.e2e-spec.ts`: location on start/complete, working set,
  invalid coordinates and client-supplied distance rejected, first fix kept on retry.
- `apps/mobile/src/services/location/locationResult.test.ts`: native error codes, fix
  validation, failure explanations.
- `apps/mobile/src/features/jobs/data/projection.test.ts` and `syncEngine.test.ts`: the fix
  in the local view, sent with the command, surviving a restart, sent once.
- **Not automated:** the Kotlin module itself (it needs a device or an instrumented test; see
  the device checklist in [phase-status.md](phase-status.md#phase-4-device-verification)).
