# AI Architecture

> Status: **design (Version 0).** Implemented in **V17**. Nothing in this document is built
> before then. The design is written down now because it constrains earlier decisions:
> authorization must be reusable by AI tools, audit logging must support non-human actors,
> and heavy work must be queueable.

## 1. Principles

1. **AI is a client of the application, never a superuser.** An AI feature acts **on behalf
   of a specific user**, with exactly that user's permissions and tenant scope, or less.
2. **No direct database access.** The model never sees connection strings, never writes SQL
   and never queries tables. It can call only **allowlisted tools**, which are thin adapters
   over existing application services.
3. **Read before write.** The first AI features are read-only. Any tool that changes state
   requires explicit human confirmation in the UI before it runs.
4. **Everything is audited.** Every model call and every tool invocation is recorded with the
   user, organization, inputs (redacted), outputs and cost.
5. **Untrusted in, untrusted out.** Job notes, customer names and messages are data written by
   users. They may contain prompt-injection attempts. Model output is validated like any other
   untrusted input.
6. **AI failure never blocks core work.** If the provider is down or slow, every core workflow
   continues. AI features degrade gracefully.
7. **Offline workers are not dependent on AI.** AI features run on the server. The mobile app
   treats AI results as optional enrichment.

## 2. Candidate use cases (prioritized)

| # | Use case | Users | Mode | Writes? |
| --- | --- | --- | --- | --- |
| 1 | **Job summary**: summarize a job's notes, checklist and photos into a handover summary | Manager | Async (queue) | No (stores a summary artifact) |
| 2 | **Natural-language operations queries**: "Which jobs in the north zone are overdue?" | Manager | Interactive | No |
| 3 | **Structured extraction from evidence**: read a meter value or serial number from a photo into a suggested field | Worker (reviewed) | Async | Suggestion only; the worker confirms |
| 4 | **Suggested message replies** | Manager / Worker | Interactive | No (the user sends) |
| 5 | **Assignment suggestions**: suggest a worker for a job based on skills, location and load | Manager | Interactive | Only after manager confirmation, through the normal `job.assign` command |

## 3. Architecture

```text
 Mobile / client
      │  POST /api/v1/ai/...   (authenticated, rate-limited, cost-budgeted)
      ▼
 ┌──────────────────────── ai module (apps/api) ─────────────────────────┐
 │                                                                        │
 │  Use-case orchestrators (one per feature: JobSummary, OpsQuery, ...)   │
 │        │  builds prompt from *minimized*, authorized context           │
 │        ▼                                                               │
 │  LLM gateway (provider-neutral interface)                              │
 │   - provider adapter (initial candidate: Anthropic Claude)             │
 │   - timeouts, retries with backoff, token and cost accounting          │
 │   - output schema validation                                           │
 │        │  model requests a tool call                                   │
 │        ▼                                                               │
 │  Tool registry (allowlist)                                             │
 │   - each tool: name, description, input schema, required permission    │
 │   - executes via EXISTING application services with the caller's       │
 │     principal → same policies as REST / sync                           │
 │   - result filtered to fields the caller may see                       │
 │        │                                                               │
 │        ▼                                                               │
 │  Audit log (actor_type = 'ai', on behalf of user X)                    │
 └────────────────────────────────────────────────────────────────────────┘
      │ long-running tasks
      ▼
 BullMQ `ai` queue → worker process → result stored → client notified (WebSocket / push)
```

### The tool boundary

Example tool definitions (illustrative):

| Tool | Backed by | Required permission | Notes |
| --- | --- | --- | --- |
| `search_jobs(filters)` | `JobsService.search(principal, filters)` | `job:read:*` | Filters are a typed schema. There is no free-form query language |
| `get_job(jobId)` | `JobsService.getForPrincipal` | Policy: can read this job | Returns the public job DTO |
| `get_job_events(jobId)` | `JobsService.listEvents` | Policy: can read this job | Notes wrapped as untrusted content |
| `list_workers(filters)` | `UsersService.listWorkers` | `user:read:team` | No contact details unless permitted |
| `propose_assignment(jobId, workerId)` | none (returns a *proposal*) | `job:assign` | The UI shows the proposal; confirming calls the normal `POST /jobs/{id}/assign` |

Rules:

- Tools are **typed functions with schemas**, registered explicitly. There is no generic
  `run_query` or `call_endpoint` tool.
- Tools call the **same services and policies** as the REST API, so authorization is
  implemented once.
- Tool results are **minimized**: only the fields needed, and personal data is redacted where
  it is not essential.
- Tool calls per request are capped (count, time and tokens).

## 4. Safety and security

- **Prompt-injection resistance:** user-written content is passed as clearly delimited data,
  never as instructions. Tools the model can reach are all within the user's own permissions,
  so a successful injection can at worst do what the user could already do. Write tools
  additionally require human confirmation.
- **Output validation:** structured outputs are validated against schemas. Invalid output is
  retried once and then fails gracefully. Extracted values are always presented as
  suggestions.
- **Data handling:** only minimized context leaves our infrastructure. The provider is
  configured not to retain or train on data where the provider offers that option. There is a
  per-organization opt-out of AI features.
- **Abuse and cost control:** per-user and per-organization rate limits (the V11 limiter) and
  monthly token budgets. Requests over budget are rejected before a model call.
- **Secrets:** provider API keys live only on the server. The mobile app never calls the model
  provider directly.

## 5. Quality and evaluation

- A small **evaluation set** per use case (fixture jobs with expected summaries or answers),
  run in CI when prompts or models change.
- Prompts are versioned in code, and the prompt version is recorded with every result.
- Feedback capture (thumbs up/down, corrections to extracted values) to improve prompts.
- Model and provider are configuration, not code. The provider-neutral interface keeps
  switching providers or models cheap.

## 6. Observability

- Metrics: latency, token usage, cost per organization and per feature, tool-call counts,
  validation failure rate, and provider error rate.
- Traces span orchestrator → model call → tool calls → services.
- Audit entries let an admin answer: *what did the AI access or do on behalf of whom, and
  when?*

## 7. What earlier versions must provide

| Requirement | Provided by |
| --- | --- |
| Reusable, principal-based authorization policies | V2 (auth), Phase 2 (job policies: `apps/api/src/jobs/domain/job.policy.ts`) |
| Audit log supporting `actor_type = 'ai'` | Phase 5 (audit writer) |
| Rate limiting by user or organization | V11 |
| Queue for long-running tasks | V12 |
| Realtime or push delivery of async results | V8 / V9 |
| Tracing and cost metrics | V15 |
