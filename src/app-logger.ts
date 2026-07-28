/**
 * Application logger — stdout message lines + optional Loki.
 */

import {
  pushLokiLine,
  readGrafanaPushEnv,
  readServiceLabels,
  type GrafanaPushEnv,
  type ServiceLabels,
} from "./loki.js";

export type LogContext = {
  module?: string;
  function?: string;
};

export type AppLogger = {
  info(message: string, ctx?: LogContext): void;
  warn(message: string, ctx?: LogContext): void;
  error(message: string, err?: unknown, ctx?: LogContext): void;
};

export type CreateAppLoggerOptions = {
  /** Fallback when `NAME` env is unset. Default: `"app"`. */
  defaultService?: string;
  /** Override process.env for Grafana credentials (tests / custom wiring). */
  grafana?: GrafanaPushEnv | null;
  /** Override process.env for service/environment labels. */
  labels?: ServiceLabels;
  /** Write log lines here. Default: process.stdout. */
  stdout?: NodeJS.WritableStream;
};

function formatError(message: string, err?: unknown): string {
  if (err === undefined) return message;
  if (err instanceof Error) {
    return err.stack ? `${message}\n${err.stack}` : `${message}\n${err.message}`;
  }
  return `${message}\n${String(err)}`;
}

export function createAppLogger(options: CreateAppLoggerOptions = {}): AppLogger {
  const defaultService = options.defaultService ?? "app";
  const stdout = options.stdout ?? process.stdout;

  const emit = (
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    ctx: LogContext | undefined,
  ): void => {
    stdout.write(`${message}\n`);

    const grafana =
      options.grafana !== undefined ? options.grafana : readGrafanaPushEnv();
    if (!grafana) return;

    const { service, environment } =
      options.labels ?? readServiceLabels(process.env, defaultService);
    const labels: Record<string, string> = {
      level,
      service,
      environment,
    };
    if (ctx?.module) labels.module = ctx.module;
    if (ctx?.function) labels.function = ctx.function;

    pushLokiLine(grafana.url, grafana.userId, grafana.apiKey, labels, message);
  };

  return {
    info(message, ctx) {
      emit("INFO", message, ctx);
    },
    warn(message, ctx) {
      emit("WARN", message, ctx);
    },
    error(message, err, ctx) {
      emit("ERROR", formatError(message, err), ctx);
    },
  };
}

let singleton: AppLogger | null = null;

/**
 * Process-wide singleton. Pass `defaultService` on first call if `NAME` may be unset
 * (e.g. `"km-web-api"`). Later calls ignore options and return the existing instance.
 */
export function getAppLogger(options?: CreateAppLoggerOptions): AppLogger {
  if (singleton) return singleton;
  singleton = createAppLogger(options);
  return singleton;
}

/** Test helper — clears the singleton created by {@link getAppLogger}. */
export function resetAppLoggerForTests(): void {
  singleton = null;
}
