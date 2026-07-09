//
//  WebViewRepresentable.swift
//  TabFlow iOS
//
//  Bridges the UIKit-based WKWebView into SwiftUI. The WKWebView itself
//  lives in BrowserModel (kept alive across SwiftUI re-renders); this
//  view just embeds the existing instance.
//

import SwiftUI
import WebKit

struct WebViewRepresentable: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView {
        webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Nothing to do — BrowserModel mutates the WKWebView directly,
        // and SwiftUI re-renders are driven by its @Published changes.
    }
}
