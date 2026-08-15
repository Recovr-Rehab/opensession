/// The product's own branding, as the app shows it to a person.
///
/// The one place the app reads the product name from, so rebranding a fork is
/// a single edit rather than a hunt through view code. The web UI's
/// equivalent is `src/frontend/lib/brand.ts`, which hydrates from the server's
/// `branding.productName`. The app has no such bootstrap yet, so this is a
/// build-time constant; if one is added later, hydrate from it and keep the
/// value below as the fallback.
///
/// Not to be confused with `Brand` in `Views/BrandLogos.swift`, which is the
/// marks and colors of THIRD-PARTY services on the Connections screen.
///
/// The Home Screen, Dock and app menu labels do NOT come from here. Those are
/// `INFOPLIST_KEY_CFBundleDisplayName` and `INFOPLIST_KEY_CFBundleName` in
/// `project.yml`, and have to be kept in step with this by hand.
enum AppBrand {
    /// The full wordmark, as it appears in prose the app shows a person.
    static let productName = "Open Session"
}
