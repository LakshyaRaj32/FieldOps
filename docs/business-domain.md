# Business Domain

How FieldOps models a company's field operations: who belongs where, who may see and do what,
how money is kept correct, and how an operation moves from assigned to done. The code is the
final authority; this file explains the rules and where they live.

- Shared rules (used by the API **and** the phone, offline): `packages/shared/src`
  (`job-state-machine.ts`, `operation-requirements.ts`, `money.ts`)
- Server enforcement: `apps/api/src` (`common/tenancy`, `access`, `jobs`, `shops`, `audit`)
- Database guarantees: `apps/api/prisma/migrations/20260927140100_organizations_and_commerce`

## 1. Entities and relationships

```text
Organization (tenant)
 ├── Users ─ role: ORGANIZATION_ADMIN | MANAGER | WORKER
 │    └── TeamMembership  worker → manager (at most one current manager per worker)
 ├── Shops ──── ShopAssignment  many-to-many with managers and workers
 ├── Products  (catalog: name, SKU, unit price, ACTIVE/INACTIVE)
 ├── Orders ─── OrderItems (product, quantity, price at order time)
 │    └── Payments  (partial, verified or rejected, one reference per method)
 ├── Jobs = Operations ─ type, shop?, order?, manager, assigned worker
 │    ├── JobLines         products to deliver / count / order
 │    ├── JobChecklistItems answered yes/no with a note
 │    ├── JobEvents        the operation's history
 │    └── evidence, notes, messages (from Phases 3–4)
 └── AuditLogs (append-only)
SUPER_ADMIN users belong to no organization: they run the platform.
```

| Entity | Key rules |
| --- | --- |
| Organization | `ACTIVE` or `SUSPENDED`. Suspending blocks every member's sign-in, refresh and API request (`ORGANIZATION_SUSPENDED`) and realtime connection. Holds the currency, time zone (the "today" of dashboards and due dates) and the arrival radius (default 300 m). |
| User | One organization or none. A self-registered account has none and sees only a "not part of an organization yet" dashboard until an admin adds them. |
| Shop | Name and address required, coordinates optional (both or neither). Deactivating keeps its history but it can take no new orders or operations. |
| Product | Prices are stored per product; an order item copies the price, so later price changes never alter an order. |
| Order | Number `ORD-<n>` from the organization's counter, taken in the same transaction. Status `OPEN`, `DELIVERED`, `CANCELLED`; payment state `UNPAID`, `PARTIALLY_PAID`, `PAID` is derived from the ledger. Can be cancelled only before anything was delivered or paid (`ORDER_NOT_CANCELLABLE`). |
| Payment | ID generated on the phone (an offline retry is the same payment). `PENDING_VERIFICATION` → `VERIFIED` or `REJECTED`. |

## 2. Roles and scopes

| Role | Scope | Can |
| --- | --- | --- |
| `SUPER_ADMIN` | The platform, no organization | Create, edit, suspend and activate organizations and their first admins. **Cannot read an organization's operations, shops or money**: there is no cross-tenant data API. Created only with `user:set-role`. |
| `ORGANIZATION_ADMIN` | The whole organization | Everything a manager can, plus members (create, role, deactivate, assign a manager), shops, products, settings and the audit log. |
| `MANAGER` | Their team and their shops | Create, assign, verify, reject and reschedule operations they manage; orders and accounts of shops assigned to them; workers in their team. With `organizationWideAccess` a manager sees the whole organization. |
| `WORKER` | Their own operations | Accept, decline, travel, arrive, work, submit or fail operations assigned to them; notes, photos, messages. Works offline. |

Scope is computed from the database state of the signed-in user on **every** request
(`orgScope(user)` in `common/tenancy/scope.ts`, `AccessService` in `access/`), never from
anything the client sends. Anything outside the user's scope answers `404 Not Found`, so its
existence is not revealed. The app hides screens a role cannot use, but that is a convenience;
the server is the protection.

## 3. Tenant isolation

Three layers, each enough to stop a cross-tenant leak on its own:

1. **Queries.** Every repository query filters by the caller's `organizationId`.
2. **References.** Any ID in a request (shop, order, product, worker, manager) is loaded inside
   the caller's organization; a foreign ID is `INVALID_REFERENCE` or 404.
3. **Database.** Child rows reference parents by composite foreign keys
   `(x_id, organization_id) → (id, organization_id)` with `ON UPDATE RESTRICT`. The database
   refuses an order for another organization's shop or a payment against another
   organization's order, even if the application had a bug.

Realtime rooms are per organization (`org:<id>:staff`) and per user; push payloads carry IDs
only, never business data.

## 4. Money

- Amounts are **integers in minor units** (paise for INR), `BIGINT` in PostgreSQL, JSON
  numbers in the API (safe-integer checked, `toAmount`). No floating-point arithmetic anywhere.
  `formatMoney` / `parseMoney` in `@fieldops/shared/money` convert for display and input
  (en-IN grouping: ₹2,00,000.00).
- **The server derives every balance.** Outstanding = order total − verified payments; the
  collectable amount also subtracts pending payments. The client never sends a balance.
- `orders.paid_amount` is changed **only** in `shops/ledger.ts`, inside the transaction that
  verifies a payment, after `SELECT … FOR UPDATE` on the order row. Concurrent collections
  cannot both pass the "enough balance" check. A `CHECK (paid_amount <= total_amount)` is the
  last line of defence.
- **No overpayment:** a payment above the collectable amount is `AMOUNT_EXCEEDS_BALANCE`.
  A collection operation's expected amount cannot exceed the unassigned balance (the balance
  minus other open collections' expected amounts).
