# TabFlow iOS

iOS/iPadOS browser app for TabFlow. Built on WKWebView (per Apple's
WebKit-only mandate). This is the starting scaffold — a single-tab
browser with URL bar and back/forward. Tabs, workspaces, and Supabase
sync come in later phases.

## What you need

- A Mac with **Xcode 15.3 or later** (free from the Mac App Store).
- An Apple ID. A paid Apple Developer Program membership ($99/year)
  is only needed to ship to the App Store — for development on the
  simulator and your own iPhone, the free personal team is enough.

## Setting up the Xcode project

The Swift source files are here, but Xcode's project file format
(`.xcodeproj`) is opaque and brittle to generate by hand. So you'll
create the project yourself and drop these files in.

1. Open Xcode → **File → New → Project…**
2. Choose template: **iOS → App**. Click Next.
3. Fill in:
   - **Product Name:** `TabFlow`
   - **Team:** your Apple ID (or "None" for sim-only)
   - **Organization Identifier:** `dev.samhamilton` (or anything unique
     to you in reverse-DNS form — this combines with the product name
     to form the bundle ID, e.g. `dev.samhamilton.TabFlow`)
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None
   - **Include Tests:** unchecked for now
4. Save location: pick anywhere — Xcode will create a `TabFlow/`
   folder containing the `.xcodeproj` and a starter `TabFlow/` source
   folder.
5. Once the project opens, **delete** these starter files Xcode
   created (right-click → Delete → Move to Trash):
   - `ContentView.swift`
   - `TabFlowApp.swift`
   (Keep `Assets.xcassets`, `Preview Content/`, and the project file.)
6. **Add my source files.** In Finder, copy the four `.swift` files
   from this `ios-app/TabFlow/` folder into the Xcode-generated
   `TabFlow/` folder (the one with `Assets.xcassets`). Then in Xcode,
   right-click the `TabFlow` group → **Add Files to "TabFlow"…** →
   select the four `.swift` files → Add.
7. Set the **Minimum Deployment** in Xcode (click the project at top
   of the Navigator → General tab → Deployment Info) to **iOS 17.0**.
   Lower is possible but the code uses iOS 17 features (e.g.
   `.focusable`, `@Observable`-adjacent patterns).
8. **Run on the simulator:** pick an iPhone simulator from the device
   menu at the top of Xcode → press Cmd+R. The app should launch and
   load google.com. Type any URL or search query in the bar and press
   Return to navigate.
9. **Run on your iPhone (optional):** plug in your iPhone via USB,
   trust the computer when prompted. Pick your phone in Xcode's device
   menu. On first run you'll have to trust the developer cert on the
   phone (Settings → General → VPN & Device Management → your Apple
   ID → Trust). Then Cmd+R.

## What this scaffold does

- Single full-screen `WKWebView` filling the screen below a URL bar.
- URL bar that accepts:
  - Full URLs (`https://example.com`)
  - Bare hosts (`example.com` — auto-prefixed with `https://`)
  - Search queries (anything that doesn't look like a host — routed
    to DuckDuckGo)
- Back / Forward buttons (disabled when not navigable).
- Reload / Stop button (toggles based on loading state).
- Progress bar at the top while a page loads.
- Swipe-back / swipe-forward edge gestures (Apple standard).
- Shared cookie jar (`WKWebsiteDataStore.default()`) — matches the
  desktop TabFlow's behavior. Per-workspace isolation can be added
  later by swapping the data store per webview.

## What's NOT in this scaffold yet

- Multiple tabs (next phase)
- Workspaces (later phase)
- Supabase sync (later phase)
- Bookmarks, history, downloads, settings
- Search engine choice
- Reader mode, content blockers

## Architecture sketch

- `TabFlowApp` — the SwiftUI `@main` entry point.
- `BrowserView` — the top-level view. Owns the `BrowserModel`, the
  URL bar, and embeds the WebView.
- `BrowserModel` — `ObservableObject`. Holds the `WKWebView`,
  exposes `@Published` navigation state (canGoBack/Forward, loading,
  progress, currentURL). Handles URL parsing and search routing.
  Conforms to `WKNavigationDelegate` and `WKUIDelegate`.
- `WebViewRepresentable` — `UIViewRepresentable` wrapper that bridges
  the `WKWebView` (UIKit) into SwiftUI. The webview itself lives in
  `BrowserModel` so it persists across SwiftUI redraws.

## When you hit issues

Paste me build errors or runtime logs and I'll revise. Xcode's
console shows runtime logs; the build output panel shows compile
errors. Both can be copy-pasted.
