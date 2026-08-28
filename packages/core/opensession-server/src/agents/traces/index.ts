import type { AgentModule } from "../types";
import { tracesBin, tracesNamespaceSlug } from "./config";
import { listTracesAccounts } from "./auth";

export class TracesAgent implements AgentModule {
  name = "traces";

  getRoutes(): Map<string, (req: Request, url: URL) => Promise<Response>> {
    return new Map();
  }

  async startup(): Promise<void> {}

  async shutdown(): Promise<void> {}

  health(): Record<string, unknown> {
    const bin = tracesBin();
    return {
      traces: {
        connectedAccounts: listTracesAccounts().length,
        namespace: tracesNamespaceSlug(),
        cli: Bun.which(bin) ? bin : null,
      },
    };
  }
}