- **Duplicates:** the same reference for the same method in one organization is
  `DUPLICATE_PAYMENT_REFERENCE` (partial unique index, ignoring rejected payments; stored
  trimmed and upper-cased). Cash needs no reference. Retries are made safe by the
  device-generated payment ID and the `Idempotency-Key` / mutation ID.
- A **rejected** payment frees its amount again. A **verified** payment is final.
- Payments past an order's due date raise one `PAYMENT_OVERDUE` notification per order
  (`shops/overdue.service.ts`, every `OVERDUE_SCAN_INTERVAL`, default `1h`, `off` disables).

## 5. Operation types and the state machine

An operation is a job with a `type`. `GENERAL` is the job from earlier phases and keeps its
basic lifecycle unchanged. Every other type uses the field lifecycle.

| Type | Needs a shop | Linked order | Submission requires |
| --- | --- | --- | --- |
| `GENERAL` | no | no | nothing new (checklist and photos as before) |
| `DELIVERY` | yes | yes (its items become lines) | delivered quantity per line (≤ expected; a short delivery needs a note), a photo |
| `PAYMENT_COLLECTION` | yes | yes | amount, method, reference unless cash, a note if the amount differs from the expected one, a photo of the receipt |
| `SHOP_VISIT` | yes | no | every checklist item answered |
| `ORDER_COLLECTION` | yes | no | the ordered products and quantities (verification creates the order) |
| `INVENTORY_CHECK` | yes | no | a count for every product line, every checklist item answered |

A manager can require a photo on any operation (`requiresPhoto`). The rules are one function,
`submissionProblems` in `operation-requirements.ts`: the phone shows the problems before
queuing a submission offline, and the server refuses the same ones (`REQUIREMENTS_NOT_MET`).

```text
Basic (GENERAL):  PENDING → ASSIGNED → IN_PROGRESS → COMPLETED

Field lifecycle:  PENDING → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED → IN_PROGRESS → SUBMITTED → COMPLETED
                                                              IN_PROGRESS ←── reject (reason) ──┘
```

| From | Worker | Manager |
| --- | --- | --- |
| `PENDING` | – | assign, reschedule, cancel |
| `ASSIGNED` | accept, decline → `PENDING` | assign (reassign), reschedule, cancel |
| `ACCEPTED` | depart, decline → `PENDING`, fail | reschedule → `ASSIGNED`, cancel |
| `EN_ROUTE`, `ARRIVED` | arrive / start, fail | cancel |
| `IN_PROGRESS` | submit, fail | cancel |
| `SUBMITTED` | – (notes, photos, messages only) | verify → `COMPLETED`, reject → `IN_PROGRESS` |

Decline, reject, reschedule, fail and cancel need a reason. A worker may decline only until
they set off; after that, stopping is a failure with a reason. A submitted operation cannot be
cancelled: its payment or order must be verified or rejected first, so money a worker reported
collecting is never dropped.

- **Verification is the `SUBMITTED` status.** `verify` completes the operation and applies its
  effect in the same transaction: records the delivery, verifies the payment, or creates the
  order. `reject` sends it back to `IN_PROGRESS` with a reason and rejects its pending payment.
- **Rescheduling** is an action, not a status: it changes the time and returns an accepted
  operation to `ASSIGNED` so the worker accepts again.
- `COMPLETED`, `CANCELLED` and `FAILED` are final. A submitted operation cannot be edited.
- `decideTransition` (shared) decides every transition on the phone and on the server; a
  repeated step by the same worker is idempotent, so an offline retry never fails.
- `allowedActions` in each response tells the app what to offer; it is derived from the same
  table.

## 6. Location and evidence

- `arrive` records the worker's position. If it is farther from the shop than the
  organization's `arrivalRadiusMeters`, the operation is **flagged** to managers ("outside the
  site"), not refused: GPS is imperfect and the worker is trusted but checked
  ([location.md](location.md)).
- A photo whose SHA-256 already exists on the same operation is not stored twice
  ([evidence.md](evidence.md)).

## 7. Audit

`writeAudit(tx, …)` records who did what, to which entity, with the changed fields, **in the
same transaction** as the change: there is never a change without its audit row or the other
way round. A database trigger refuses `UPDATE` and `DELETE` on `audit_logs`. Organization
admins read their organization's log (`GET /audit-logs`); a super admin sees platform actions.

Audited: organizations (create, update, suspend, activate), members (create, role, status,
manager), shops, assignments, products, orders (create, cancel), payments (record, verify,
reject), operation verification and rejection, overdue notices.

## 8. Notifications

Business events notify the people who must act, in-app and by push
([notifications.md](notifications.md)):

| Event | Who |
| --- | --- |
| Assigned, reassigned, unassigned, rescheduled, cancelled | The worker |
| Declined, submitted, failed | The responsible manager |
| Rejected, verified | The worker |
| Completed (basic lifecycle) | The manager |
| Payment overdue | The shop's managers and the organization's admins |
| Message | The other side |

The actor is never notified of their own action.

## 9. The dashboard

Every figure on the manager dashboard comes from `GET /jobs/overview`, computed by the database
within the manager's scope: status counts, overdue and due soon, awaiting verification,
completed/cancelled/failed in the last 7 days, workers (total, busy, available, online from
realtime presence), collections (outstanding, due today, overdue, collected today, pending
verification) and shops (total, visited today, pending visits). Nothing is estimated or
invented; a missing figure makes the response invalid rather than showing zero.

A worker's dashboard is computed on the phone from the operations it holds, so it works
offline: open, in progress, awaiting verification, completed in the last 7 days.
