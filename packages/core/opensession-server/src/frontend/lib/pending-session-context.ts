const pendingContext = new Map<string, string[]>();

/** Seed a newly opened sibling tab with transcript context from its source. */
export function setPendingSessionContext(
  sessionId: string,
  sourceSessionId: string,
): void {
  pendingContext.set(sessionId, [sourceSessionId]);
}

/** Read once so returning to the tab does not restore consumed context. */
export function takePendingSessionContext(sessionId: string): string[] {
  const context = pendingContext.get(sessionId) ?? [];
  pendingContext.delete(sessionId);
  return context;
}
