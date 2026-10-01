# @qldc/logger

Shared stdout + optional Grafana Loki logger for Node services.

Writes a plain message line to stdout, and when Grafana env is set, pushes the same line to Loki with `level` / `service` / `environment` labels. Loki pushes are batched (see [Loki batching](#loki-batching)).

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

`http_request` lines with an HTTP **5xx** status are always emitted at `ERROR` (including when `info`/`warn` is used), so Grafana error alerts pick them up.

Loopback keep-alive access lines (`http_request GET / … 127.0.0.1…`) are **skipped by default**. Opt in if you need them:

```ts
const log = createAppLogger({
  defaultService: "my-api",
  includeKeepAlive: true,
});
```

## Loki batching

Lines are buffered and pushed in one request per second (or as soon as 200 lines are waiting), grouped into one stream per label set. Only one push is in flight at a time. If Loki is slow or unreachable, the buffer is capped at 5000 lines; further lines are dropped from Loki (stdout still gets them) and the drop count is written to stderr.

```ts
const log = createAppLogger({
  defaultService: "my-api",
  lokiBatch: { flushIntervalMs: 1000, maxBatchLines: 200, maxBufferedLines: 5000 },
});
```

Up to `flushIntervalMs` of Loki lines can be lost if the process exits abruptly. To send them on a graceful shutdown, call `flush()`:

```ts
process.on("SIGTERM", async () => {
  await log.flush();
  process.exit(0);
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
