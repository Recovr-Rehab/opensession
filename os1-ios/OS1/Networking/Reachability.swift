import Foundation

/// Why a request never reached the server, in words that name the fix.
///
/// An OS1 server usually sits on a tailnet, and a device that has dropped off
/// it gets no refusal: packets addressed to a 100.x node go nowhere, so
/// URLSession waits out its full timeout and reports "The request timed out."
/// That reads as a broken server when the truth is a switched-off VPN — so
/// everything that surfaces a network error asks here for the wording first.
@MainActor
enum Reachability {

    // MARK: - Tailscale's address space

    /// Tailscale numbers every node out of 100.64.0.0/10 — the CGNAT range —
    /// and out of fd7a:115c:a1e0::/48, and uses nothing else. An address in
    /// either range marks one end of a connection as living on a tailnet.
    nonisolated static func isTailnetIPv4(_ address: UInt32) -> Bool {
        address & 0xFFC0_0000 == 0x6440_0000
    }

    nonisolated static func isTailnetIPv6(_ address: [UInt8]) -> Bool {
        address.prefix(6).elementsEqual([0xFD, 0x7A, 0x11, 0x5C, 0xA1, 0xE0])
    }

    /// MagicDNS names — `host.tailnet-name.ts.net` — resolve on the tailnet
    /// and nowhere else, so the name settles it without a lookup (which is
    /// just as well: off the tailnet the lookup fails).
    nonisolated static func isTailnetHostname(_ host: String) -> Bool {
        host.lowercased().hasSuffix(".ts.net")
    }

    // MARK: - Diagnosis

    /// What to show for a failed request: the tailnet diagnosis when it
    /// applies, the system's own wording otherwise.
    static func describe(_ error: Error) async -> String {
        guard blamesTheNetwork(error), let hint = await tailnetHint() else {
            return error.localizedDescription
        }
        return hint
    }

    /// The diagnosis on its own, for callers holding no error yet — the
    /// sessions list asks while its first request is still in flight, because
    /// a minute of spinner is a long way to go to be told "timed out".
    ///
    /// Nil unless both halves are true: the server lives on a tailnet, and
    /// this device is not on one.
    ///
    /// Four words on purpose: it shows in a small banner, and naming the host
    /// or explaining tailnets adds nothing to do — the fix is the VPN toggle
    /// either way.
    static func tailnetHint() async -> String? {
        guard let host = ServerConfig.shared.baseURL?.host(), !host.isEmpty,
              !deviceIsOnTailnet(),
              await serverIsOnTailnet(host)
        else { return nil }
        return "Not connected to Tailscale"
    }

    /// Errors that mean nothing came back. A refusal, a TLS failure or any
    /// HTTP status proves packets made the trip, so those keep their own
    /// wording — and so does "the Internet connection appears to be offline",
    /// which is already the whole story.
    nonisolated static func blamesTheNetwork(_ error: Error) -> Bool {
        switch (error as? URLError)?.code {
        case .timedOut, .cannotConnectToHost, .cannotFindHost,
             .dnsLookupFailed, .networkConnectionLost:
            true
        default:
            false
        }
    }

    // MARK: - This device

    /// Is one of our own interfaces on a tailnet? Carriers hand out 100.x
    /// addresses too — CGNAT is not Tailscale's alone, and a phone on cellular
    /// usually has one — so a v4 address only counts on a tunnel interface.
    /// The fd7a prefix is Tailscale's own and counts anywhere.
    nonisolated static func deviceIsOnTailnet() -> Bool {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return false }
        defer { freeifaddrs(head) }
        for interface in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let address = interface.pointee.ifa_addr else { continue }
            let tunnel = String(cString: interface.pointee.ifa_name).hasPrefix("utun")
            if isTailnetAddress(address, countingIPv4: tunnel) { return true }
        }
        return false
    }

    // MARK: - The server

    private static var tailnetHosts: [String: (answer: Bool, asked: Date)] = [:]

    /// Does the server's name land on a tailnet? A tailnet-only host still
    /// publishes its address, so this resolves from anywhere — including with
    /// the tunnel down, which is exactly when it's asked. Cached: the answer
    /// only changes when the server moves.
    private static func serverIsOnTailnet(_ host: String) async -> Bool {
        if isTailnetHostname(host) { return true }
        if let cached = tailnetHosts[host], Date().timeIntervalSince(cached.asked) < 300 {
            return cached.answer
        }
        let answer = await Task.detached(priority: .utility) {
            resolvesOntoTailnet(host)
        }.value
        tailnetHosts[host] = (answer, Date())
        return answer
    }

    /// Blocking name resolution — always off the main actor.
    private nonisolated static func resolvesOntoTailnet(_ host: String) -> Bool {
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var head: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &head) == 0, let first = head else { return false }
        defer { freeaddrinfo(head) }
        return sequence(first: first, next: { $0.pointee.ai_next }).contains {
            guard let address = $0.pointee.ai_addr else { return false }
            return isTailnetAddress(address, countingIPv4: true)
        }
    }

    private nonisolated static func isTailnetAddress(
        _ address: UnsafePointer<sockaddr>,
        countingIPv4: Bool
    ) -> Bool {
        switch Int32(address.pointee.sa_family) {
        case AF_INET where countingIPv4:
            address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                isTailnetIPv4(UInt32(bigEndian: $0.pointee.sin_addr.s_addr))
            }
        case AF_INET6:
            address.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { pointer in
                withUnsafeBytes(of: pointer.pointee.sin6_addr) {
                    isTailnetIPv6(Array($0.prefix(6)))
                }
            }
        default:
            false
        }
    }
}
