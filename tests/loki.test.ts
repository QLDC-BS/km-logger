import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLokiBatcher,
  pushLokiLine,
  readGrafanaPushEnv,
  readServiceLabels,
} from "../src/loki.js";

const GRAFANA = { url: "https://logs.example/loki/api/v1/push", userId: "1", apiKey: "key" };
const LABELS = { level: "INFO", service: "km-test", environment: "local" };

type PushBody = { streams: { stream: Record<string, string>; values: [string, string][] }[] };

function okResponse() {
  return { ok: true, text: async () => "", body: { cancel: vi.fn().mockResolvedValue(undefined) } };
}

function linesIn(fetchMock: ReturnType<typeof vi.fn>, call: number): string[] {
  const body = JSON.parse(fetchMock.mock.calls[call]![1].body as string) as PushBody;
  return body.streams.flatMap((s) => s.values.map(([, line]) => line));
}

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
    process.env.NAME = "my-service";
    process.env.ENV = "dev";
    expect(readServiceLabels()).toEqual({
      service: "my-service",
      environment: "dev",
    });
  });

  it("falls back to defaultService when NAME is unset", () => {
    expect(readServiceLabels(process.env, "my-api")).toEqual({
      service: "my-api",
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

  it("releases the response body on success", async () => {
    const res = okResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    pushLokiLine(GRAFANA.url, GRAFANA.userId, GRAFANA.apiKey, LABELS, "hello");

    await vi.waitFor(() => expect(res.body.cancel).toHaveBeenCalled());
  });
});

describe("createLokiBatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pushes buffered lines after flushIntervalMs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const batcher = createLokiBatcher({ flushIntervalMs: 1_000 });

    batcher.enqueue(GRAFANA, LABELS, "a");
    batcher.enqueue(GRAFANA, LABELS, "b");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(linesIn(fetchMock, 0)).toEqual(["a", "b"]);
  });

  it("pushes immediately once maxBatchLines is reached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const batcher = createLokiBatcher({ maxBatchLines: 3, flushIntervalMs: 60_000 });

    batcher.enqueue(GRAFANA, LABELS, "a");
    batcher.enqueue(GRAFANA, LABELS, "b");
    expect(fetchMock).not.toHaveBeenCalled();
    batcher.enqueue(GRAFANA, LABELS, "c");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(linesIn(fetchMock, 0)).toEqual(["a", "b", "c"]);
    await batcher.flush();
  });

  it("keeps one push in flight and sends the rest on flush", async () => {
    let release!: () => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve(okResponse()))),
      )
      .mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const batcher = createLokiBatcher({ maxBatchLines: 1, flushIntervalMs: 60_000 });

    batcher.enqueue(GRAFANA, LABELS, "first");
    batcher.enqueue(GRAFANA, LABELS, "second");
    batcher.enqueue(GRAFANA, LABELS, "third");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const flushed = batcher.flush();
    release();
    await flushed;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(linesIn(fetchMock, 0)).toEqual(["first"]);
    expect(linesIn(fetchMock, 1)).toEqual(["second", "third"]);
  });

  it("drops lines beyond maxBufferedLines and reports the count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const batcher = createLokiBatcher({ maxBufferedLines: 2, flushIntervalMs: 60_000 });

    for (const line of ["a", "b", "c", "d"]) batcher.enqueue(GRAFANA, LABELS, line);
    await batcher.flush();

    expect(linesIn(fetchMock, 0)).toEqual(["a", "b"]);
    expect(stderr).toHaveBeenCalledWith("Grafana logging: dropped 2 log lines (buffer full)\n");
  });

  it("groups lines by label set into separate streams", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const batcher = createLokiBatcher();

    batcher.enqueue(GRAFANA, { ...LABELS, level: "INFO" }, "i1");
    batcher.enqueue(GRAFANA, { ...LABELS, level: "ERROR" }, "e1");
    batcher.enqueue(GRAFANA, { environment: "local", service: "km-test", level: "INFO" }, "i2");
    await batcher.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as PushBody;
    expect(body.streams).toHaveLength(2);
    expect(body.streams.map((s) => s.values.map(([, line]) => line))).toEqual([
      ["i1", "i2"],
      ["e1"],
    ]);
  });

  it("never rejects when Loki is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const batcher = createLokiBatcher();

    batcher.enqueue(GRAFANA, LABELS, "a");
    await expect(batcher.flush()).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledWith("Grafana logging error: ECONNREFUSED\n");
  });
});
