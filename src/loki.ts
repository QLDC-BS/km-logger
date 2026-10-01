/**
 * Grafana Loki push (same wire format as a typical Loki HTTP push handler).
 */

export type LokiStreamLabels = Record<string, string>;

export type GrafanaPushEnv = {
  url: string;
  userId: string;
  apiKey: string;
};

export type ServiceLabels = {
  service: string;
  environment: string;
};

export type LokiStream = {
  stream: LokiStreamLabels;
  values: [string, string][];
};

export type LokiBatchOptions = {
  /** Longest a line waits in the buffer before being pushed. Default: 1000 ms. */
  flushIntervalMs?: number;
  /** Push as soon as this many lines are buffered. Default: 200. */
  maxBatchLines?: number;
  /** Lines beyond this many buffered are dropped (e.g. Loki unreachable). Default: 5000. */
  maxBufferedLines?: number;
};

export type LokiBatcher = {
  enqueue(grafana: GrafanaPushEnv, labels: LokiStreamLabels, messageLine: string): void;
  /** Push everything buffered and wait for in-flight pushes. Never rejects. */
  flush(): Promise<void>;
};

const PUSH_TIMEOUT_MS = 5_000;

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function lokiTimestampNs(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

/** Never throws; errors go to stderr. Always releases the response body so the connection is reused. */
async function postStreams(grafana: GrafanaPushEnv, streams: LokiStream[]): Promise<void> {
  const endpoint = trimTrailingSlashes(grafana.url);
  const auth = Buffer.from(`${grafana.userId}:${grafana.apiKey}`, "utf8").toString("base64");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ streams }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      process.stderr.write(`Grafana logging error: HTTP ${res.status} - ${text}\n`);
    } else {
      await res.body?.cancel().catch(() => undefined);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Grafana logging error: ${msg}\n`);
  } finally {
    clearTimeout(t);
  }
}

/** Fire-and-forget single-line push; errors go to stderr only (never throws). */
export function pushLokiLine(
  grafanaUrl: string,
  userId: string,
  apiKey: string,
  labels: LokiStreamLabels,
  messageLine: string,
): void {
  void postStreams({ url: grafanaUrl, userId, apiKey }, [
    { stream: labels, values: [[lokiTimestampNs(), messageLine]] },
  ]);
}

/**
 * Buffers lines and pushes them in batches (one request per Grafana target, one stream per
 * label set). At most one push is in flight; while it is, new lines keep buffering up to
 * `maxBufferedLines`, after which they are dropped and the count is reported to stderr.
 */
export function createLokiBatcher(options: LokiBatchOptions = {}): LokiBatcher {
  const flushIntervalMs = options.flushIntervalMs ?? 1_000;
  const maxBatchLines = options.maxBatchLines ?? 200;
  const maxBufferedLines = options.maxBufferedLines ?? 5_000;

  type Target = { grafana: GrafanaPushEnv; streams: Map<string, LokiStream> };

  let pending = new Map<string, Target>();
  let buffered = 0;
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (inFlight) schedule();
      else startPush();
    }, flushIntervalMs);
    timer.unref?.();
  };

  const startPush = (): void => {
    clearTimer();
    if (dropped > 0) {
      process.stderr.write(`Grafana logging: dropped ${dropped} log lines (buffer full)\n`);
      dropped = 0;
    }
    if (buffered === 0) return;

    const batch = [...pending.values()];
    pending = new Map();
    buffered = 0;

    inFlight = Promise.all(
      batch.map(({ grafana, streams }) => postStreams(grafana, [...streams.values()])),
    )
      .then(() => undefined)
      .finally(() => {
        inFlight = null;
        if (buffered > 0) schedule();
      });
  };

  return {
    enqueue(grafana, labels, messageLine) {
      if (buffered >= maxBufferedLines) {
        dropped++;
        return;
      }

      const targetKey = `${grafana.url}\u0000${grafana.userId}\u0000${grafana.apiKey}`;
      let target = pending.get(targetKey);
      if (!target) {
        target = { grafana, streams: new Map() };
        pending.set(targetKey, target);
      }

      const streamKey = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
      let stream = target.streams.get(streamKey);
      if (!stream) {
        stream = { stream: labels, values: [] };
        target.streams.set(streamKey, stream);
      }
      stream.values.push([lokiTimestampNs(), messageLine]);
      buffered++;

      if (buffered >= maxBatchLines && !inFlight) startPush();
      else schedule();
    },

    async flush() {
      while (inFlight || buffered > 0 || dropped > 0) {
        if (inFlight) {
          await inFlight;
          continue;
        }
        startPush();
      }
    },
  };
}

export function readGrafanaPushEnv(
  env: NodeJS.ProcessEnv = process.env,
): GrafanaPushEnv | null {
  const url = (env.GRAFANA_URL ?? "").trim();
  const userId = (env.GRAFANA_USER_ID ?? "").trim();
  const apiKey = (env.GRAFANA_API_KEY ?? "").trim();
  if (!url || !userId || !apiKey) {
    return null;
  }
  return { url, userId, apiKey };
}

export function readServiceLabels(
  env: NodeJS.ProcessEnv = process.env,
  defaultService = "app",
): ServiceLabels {
  return {
    service: (env.NAME ?? defaultService).trim() || defaultService,
    environment: (env.ENV ?? "unknown").trim() || "unknown",
  };
}
