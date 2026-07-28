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

1. Create the **`@qldc`** organization on [npmjs.com](https://www.npmjs.com) (one-time) and add publishers.
2. Create GitHub repo `QLDC-BS/km-logger` and push this project.
3. Add repo secret **`NPM_TOKEN`** (npm automation token with publish rights on `@qldc`).
4. Bump version, then either:
   - push a tag `v0.1.0` (Actions publishes), or
   - `npm publish` locally while logged in.

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
