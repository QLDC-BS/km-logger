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

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Fire-and-forget; errors go to stderr only (never throws). */
export function pushLokiLine(
  grafanaUrl: string,
  userId: string,
  apiKey: string,
  labels: LokiStreamLabels,
  messageLine: string,
): void {
  const endpoint = trimTrailingSlashes(grafanaUrl);
  const timestampNs = String(BigInt(Date.now()) * 1_000_000n);
  const payload = { streams: [{ stream: labels, values: [[timestampNs, messageLine]] }] };
  const auth = Buffer.from(`${userId}:${apiKey}`, "utf8").toString("base64");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5_000);

  void fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      clearTimeout(t);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        process.stderr.write(`Grafana logging error: HTTP ${res.status} - ${text}\n`);
      }
    })
    .catch((e: unknown) => {
      clearTimeout(t);
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Grafana logging error: ${msg}\n`);
    });
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
