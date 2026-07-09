//
//  TabFlowApp.swift
//  TabFlow iOS
//
//  Entry point for the SwiftUI app. iOS/iPadOS only — no macOS Catalyst
//  for now since the desktop extension already covers Mac users.
//

import SwiftUI

@main
struct TabFlowApp: App {
    var body: some Scene {
        WindowGroup {
            BrowserView()
        }
    }
}
