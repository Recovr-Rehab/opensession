import Foundation

@MainActor
enum SlackAPI {
    struct Channel: Decodable, Sendable, Identifiable, Hashable {
        let id: String
        let name: String
    }

    struct ChannelsResponse: Decodable, Sendable {
        let channels: [Channel]
        let defaultChannel: String?
    }

    private struct ErrorResponse: Decodable, Sendable {
        let error: String?
    }

    /// Configured Slack destinations for deliberate, human-authored posts.
    static func channels() async throws -> ChannelsResponse {
        let data = try await request("/api/slack/channels")
        return try JSONDecoder().decode(ChannelsResponse.self, from: data)
    }

    /// Post through the signed-in person's Slack grant. The server refuses to
    /// fall back to its bot identity, so success always means it appeared as them.
    static func post(channelId: String, text: String) async throws {
        let encoded = channelId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? channelId
        _ = try await request(
            "/api/slack/channels/\(encoded)/messages",
            method: "POST",
            body: ["text": text]
        )
    }

    private static func request(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil
    ) async throws -> Data {
        let config = ServerConfig.shared
        guard let base = config.baseURL, config.isConfigured else {
            throw OS1API.APIError.notConfigured
        }
        guard let url = URL(string: base.absoluteString + path) else {
            throw OS1API.APIError.badURL
        }
        var request = config.authorizedRequest(url)
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse,
           !(200..<300).contains(http.statusCode) {
            if let errorBody = try? JSONDecoder().decode(ErrorResponse.self, from: data),
               let message = errorBody.error {
                throw OS1API.APIError.server(message)
            }
            throw OS1API.APIError.http(http.statusCode)
        }
        return data
    }
}
