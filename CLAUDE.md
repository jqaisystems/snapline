# CLAUDE.md (Snapline)

Guidance for Claude Code when working in this project. See the workspace `CLAUDE.md` one level up for the Writing Golden Rules (no em dashes in any written output).

## What this is

Snapline is a local-first, project-based screenshot manager for Windows, built with Electron + React + TypeScript (electron-vite). It captures screenshots, files them into project folders on disk, indexes them for search, and offers an annotation/redaction/beautify editor plus optional Claude-powered enrichment.

## Commands

```bash
npm run dev        # run in development (electron-vite dev)
npm run build      # type-check + bundle to out/
npm run dist       # Windows NSIS installer into dist/
npm run typecheck  # tsc --noEmit
python scripts/generate_icons.py   # regenerate app + tray icons
```

## Architecture

- **Main process** (`src/main/`) owns everything privileged. Key modules:
  - `store.ts` JSON-backed data store (projects, screenshots, tags, settings) in userData; API key encrypted via `safeStorage`.
  - `search.ts` FlexSearch full-text index over OCR text, AI fields, tags, names.
  - `capture.ts` desktopCapturer region/window/full-screen; drives the overlay window.
  - `captureFlow.ts` orchestration: capture, save to disk, index, clipboard, post-capture action.
  - `storageFs.ts` real on-disk files: project folders, naming, thumbnails (Electron `nativeImage`), move/import/delete.
  - `watcher.ts` chokidar watch of the storage root so external file drops/removals sync to the index.
  - `ai.ts` Claude enrichment + PII detection (opt-in). `ocr.ts` local Tesseract.
  - `pipeline.ts` background OCR + AI enrichment queue.
  - `media.ts` custom `snapmedia://` protocol so renderers can show local images.
  - `ipc.ts` registers every IPC handler. `windows.ts` window factory. `tray.ts`, `hotkeys.ts`.
- **Preload** (`src/preload/index.ts`) exposes the typed `window.snapline` API via contextBridge.
- **Renderer** (`src/renderer/`): four windows, each its own HTML entry and React app under `src/renderer/src/{library,overlay,editor,pin}`. Shared UI in `src/renderer/src/ui`.
- **Shared** (`src/shared/types.ts`) is the single source of truth for data types and the IPC contract (`SnaplineApi`).

## Conventions

- No native node modules. Image work uses Electron `nativeImage` and HTML canvas (Konva); search is FlexSearch; storage is JSON. This keeps installs reliable on Windows.
- Projects are real folders under the user-chosen storage root. The JSON index is a view over those files, never the source of truth. Always keep the two in sync (see `moveScreenshotFile`, the watcher, and `getScreenshotByPath`).
- All main to renderer updates go through `broadcastSnapshot()` which pushes the full `LibrarySnapshot`. Renderers subscribe via `useSnapshot()`.
- AI is opt-in and must always degrade gracefully to a no-op when disabled or on error.
- When using the Anthropic SDK, follow the `claude-api` skill. Default model is `claude-opus-4-8`; it is user-configurable in Settings.

## Status (updated 2026-06-23)

Core app + editor complete and verified live. Five renderer windows now: library, overlay, editor,
pin, scrollctl. Four post-launch "improvement" directions chosen; three done, one remaining.

- DONE Bulk organize + speed: multi-select (Ctrl/Shift-click), bulk move/tag/favorite/delete,
  keyboard nav, virtualized `Grid.tsx`.
- DONE Scrolling capture: user scrolls, auto-stitch via row-luminance SAD on `nativeImage.toBitmap()`
  BGRA buffers (`scrollCapture.ts` + `scrollctl` control window; main window auto-hides during capture).
- DONE Brand-designer tools (editor `App.tsx`): browser/dark window frames, savable beautify presets
  (`Settings.beautifyPresets`), image-color palette extraction, pipette eyedropper (picked color saved
  to `Settings.customColors`).
- DONE (2026-06-26) Capture resolution + zoom/magnifier: window capture now grabs at native px
  (`capture.ts maxNativeSize()`, was a fixed 3000x2000). Editor + pin scroll-zoom-to-cursor (CSS
  transform; Save stays 1:1), Space/middle-drag pan, crisp-zoom via Konva layer `pixelRatio` raised
  with zoom (capped at native `dpr/fit`), magnifier loupe (editor toggle + always-on in region overlay),
  and an Illustrator-style zoom tool: hold Ctrl+Shift = zoom-in cursor (drag a box = zoom-to-area),
  Ctrl+Shift+Alt = zoom-out. Caveat: Ctrl+Shift may collide with Windows keyboard-layout hotkey.
