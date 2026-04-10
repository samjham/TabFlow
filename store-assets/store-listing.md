# TabFlow — Chrome Web Store Listing

## Extension Name
TabFlow - Tab & Workspace Manager (BETA)

## Short Description (132 char max)
Organize your browser tabs into workspaces. Drag, drop, and switch contexts instantly. Optional encrypted cloud sync across devices.

## Detailed Description

TabFlow is a tab manager that lets you organize your browser tabs into color-coded workspaces. Think of workspaces like folders for your tabs — one for work, one for a side project, one for that rabbit hole you went down at 2am. Switch between them in one click.

This is an early beta — I built it for myself and I'm sharing it with friends. Feedback is welcome!

WHAT IT DOES

- Workspaces: Group your tabs into separate workspaces with custom names and colors. Only the tabs in your active workspace show up in your browser.
- Drag & Drop: Rearrange tab tiles by dragging them. Move tabs between workspaces with bulk actions.
- New Tab Override: Your new tab page becomes a visual dashboard of your current workspace's tabs.
- Search: Search across ALL your workspaces at once (Ctrl+K).
- Bulk Actions: Select all, move, duplicate, or delete multiple tabs at once.
- Memory Stats: See system and Chrome memory usage in the header.
- Workspace History: Accidentally close tabs? Restore previous workspace states.

CLOUD SYNC (OPTIONAL)

You can optionally sync your workspaces across devices using your own free Supabase project. Cloud sync is end-to-end encrypted — your tab URLs and titles are encrypted before they leave your device. Nobody (not even the database host) can read your data.

Cloud sync is 100% optional. TabFlow works great as a local-only extension too.

HOW TO SET UP CLOUD SYNC

1. Create a free account at supabase.com
2. Create a new project
3. Run the setup SQL (the extension walks you through this)
4. Enter your project URL and API key

The built-in setup wizard handles the whole process step by step.

PRIVACY

- Your data stays on your device unless you choose to enable cloud sync
- Cloud sync uses end-to-end encryption (AES-GCM) — your data is encrypted before it leaves Chrome
- No analytics, no tracking, no ads
- If you use cloud sync, you host your own database — I never see your data

THIS IS A BETA

This is an early version I'm sharing with friends and family. Things might break. If you run into issues, reach out and I'll fix them.

## Category
Productivity

## Language
English

## Single Purpose Description (for Chrome review)
TabFlow organizes the user's browser tabs into named, color-coded workspaces that can be switched between with one click, with optional encrypted cloud sync.
