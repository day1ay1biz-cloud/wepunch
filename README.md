# wepunch

Multi-tenant digital punch cards for small businesses. Next.js 16 (App Router),
Postgres with Row-Level Security, Drizzle, Better Auth, BullMQ. Deploys to
Fly.io as one Docker image.

## Local setup

Requires Node 24, pnpm and Docker.

```bash
pnpm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --wait     # Postgres on :54322, Redis on :63799
pnpm db:setup                   # migrate + create the app's login role
pnpm db:seed                    # Joe's Coffee (via an agency) and Bella Salon
pnpm dev
```

- Platform home: http://localhost:3000
- Tenant by path: http://localhost:3000/b/joes-coffee
- Tenant by subdomain: http://joes-coffee.localhost:3000
- Seeded owners: `joe@example.com`, `bella@example.com` (password in `src/db/seed.ts`)
- Worker: `pnpm worker`

## Scripts

| Script | Does |
| --- | --- |
| `pnpm test` | Builds a fresh `wepunch_test` database and runs all tests |
| `pnpm typecheck` / `pnpm lint` | Static checks |
| `pnpm db:generate` | New migration from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations (as `DATABASE_ADMIN_URL`) |
| `pnpm build && pnpm build:scripts` | Production build + bundled worker and migrate scripts |

## How tenant isolation works

- Every tenant table has a `business_id` and a Row-Level Security policy
  (`drizzle/0001_rls.sql`). The app connects as a login role in `wepunch_app`,
  which does not own the tables, so the policies always apply.
- Request code reads and writes tenant data only inside
  `withTenant({ businessId }, tx => …)` (`src/db/index.ts`), which sets the
  scope as transaction-local settings. Outside it, tenant tables return no rows.
- An agency scope (`agencyId`) reaches every business whose `agency_id` matches.
- Lookups needed before a scope exists go through narrow `SECURITY DEFINER`
  functions: `resolve_business` (routing) and `user_scopes` (after sign-in).
- `punch_event` and `audit_log` are append-only for the app role.
- `tests/tenant-isolation.test.ts` tries cross-tenant reads, writes, updates and
  deletes, and fails if any table with a `business_id` lacks a policy.

New tenant table checklist: add it to `schema.ts`, run `pnpm db:generate`, add
its policy in a new custom migration (`pnpm drizzle-kit generate --custom`), and
run `pnpm test`.

## Routing

`src/proxy.ts` (Next 16's replacement for middleware) maps hosts to the internal
`/b/<slug>` routes:

- `<slug>.ROOT_DOMAIN` → `/b/<slug>/…`
- a business's custom domain → looked up, cached 60 s, then rewritten
- `ROOT_DOMAIN`, `www.`, `app.` → platform pages

## Error monitoring (Sentry)

Project `kinetic-ventures/wepunch`. Errors and traces from the browser, the
Next.js server (`service:web`) and the worker (`service:worker`) all go there.

- Config: `src/instrumentation-client.ts`, `src/instrumentation.ts`,
  `src/sentry.server.config.ts`, `src/worker/sentry.ts`, shared options in
  `src/lib/sentry-options.ts`.
- Privacy: no user info, cookies, headers or request bodies are sent, local
  variables are off, and Session Replay masks all text and inputs.
- Browser events go through `/monitoring` on our own domain (ad blockers);
  `proxy.ts` leaves that path alone.
- Per environment: `SENTRY_ENVIRONMENT` (e.g. `staging`, `production`);
  `SENTRY_DISABLED=1` turns it off.
- Source maps upload during `next build` when `SENTRY_AUTH_TOKEN` is set. In CI
  it is the `SENTRY_AUTH_TOKEN` repository secret, passed to the Docker build as
  a build secret; `SENTRY_RELEASE` is the commit SHA.

## Deploying to Fly.io

Staging is live at https://wepunch-staging.fly.dev (app `wepunch-staging`,
region `iad`). It runs only the `web` process group, stops when idle, and uses
a free-tier Neon Postgres (standard Postgres, so it can move to Fly Managed
Postgres for production unchanged). The worker and Redis are added in M2.
Tenant subdomains need a custom domain; on `*.fly.dev` use `/b/<slug>`.

Deploy staging by hand (CI does the same on every push to `main`):

```bash
flyctl deploy --app wepunch-staging --remote-only --process-groups web \
  --build-arg SENTRY_RELEASE=$(git rev-parse HEAD) \
  --build-arg NEXT_PUBLIC_SENTRY_ENVIRONMENT=staging \
  --build-secret SENTRY_AUTH_TOKEN=<token>
```

Use `flyctl`, not `fly`: on this machine `fly` is Concourse CI's command.

One-time setup for a new environment (needs `flyctl` and your Fly account):

```bash
fly apps create wepunch-staging
fly mpg create                      # Fly Managed Postgres; note the owner connection string
```

Create the app's login role once, connected as the database owner:

```sql
-- after the first migration has created the wepunch_app role
CREATE ROLE wepunch_app_login LOGIN NOBYPASSRLS PASSWORD '<strong password>';
GRANT wepunch_app TO wepunch_app_login;
```

If the managed user cannot create roles, run the first migration's `CREATE ROLE
wepunch_app` step through the provider's admin console instead.

```bash
fly secrets set --app wepunch-staging \
  DATABASE_URL=postgres://wepunch_app_login:...@.../wepunch \
  DATABASE_ADMIN_URL=postgres://<owner>:...@.../wepunch \
  REDIS_URL=... BETTER_AUTH_SECRET=... \
  BETTER_AUTH_URL=https://app.<domain> ROOT_DOMAIN=<domain>
fly deploy --app wepunch-staging
```

`fly.toml` runs migrations as the release command, then starts `web` and
`worker` process groups from the same image. CI (`.github/workflows/ci.yml`)
deploys staging on every push to `main` once `FLY_API_TOKEN` is set as a
repository secret.
