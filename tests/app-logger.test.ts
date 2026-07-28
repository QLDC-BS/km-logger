import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppLogger,
  getAppLogger,
  resetAppLoggerForTests,
} from "../src/app-logger.js";

afterEach(() => {
  resetAppLoggerForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GRAFANA_URL;
  delete process.env.GRAFANA_USER_ID;
  delete process.env.GRAFANA_API_KEY;
  delete process.env.NAME;
  delete process.env.ENV;
});

describe("createAppLogger", () => {
  it("writes info lines to stdout", () => {
    const chunks: string[] = [];
    const logger = createAppLogger({
      grafana: null,
      stdout: {
        write(chunk: string) {
          chunks.push(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
    });

    logger.info("hello");
    expect(chunks).toEqual(["hello\n"]);
  });

  it("pushes Loki with level/module labels when grafana is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    const logger = createAppLogger({
      grafana: {
        url: "https://logs.example/loki/api/v1/push",
        userId: "1",
        apiKey: "key",
      },
      labels: { service: "km-test", environment: "local" },
      stdout: { write: () => true } as NodeJS.WritableStream,
    });

    logger.warn("careful", { module: "jobs", function: "run" });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      streams: [{ stream: Record<string, string>; values: [string, string][] }];
    };
    expect(body.streams[0]!.stream).toMatchObject({
      level: "WARN",
      service: "km-test",
      environment: "local",
      module: "jobs",
      function: "run",
    });
    expect(body.streams[0]!.values[0]![1]).toBe("careful");
  });

  it("includes error stack in the message line", () => {
    const chunks: string[] = [];
    const logger = createAppLogger({
      grafana: null,
      stdout: {
        write(chunk: string) {
          chunks.push(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
    });

    logger.error("failed", new Error("boom"));
    expect(chunks[0]).toContain("failed");
    expect(chunks[0]).toContain("boom");
  });
});

describe("getAppLogger", () => {
  it("returns the same singleton instance", () => {
    const a = getAppLogger({ defaultService: "km-web-api", grafana: null });
    const b = getAppLogger();
    expect(a).toBe(b);
  });
});