- DONE (2026-06-27) Light theme: `global.css` now defines a `html[data-theme='light']` palette plus
  semantic tokens (`--border-hover`, `--accent-text`, `--accent-border`, `--backdrop`, `--canvas`,
  `--thumb-bg`, `--ring`, etc.) that flip with theme. Applied in library + editor via `applyTheme()`
  in `ui/api.ts` (cached to localStorage + `initThemeFromCache()` in each `main.tsx` to avoid a
  launch flash). Settings > General has a Light/Dark toggle. Capture-time overlays (overlay, pin,
  scrollctl) intentionally stay dark: they float over arbitrary screen content.
- DONE (2026-06-27) UI localization (English default, translation-ready): dependency-free i18n in
  `renderer/src/ui/i18n/` (`index.ts` = `t()`/`setLocale()`/`initLocaleFromCache()`/`LOCALES` registry,
  `en.ts` = 331-key English dictionary). All user-facing strings in library, editor, and settings go
  through `t('namespace.key')`; module-scope label arrays store key strings and call `t()` at render.
  `Settings.locale` field (default `'en'`); `setLocale()` called render-time in library + editor;
  cached to localStorage + `initLocaleFromCache()` in each `main.tsx`. Adding a language = add a
  `<code>.ts` dict + register in `LOCALES`; a Language picker auto-appears in Settings once >1 locale.
  Capture-time overlays (overlay/pin/scrollctl) not localized (few words, deferred with the theme).
- DONE (2026-06-27) Auto-update (electron-updater, GitHub Releases provider): `src/main/updater.ts`
  (`initUpdater()` = startup + 6h background check, download, install on quit via `autoInstallOnAppQuit`;
  `checkForUpdatesManual()` for the tray "Check for updates…" item; native Notification with in-app
  toast fallback; no-op when `!app.isPackaged`). `publish:` block in `electron-builder.yml` = github
  owner `jqaisystems` repo `snapline`, now a **public** repo (electron-updater's github provider needs
  public Releases + no runtime token). electron-updater stays external via `externalizeDepsPlugin`. To
  ship a release: `GH_TOKEN=$(gh auth token) npm run dist -- --publish always` (bump `version` first).
  Can't be tested in dev (packaged-only by design). Unsigned auto-update works; SmartScreen publisher
  warning is the separate code-signing item below.
- DONE (2026-06-28) Full audit (4 parallel agents) + must-fix cluster fixed: (a) **atomic store write**
  — `store.ts` writes tmp+rename, keeps `.bak`, recovers from `.bak` on parse failure (was: direct
  writeFileSync → crash mid-write wiped the whole library). (b) **flush-after-fs-op** — `store.flush()`
  now called synchronously after capture/move/trash/restore/delete/import/saveEdited so a crash can't
  strand a file with a stale index. (c) **light-theme dark-flash** fixed (gate `applyTheme` on `snap`).
  (d) **updateProject whitelist** (drops folderName/id from patches) + `deleteProject` rmSync now
  asserts the target resolves to a direct child of the storage root. Tests/typecheck/build/boot all
  green. NOT yet fixed (known, lower priority): packaged OCR is online-only (eng.traineddata not bundled
  — needs `extraResources` + `langPath`/`cachePath` in `ocr.ts`); `snapmedia://` reads any abs path
  (confine to storageRoot); `aiBaseUrl` SSRF; `hiddenPaths` unbounded; `sandbox:false`; build doesn't
  run typecheck. See git history / this entry for the audit backlog.
- DONE (2026-06-27) Recently-deleted trash + undo: "Delete" now moves files to a hidden
  `.snapline-trash/` folder under the storage root (watcher ignores dotfiles, so no index churn) instead
  of unlinking. `TrashedScreenshot` type + `store.trash` + `src/main/trash.ts` (`trashById`/`restoreById`/
  `deletePermanentlyById`/`emptyTrash`/`purgeExpiredTrash`); thumbnails kept through trashing for previews;
  restore goes back to the original project (or Unfiled if gone). `settings.trashRetentionDays` (default 30,
  0 = forever) auto-purges on startup. IPC `restoreTrashed`/`deleteTrashedPermanently`/`emptyTrash`.
  UI: "Recently deleted" sidebar view (`TrashView.tsx`) with Restore/Delete-forever/Empty, retention
  control in Settings, and an actionable **Undo toast** (`showActionToast` in `ui/hooks.tsx`) after every
  delete (Detail + bulk). "Remove from Snapline" (hide, keep file) unchanged. Fully localized (en+pt).
- TODO NEXT SESSION — Ship-ready (last item): code-signing path (avoid Windows "unknown publisher"
  warning). Ask first: whether a paid OV/EV code-signing cert is wanted (EV clears SmartScreen instantly).
  Also: auto-update repo `jqaisystems/snapline` now exists + project is under git (pushed private);
  remaining publish steps are GH_TOKEN + `npm run dist -- --publish always`.

## Deferred / future (outside the 4 directions)

- GIF/video recording; vector-embedding semantic search; packaged-build offline OCR (bundle Tesseract
  language data); per-project mood-board view; quick-share links.
