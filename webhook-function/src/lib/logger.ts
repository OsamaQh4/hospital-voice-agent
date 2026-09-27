type LogLevel = "debug" | "info" | "warn" | "error";

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export async function withTiming<T>(
  event: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();

  try {
    const result = await fn();
    const duration_ms = Date.now() - start;
    // A handler that caught its own error and answered with an HTTP 5xx
    // (or an MCP tool result flagged isError) still "returned" -- log that
    // as a failure, not a success, so the log can't contradict itself.
    const status = result instanceof Response ? result.status : undefined;
    const toolError =
      typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
    if ((status !== undefined && status >= 500) || toolError) {
      log("error", `${event}.failure`, { ...fields, duration_ms, ...(status !== undefined ? { status } : {}) });
    } else {
      log("info", `${event}.success`, { ...fields, duration_ms, ...(status !== undefined ? { status } : {}) });
    }
    return result;
  } catch (err) {
    const duration_ms = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    log("error", `${event}.failure`, { ...fields, duration_ms, error });
    throw err;
  }
}
