type RelaySocket = import("bun").Socket<unknown>;

type ClientState = {
  closed: boolean;
  peer?: RelaySocket;
  retry?: ReturnType<typeof setTimeout>;
};

export interface GatewayTcpProxyOptions {
  hostname: string;
  port: number;
  backendPort(): number;
  retryMs?: number;
  connectDeadlineMs?: number;
}

/**
 * Stable byte-for-byte TCP front door for gateway children. It deliberately
 * knows nothing about HTTP or WebSockets, so upgrades, streaming bodies and
 * long-lived sockets retain their native semantics. Connections accepted
 * during the child cut-over stay paused until the activated child binds.
 */
export function startGatewayTcpProxy(
  options: GatewayTcpProxyOptions,
): import("bun").TCPSocketListener<undefined> {
  const retryMs = options.retryMs ?? 25;
  const connectDeadlineMs = options.connectDeadlineMs ?? 30_000;
  const clients = new WeakMap<RelaySocket, ClientState>();
  const peers = new WeakMap<RelaySocket, RelaySocket>();

  const close = (socket: RelaySocket) => {
    const state = clients.get(socket);
    if (state) {
      state.closed = true;
      if (state.retry) clearTimeout(state.retry);
    }
    const peer = peers.get(socket);
    peers.delete(socket);
    if (peer) {
      peers.delete(peer);
      try { peer.end(); } catch {}
    }
  };

  const forward = (source: RelaySocket, data: Uint8Array<ArrayBufferLike>) => {
    const peer = peers.get(source);
    if (!peer) return;
    const written = peer.write(data as unknown as Uint8Array<ArrayBuffer>);
    const length = data.byteLength;
    if (written < length) source.pause();
  };

  const connect = (client: RelaySocket, deadline: number) => {
    const state = clients.get(client);
    if (!state || state.closed || state.peer) return;
    const retry = () => {
      if (state.closed || state.peer || state.retry) return;
      if (Date.now() >= deadline) {
        try { client.end(); } catch {}
        return;
      }
      state.retry = setTimeout(() => {
        state.retry = undefined;
        connect(client, deadline);
      }, retryMs);
      state.retry.unref?.();
    };
    Bun.connect({
      hostname: "127.0.0.1",
      port: options.backendPort(),
      socket: {
        open(upstream) {
          if (state.closed) {
            upstream.end();
            return;
          }
          state.peer = upstream;
          peers.set(client, upstream);
          peers.set(upstream, client);
          client.resume();
        },
        data(upstream, data) {
          forward(upstream, data);
        },
        drain(upstream) {
          peers.get(upstream)?.resume();
        },
        close(upstream) {
          const downstream = peers.get(upstream);
          peers.delete(upstream);
          if (downstream) {
            peers.delete(downstream);
            clients.get(downstream)!.peer = undefined;
            try { downstream.end(); } catch {}
          }
        },
        connectError() {
          retry();
        },
        error() {
          retry();
        },
      },
    }).catch(retry);
  };

  return Bun.listen({
    hostname: options.hostname,
    port: options.port,
    socket: {
      open(client) {
        const state: ClientState = { closed: false };
        clients.set(client, state);
        client.pause();
        connect(client, Date.now() + connectDeadlineMs);
      },
      data(client, data) {
        forward(client, data);
      },
      drain(client) {
        peers.get(client)?.resume();
      },
      close(client) {
        close(client);
      },
      error(client) {
        close(client);
      },
    },
  });
}
