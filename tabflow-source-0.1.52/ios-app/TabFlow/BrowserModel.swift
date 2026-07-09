//
//  BrowserModel.swift
//  TabFlow iOS
//
//  Owns the WKWebView and exposes navigation state to SwiftUI via
//  @Published properties. The single source of truth for the browser's
//  current state.
//

import SwiftUI
import WebKit

@MainActor
final class BrowserModel: NSObject, ObservableObject {
    @Published var canGoBack: Bool = false
    @Published var canGoForward: Bool = false
    @Published var isLoading: Bool = false
    @Published var estimatedProgress: Double = 0
    @Published var currentURL: String = ""
    @Published var pageTitle: String = ""

    /// Called when the webview's URL changes externally (link click,
    /// redirect, JS pushState). The view uses this to mirror the URL
    /// into the URL bar without overriding the user's current typing.
    var urlDidChange: ((String) -> Void)?

    let webView: WKWebView
    private var observers: [NSKeyValueObservation] = []

    override init() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // Shared cookie jar across all browsing in this app. Matches
        // the desktop TabFlow's effective behavior. When we add
        // per-workspace isolation later, this gets swapped for a
        // workspace-specific data store.
        config.websiteDataStore = .default()
        // Inline media — videos don't take over the screen.
        config.allowsInlineMediaPlayback = true
        // target=_blank handling: see WKUIDelegate below.
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        self.webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // KVO: mirror the WKWebView's state into @Published properties
        // so SwiftUI views can react.
        observers.append(webView.observe(\.canGoBack, options: [.new, .initial]) { [weak self] _, change in
            Task { @MainActor in self?.canGoBack = change.newValue ?? false }
        })
        observers.append(webView.observe(\.canGoForward, options: [.new, .initial]) { [weak self] _, change in
            Task { @MainActor in self?.canGoForward = change.newValue ?? false }
        })
        observers.append(webView.observe(\.isLoading, options: [.new, .initial]) { [weak self] _, change in
            Task { @MainActor in self?.isLoading = change.newValue ?? false }
        })
        observers.append(webView.observe(\.estimatedProgress, options: [.new, .initial]) { [weak self] _, change in
            Task { @MainActor in self?.estimatedProgress = change.newValue ?? 0 }
        })
        observers.append(webView.observe(\.url, options: [.new]) { [weak self] _, change in
            guard let urlString = (change.newValue ?? nil)?.absoluteString else { return }
            Task { @MainActor in
                self?.currentURL = urlString
                self?.urlDidChange?(urlString)
            }
        })
        observers.append(webView.observe(\.title, options: [.new]) { [weak self] _, change in
            let title = (change.newValue ?? nil) ?? ""
            Task { @MainActor in self?.pageTitle = title }
        })
    }

    // MARK: - Navigation actions

    /// Parse user input and load it. URLs load directly; bare hostnames
    /// get `https://` prefixed; anything else is treated as a search.
    func load(rawInput: String) {
        let trimmed = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let urlToLoad: URL
        if trimmed.lowercased().hasPrefix("http://") || trimmed.lowercased().hasPrefix("https://") {
            urlToLoad = URL(string: trimmed) ?? Self.searchURL(for: trimmed)
        } else if trimmed.contains(".") && !trimmed.contains(" ") {
            urlToLoad = URL(string: "https://\(trimmed)") ?? Self.searchURL(for: trimmed)
        } else {
            urlToLoad = Self.searchURL(for: trimmed)
        }

        webView.load(URLRequest(url: urlToLoad))
    }

    func goBack() { webView.goBack() }
    func goForward() { webView.goForward() }
    func reload() { webView.reload() }
    func stopLoading() { webView.stopLoading() }

    private static func searchURL(for query: String) -> URL {
        var components = URLComponents(string: "https://duckduckgo.com/")!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return components.url!
    }
}

// MARK: - WKNavigationDelegate
extension BrowserModel: WKNavigationDelegate {
    // Default-allow all navigation for now. Hook for content blockers,
    // custom scheme handling, etc. lives here later.
}

// MARK: - WKUIDelegate
extension BrowserModel: WKUIDelegate {
    /// Handle target=_blank and window.open() — for now, just load
    /// them in the same webview. When we add multi-tab support, this
    /// will create a new tab instead.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
