import UIKit
import Capacitor
import Security

@objc(PlannerAuthStoragePlugin)
final class PlannerAuthStoragePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "PlannerAuthStoragePlugin"
    let jsName = "PlannerAuthStorage"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareRefresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commitRefresh", returnType: CAPPluginReturnPromise)
    ]

    private static let storageLock = NSLock()
    private let authSessionKey = "planner.auth.planner.auth.session"
    private let authLogoutKey = "planner.auth.planner.auth.session.loggedOut"

    private var service: String {
        "\(Bundle.main.bundleIdentifier ?? "ru.chaotika.app").planner.auth"
    }

    @objc func get(_ call: CAPPluginCall) {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard let key = call.getString("key") else {
            call.reject("Auth storage key is required.")
            return
        }

        do {
            if key == authSessionKey, try readValue(for: authLogoutKey) != nil {
                call.resolve(["value": NSNull()])
                return
            }
            let value = try readValue(for: key) ?? migrateLegacyValue(for: key)
            call.resolve(["value": value as Any])
        } catch {
            call.reject("Failed to read secure auth storage: \(error.localizedDescription)")
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("Auth storage key and value are required.")
            return
        }

        do {
            try writeValue(value, for: key)
            if key == authSessionKey { try deleteValue(for: authLogoutKey) }
            removeLegacyValue(for: key)
            call.resolve()
        } catch {
            call.reject("Failed to write secure auth storage: \(error.localizedDescription)")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard let key = call.getString("key") else {
            call.reject("Auth storage key is required.")
            return
        }

        do {
            if key == authSessionKey { try writeValue("1", for: authLogoutKey) }
            try deleteValue(for: key)
            removeLegacyValue(for: key)
            call.resolve()
        } catch {
            call.reject("Failed to remove secure auth storage.")
        }
    }

    @objc func prepareRefresh(_ call: CAPPluginCall) {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard let expected = call.getString("expectedSession") else {
            call.reject("A valid expected auth session is required.")
            return
        }
        do {
            guard try readValue(for: authLogoutKey) == nil else {
                throw PlannerAuthSessionRotation.RotationError.invalidSession
            }
            let latest = try readValue(for: authSessionKey) ?? migrateLegacyValue(for: authSessionKey)
            let prepared = try PlannerAuthSessionRotation.prepare(latest: latest, expected: expected)
            try writeValue(prepared, for: authSessionKey)
            call.resolve(["value": prepared])
        } catch {
            call.reject("Failed to prepare secure auth refresh.")
        }
    }

    @objc func commitRefresh(_ call: CAPPluginCall) {
        Self.storageLock.lock()
        defer { Self.storageLock.unlock() }
        guard let attempted = call.getString("attemptedSession"),
              let refreshed = call.getString("refreshedSession") else {
            call.reject("Valid attempted and refreshed auth sessions are required.")
            return
        }
        do {
            guard try readValue(for: authLogoutKey) == nil else {
                throw PlannerAuthSessionRotation.RotationError.invalidSession
            }
            let latest = try readValue(for: authSessionKey)
            let committed = try PlannerAuthSessionRotation.commit(latest: latest, attempted: attempted, refreshed: refreshed)
            try writeValue(committed, for: authSessionKey)
            call.resolve(["value": committed])
        } catch {
            call.reject("Failed to commit secure auth refresh.")
        }
    }

    private func readValue(for key: String) throws -> String? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw KeychainError(status: status)
        }

        return value
    }

    private func deleteValue(for key: String) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private func writeValue(_ value: String, for key: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError(status: errSecParam)
        }

        let query = baseQuery(for: key)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )

        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(status: updateStatus)
        }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)

        guard insertStatus == errSecSuccess else {
            throw KeychainError(status: insertStatus)
        }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
    }

    private func migrateLegacyValue(for key: String) throws -> String? {
        let legacyKey = "CapacitorStorage.\(key)"
        guard let value = UserDefaults.standard.string(forKey: legacyKey) else {
            return nil
        }

        try writeValue(value, for: key)
        UserDefaults.standard.removeObject(forKey: legacyKey)
        return value
    }

    private func removeLegacyValue(for key: String) {
        UserDefaults.standard.removeObject(forKey: "CapacitorStorage.\(key)")
    }
}

private struct KeychainError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
        SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    }
}

@objc(PlannerBridgeViewController)
final class PlannerBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PlannerAuthStoragePlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
