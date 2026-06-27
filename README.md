# Snapline

A local-first, project-based screenshot manager for Windows. Capture anything, file it into the right project automatically, and find any old screenshot by what is inside it.

Snapline was built to fix the one problem every screenshot tool ignores: organization. Most tools dump captures into a folder with names like `Screenshot_4729.png` and move on. Snapline makes the active project the center of the workflow, so every capture lands where it belongs, and an AI-powered index lets you search by content, not filename.

## Why it is different

- **Active-project capture.** Pick a project (a real folder on disk). Every screenshot you take files itself there automatically.
- **Real folders as the source of truth.** Projects are normal folders under a location you choose. Browse them in Explorer, drop older screenshots in, and Snapline indexes them automatically.
- **Find by content.** Local OCR plus optional Claude descriptions make screenshots searchable by the text and things visible in them.
- **One-click redaction.** Detect and permanently block emails, API keys, faces and other sensitive data before sharing.
- **Beautify for clients.** Add backgrounds, padding, rounded corners, shadows and social aspect ratios to turn a raw capture into a polished image.
- **Local-first and private.** Everything stays on your machine. AI features are optional and off until you add a key. No telemetry.

## Features

- Region, window and full-screen capture, plus a delayed (3 second) capture, all on global hotkeys.
- A library with a thumbnail grid, project sidebar, tags, favorites and fast full-text search.
- Drag screenshots between projects (moves the real file). Drop image files from Explorer to import.
- Annotation editor: arrows, boxes, ellipses, lines, free draw, highlighter, numbered steps, text and manual redaction.
- AI enrichment (opt-in): auto-naming, auto-tagging, content descriptions for search, and auto-filing of unfiled shots into the best-matching project.
- Pinned floating screenshots that stay on top while you work.
- System tray with quick capture and an active-project switcher.

## Setup

Requires Node.js 18+ (built and tested on Node 24).

```bash
npm install
npm run dev      # run in development
npm run build    # type-check and bundle
npm run dist     # build a Windows installer (NSIS) into dist/
```

On first launch, Snapline asks you to choose a storage folder. Projects and screenshots live there.

## Default hotkeys

| Action | Shortcut |
|---|---|
| Capture region | Ctrl + Shift + 1 |
| Capture window | Ctrl + Shift + 2 |
| Capture full screen | Ctrl + Shift + 3 |
| Delayed full screen (3s) | Ctrl + Shift + 4 |

All hotkeys are editable in Settings.

## AI features

AI is optional. To enable it, open Settings, turn on AI features, and paste an Anthropic API key. The key is stored encrypted on your machine using the OS keychain and never leaves the main process. You can choose the model (Opus, Sonnet or Haiku) to balance quality and cost. Local OCR works offline with no key.

## Privacy

Snapline is local-first by design. Your screenshots, the index and your settings stay on disk. The only outbound network calls happen when AI features are explicitly enabled, and they are clearly labeled in the interface.

## Architecture

Electron app. The main process owns all privileged work (global hotkeys, the system tray, screen capture, the file index, folder watching and Claude calls). Renderer windows are React and TypeScript built with Vite.

```
src/main/        Electron main process (capture, storage, index, AI, IPC, tray)
src/preload/     Secure context-bridge API exposed to renderers
src/renderer/    React UIs: library, capture overlay, editor, floating pin
src/shared/      Shared types and the IPC contract
```

Storage model: projects map to real folders under your chosen root. A JSON index plus a FlexSearch full-text index sit on top of those files. A folder watcher keeps the index in sync when you add or remove files outside the app.
