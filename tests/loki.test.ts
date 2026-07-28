import { afterEach, describe, expect, it, vi } from "vitest";
import { pushLokiLine, readGrafanaPushEnv, readServiceLabels } from "../src/loki.js";

const ENV_KEYS = ["GRAFANA_URL", "GRAFANA_USER_ID", "GRAFANA_API_KEY", "NAME", "ENV"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  clearEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readGrafanaPushEnv", () => {
  it("returns null when any Grafana env is missing", () => {
    expect(readGrafanaPushEnv()).toBeNull();
    process.env.GRAFANA_URL = "https://logs.example/loki/api/v1/push";
    expect(readGrafanaPushEnv()).toBeNull();
  });

  it("returns config when all three are set", () => {
    process.env.GRAFANA_URL = "https://logs.example/loki/api/v1/push";
    process.env.GRAFANA_USER_ID = "123";
    process.env.GRAFANA_API_KEY = "glc_test";
    expect(readGrafanaPushEnv()).toEqual({
      url: "https://logs.example/loki/api/v1/push",
      userId: "123",
      apiKey: "glc_test",
    });
  });
});

describe("readServiceLabels", () => {
  it("uses NAME and ENV", () => {
    process.env.NAME = "km-edocs-api";
    process.env.ENV = "dev";
    expect(readServiceLabels()).toEqual({
      service: "km-edocs-api",
      environment: "dev",
    });
  });

  it("falls back to defaultService when NAME is unset", () => {
    expect(readServiceLabels(process.env, "km-web-api")).toEqual({
      service: "km-web-api",
      environment: "unknown",
    });
  });
});

describe("pushLokiLine", () => {
  it("POSTs Loki streams payload with basic auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    pushLokiLine(
      "https://logs.example/loki/api/v1/push/",
      "123",
      "secret",
      { level: "INFO", service: "km-logger", environment: "local" },
      "http_request GET /healthz 200 1ms",
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://logs.example/loki/api/v1/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from("123:secret", "utf8").toString("base64")}`,
        }),
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      streams: [{ stream: Record<string, string>; values: [string, string][] }];
    };
    expect(body.streams[0]!.stream).toEqual({
      level: "INFO",
      service: "km-logger",
      environment: "local",
    });
    expect(body.streams[0]!.values[0]![1]).toBe("http_request GET /healthz 200 1ms");
  });
});
