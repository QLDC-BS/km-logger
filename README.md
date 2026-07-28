# @qldc/logger

Shared stdout + optional Grafana Loki logger for QLDC KM Node services.

Same contract as the inlined logging in `km-edocs` / former `km-t1-gateway`: write a plain message line to stdout, and when Grafana env is set, fire-and-forget push the same line to Loki with `level` / `service` / `environment` labels.

## Install

```bash
npm install @qldc/logger
```

Local sibling checkout (before/without publishing):

```json
{
  "dependencies": {
    "@qldc/logger": "file:../km-logger"
  }
}
```

## Usage

```ts
import { getAppLogger } from "@qldc/logger";

const log = getAppLogger({ defaultService: "km-web-api" });

log.info("started", { module: "index" });
log.warn("slow query", { module: "db", function: "search" });
log.error("request failed", err, { module: "routes" });
```

Or create a non-singleton logger (preferred in tests):

```ts
import { createAppLogger } from "@qldc/logger";

const log = createAppLogger({ defaultService: "km-downer" });
```

Azure App Service Always On pings (`http_request GET / … 127.0.0.1…`) are **skipped by default**. Opt in if you need them:

```ts
const log = createAppLogger({
  defaultService: "km-web-api",
  includeKeepAlive: true,
});
```

## Environment

| Variable | Purpose |
|----------|---------|
| `GRAFANA_URL` | Loki push URL (omit → stdout only) |
| `GRAFANA_USER_ID` | Basic-auth user |
| `GRAFANA_API_KEY` | Basic-auth password / token |
| `NAME` | Loki `service` label (falls back to `defaultService` / `"app"`) |
| `ENV` | Loki `environment` label (default `"unknown"`) |

## Publish (maintainers)

CI uses **npm Trusted Publishing** (OIDC) — no long-lived `NPM_TOKEN`.

1. On [npmjs.com](https://www.npmjs.com/package/@qldc/logger) → **Settings → Trusted Publisher**:
   - Organization or user: `QLDC-BS`
   - Repository: `km-logger`
   - Workflow filename: `publish.yml` (name only, not a path)
   - Environment: leave blank
2. Bump version and push a tag; Actions publishes:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

A `404` on `PUT …/@qldc%2flogger` from Actions almost always means auth failed (missing Trusted Publisher config, or an empty `NODE_AUTH_TOKEN` / bad classic token). Local `npm publish` still needs a granular token with **Bypass 2FA** (or interactive 2FA).

## Scripts

```bash
npm test
npm run build
npm run typecheck
```
