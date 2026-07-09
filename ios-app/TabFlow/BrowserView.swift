//
//  BrowserView.swift
//  TabFlow iOS
//
//  Top-level view: URL bar + back/forward/reload + WKWebView area.
//  Single tab for now — multi-tab support comes in the next phase.
//

import SwiftUI

struct BrowserView: View {
    @StateObject private var browser = BrowserModel()
    @State private var urlBarText: String = "https://www.google.com"
    @FocusState private var urlBarFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // ── Navigation toolbar ──────────────────────────────────
            HStack(spacing: 8) {
                Button {
                    browser.goBack()
                } label: {
                    Image(systemName: "chevron.backward")
                        .font(.body.weight(.medium))
                        .frame(width: 32, height: 32)
                }
                .disabled(!browser.canGoBack)

                Button {
                    browser.goForward()
                } label: {
                    Image(systemName: "chevron.forward")
                        .font(.body.weight(.medium))
                        .frame(width: 32, height: 32)
                }
                .disabled(!browser.canGoForward)

                TextField("Search or enter URL", text: $urlBarText)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .focused($urlBarFocused)
                    .onSubmit {
                        browser.load(rawInput: urlBarText)
                        urlBarFocused = false
                    }

                Button {
                    if browser.isLoading {
                        browser.stopLoading()
                    } else {
                        browser.reload()
                    }
                } label: {
                    Image(systemName: browser.isLoading ? "xmark" : "arrow.clockwise")
                        .font(.body.weight(.medium))
                        .frame(width: 32, height: 32)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Color(.systemBackground))

            // ── Progress bar (only while loading) ───────────────────
            if browser.isLoading && browser.estimatedProgress > 0 && browser.estimatedProgress < 1 {
                ProgressView(value: browser.estimatedProgress)
                    .progressViewStyle(.linear)
                    .tint(.accentColor)
                    .frame(height: 2)
                    .transition(.opacity)
            }

            // ── WKWebView fills the rest ────────────────────────────
            WebViewRepresentable(webView: browser.webView)
                .ignoresSafeArea(edges: .bottom)
        }
        .onAppear {
            // Mirror the webview's URL into the URL bar whenever the
            // webview navigates (clicks, redirects, etc.), unless the
            // user is currently typing.
            browser.urlDidChange = { url in
                if !urlBarFocused {
                    urlBarText = url
                }
            }
            // First-launch: load initial page if the webview hasn't
            // loaded anything yet.
            if browser.webView.url == nil {
                browser.load(rawInput: urlBarText)
            }
        }
    }
}

#Preview {
    BrowserView()
}
