# @qldc/logger

Shared stdout + optional Grafana Loki logger for Node services.

Writes a plain message line to stdout, and when Grafana env is set, fire-and-forget pushes the same line to Loki with `level` / `service` / `environment` labels.

## Install

```bash
npm install @qldc/logger
```

Local sibling checkout:

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

const log = getAppLogger({ defaultService: "my-api" });

log.info("started", { module: "index" });
log.warn("slow query", { module: "db", function: "search" });
log.error("request failed", err, { module: "routes" });
```

Or create a non-singleton logger (preferred in tests):

```ts
import { createAppLogger } from "@qldc/logger";

const log = createAppLogger({ defaultService: "my-worker" });
```

Loopback keep-alive access lines (`http_request GET / … 127.0.0.1…`) are **skipped by default**. Opt in if you need them:

```ts
const log = createAppLogger({
  defaultService: "my-api",
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

1. On npmjs.com → package → **Settings → Trusted Publisher**: wire the GitHub org/repo and `publish.yml`
2. Bump version and push a tag; Actions publishes:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

## Scripts

```bash
npm test
npm run build
npm run typecheck
```
