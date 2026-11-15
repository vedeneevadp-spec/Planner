import Foundation

func session(_ token: String, user: String = "user-a", marker: String? = nil) throws -> String {
    var data: [String: Any] = ["accessToken": "access", "email": "audit@example.test", "expiresAt": "2026-11-15T00:00:00Z", "refreshToken": token, "userId": user]
    if let marker = marker { data["refreshRotationRequestId"] = marker }
    return String(data: try JSONSerialization.data(withJSONObject: data), encoding: .utf8)!
}
func object(_ raw: String) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(raw.utf8)) as! [String: Any]
}
func check(_ condition: Bool) { precondition(condition) }
func rejects(_ run: () throws -> Void) {
    do { try run(); fatalError("Expected refusal") } catch { }
}

let original = try session("old")
let prepared = try PlannerAuthSessionRotation.prepare(latest: original, expected: original)
let marker = try object(prepared)["refreshRotationRequestId"] as! String
precondition(marker.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil)
let resumed = try PlannerAuthSessionRotation.prepare(latest: prepared, expected: original)
check(try object(resumed)["refreshRotationRequestId"] as? String == marker)
let rotated = try session("next")
let committed = try PlannerAuthSessionRotation.commit(latest: prepared, attempted: prepared, refreshed: rotated)
check(try object(committed)["refreshToken"] as? String == "next")
let stale = try PlannerAuthSessionRotation.commit(latest: committed, attempted: prepared, refreshed: try session("late"))
check(try object(stale)["refreshToken"] as? String == "next")
let stalePrepare = try PlannerAuthSessionRotation.prepare(latest: committed, expected: original)
check(try object(stalePrepare)["refreshToken"] as? String == "next")
rejects { _ = try PlannerAuthSessionRotation.commit(latest: nil, attempted: prepared, refreshed: rotated) }
rejects { _ = try PlannerAuthSessionRotation.prepare(latest: nil, expected: original) }
rejects { _ = try PlannerAuthSessionRotation.prepare(latest: "{}", expected: original) }
rejects { _ = try PlannerAuthSessionRotation.commit(latest: prepared, attempted: prepared, refreshed: session("bad", user: "another-user")) }
print("iOS auth rotation: durable retry marker, stale responses, logout, malformed data and account isolation passed.")
