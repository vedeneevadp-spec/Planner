import Foundation

// Pure rotation decisions are shared by the Keychain bridge and executable tests.
// The caller holds the storage lock across read, decision and durable write.
enum PlannerAuthSessionRotation {
    static func prepare(latest: String?, expected: String) throws -> String {
        var current = try parse(latest)
        let attempt = try parse(expected)
        if current["refreshToken"] as? String != attempt["refreshToken"] as? String {
            return try serialize(current)
        }
        if current["refreshRotationRequestId"] == nil {
            current["refreshRotationRequestId"] = uuidV7()
        }
        return try serialize(current)
    }

    static func commit(latest: String?, attempted: String, refreshed: String) throws -> String {
        let current = try parse(latest)
        let attempt = try parse(attempted)
        let result = try parse(refreshed)
        let sameOperation = current["refreshToken"] as? String == attempt["refreshToken"] as? String
            && current["refreshRotationRequestId"] as? String == attempt["refreshRotationRequestId"] as? String
        guard sameOperation else { return try serialize(current) }
        guard current["userId"] as? String == result["userId"] as? String else {
            throw RotationError.invalidSession
        }
        return try serialize(result)
    }

    private static func parse(_ value: String?) throws -> [String: Any] {
        guard let value = value, let data = value.data(using: .utf8),
              var session = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RotationError.invalidSession
        }
        for field in ["accessToken", "email", "expiresAt", "refreshToken", "userId"] {
            guard let text = session[field] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw RotationError.invalidSession
            }
        }
        if session["refreshRotationRequestId"] is NSNull {
            session.removeValue(forKey: "refreshRotationRequestId")
        }
        if let marker = session["refreshRotationRequestId"] {
            guard let text = marker as? String,
                  text.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: [.regularExpression, .caseInsensitive]) != nil else {
                throw RotationError.invalidSession
            }
        }
        return session
    }

    private static func serialize(_ session: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: session, options: [.sortedKeys])
        guard let value = String(data: data, encoding: .utf8) else { throw RotationError.invalidSession }
        return value
    }

    private static func uuidV7() -> String {
        var random = UUID().uuid
        var bytes = withUnsafeBytes(of: &random) { Array($0) }
        let timestamp = UInt64(Date().timeIntervalSince1970 * 1000)
        for index in 0..<6 { bytes[index] = UInt8((timestamp >> ((5 - index) * 8)) & 0xff) }
        bytes[6] = (bytes[6] & 0x0f) | 0x70
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        let hex = bytes.map { String(format: "%02x", $0) }
        return [hex[0..<4], hex[4..<6], hex[6..<8], hex[8..<10], hex[10..<16]]
            .map { $0.joined() }.joined(separator: "-")
    }

    enum RotationError: Error { case invalidSession }
}
