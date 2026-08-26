import {
  sessionGatewayCommand,
  type GatewayCommandOperation,
} from "./session-kernel";

/**
 * Execute one synchronous destination mutation after a short actor admission.
 * The mutation runs on the gateway thread, never in the actor Worker. The actor
 * remains free to reduce Stop, steer, and other commands while this continuation
 * is active.
 */
export function executeDestinationIdempotentSessionProjection<T>(
  sessionId: string,
  requestId: string,
  operation: "transcript_destination_append",
  identity: unknown,
  mutate: () => T,
): T {
  const plan = sessionGatewayCommand({
    op: "request",
    sessionId,
    requestId,
    operation,
    identity,
  });
  if (plan.status === "completed") return plan.result as T;
  if (plan.status === "in_progress")
    throw new Error(`Destination command ${requestId} is already in progress`);
  let physicalFinished = false;
  try {
    const result = mutate();
    physicalFinished = true;
    return sessionGatewayCommand({
      op: "complete",
      sessionId,
      requestId,
      operation,
      result,
    }) as T;
  } catch (error) {
    if (!physicalFinished) {
      sessionGatewayCommand({
        op: "fail",
        sessionId,
        requestId,
        operation,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
    throw error;
  }
}

export function executeSessionProjection<T>(
  sessionId: string,
  operation: GatewayCommandOperation,
  mutate: () => T,
): T {
  const requestId = `${operation}:${crypto.randomUUID()}`;
  const plan = sessionGatewayCommand({
    op: "request",
    sessionId,
    requestId,
    operation,
  });
  if (plan.status !== "execute")
    throw new Error(`Unexpected duplicate ${operation} command`);
  let physicalFinished = false;
  try {
    const result = mutate();
    physicalFinished = true;
    return sessionGatewayCommand({
      op: "complete",
      sessionId,
      requestId,
      operation,
      result,
    }) as T;
  } catch (error) {
    if (!physicalFinished)
      sessionGatewayCommand({
      op: "fail",
      sessionId,
      requestId,
      operation,
      error: error instanceof Error ? error.message : String(error),
      retryable: false,
    });
    throw error;
  }
}
