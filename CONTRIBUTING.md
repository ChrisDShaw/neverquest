# Contributing

Thanks for helping improve Neverquest. Focus changes on things that help people while they play. The app targets Windows and uses Electron, Node built-ins and browser APIs.

Before adding a dependency, explain why it’s needed and check where it comes from, how it’s maintained and what its licence allows.

## Run the app

Use Node.js 22.12 or newer and npm. Windows CI is configured for Node 22.12 and Node 24.

```powershell
npm ci
npm exec --no -- install-electron
npm test
npm run check
npm run check:public
npm start
```

`npm ci` installs the locked dependencies. The pinned Electron package has no install script; `npm exec --no -- install-electron` uses its local installer to download the official runtime and verify it against the package’s bundled checksums by default. Run both commands before running the app or the smoke test locally. Electron can also download the runtime on first launch if it is missing.

`.npmrc` disables dependency lifecycle scripts for both local and CI installs. Source checks need no Electron binary. The Windows installer workflow installs the runtime explicitly and runs both source and packaged smoke checks.

## Build a Windows installer

```powershell
npm run dist
npm run smoke:packaged
npm run release:checksums
```

`npm run dist:dir` builds only the unpacked application for quick checks. Packaging generates the app’s compass icon and runtime dependency notices, includes the explicit source allowlist and production dependencies, and writes installers to ignored `dist/`. The icon and notice intermediates live in ignored `build/`. No transpilation or frontend framework is required.

The builder and updater are pinned to compatible 26.x/6.x versions that support unsigned Windows NSIS installs. Review the installed APIs and signing requirements before a major upgrade. The current build dependency audit reports moderate minimatch denial-of-service findings in tooling; these are not runtime dependencies. Avoid npm’s suggested forced downgrade of the entire builder. Run `npm audit --omit=dev` to assess shipped dependencies separately.

`electron-builder.config.cjs` owns the stable app ID, installer identity and fixed GitHub update source. Default builds are unsigned and show this status in Preferences. Future signing can use `NEVERQUEST_PUBLISHER` (certificate subject), `CSC_LINK` (PFX location or base64 certificate) and `CSC_KEY_PASSWORD`; set both publisher and certificate or leave both absent. Signing builds require successful signing and embed the expected publisher for update verification. Keep credentials outside Git. CI currently builds unsigned and requires no signing secrets.

## Test your changes

Tests use Node’s built-in runner and invented game records. Add tests when changing parsing, saved data or security behaviour. Choose checks that verify useful behaviour; avoid tests that simply repeat the implementation.

Run `npm run smoke` on a Windows desktop to check app workflows in Electron. It uses a unique `neverquest-smoke` folder in the OS temporary directory, invented game records and fake market and map data. Keep it isolated: it must not read real game files, contact providers, open browser links, use the clipboard or capture the screen. `npm run smoke:packaged` checks the unpacked app’s startup, renderer isolation, IPC, update UI and runtime dependency loading without making update requests.

The smoke test covers item details, goals, decisions, notes, hunts, session editing, bookmarks, gathering, timers, audio and overlays. It also checks navigation and that the renderer has no Node access. Follow the manual checks in [RELEASE.md](RELEASE.md) to check appearance and desktop interaction too.

## Protect player data

- Use invented data in tests, examples, screenshots, issues and pull requests. Keep real ledgers, character and account names, personal paths, chat, notes, pins, exports and credentials out of the repository.
- Keep local caches and smoke-test data under the ignored `.local/` folder.
- Leave character saves and their backups in the app’s data folder. On Windows, history normally lives in `%APPDATA%\Neverquest\collection.json`.
- Keep ignore and scanner rules generic. Private names and paths don’t belong in `.gitignore`, tests, scanner rules or CI configuration.
- Run `npm run check:public` before committing. It checks file paths, source-file types, personal absolute paths and common credential patterns. In a Git repository it checks staged and working files, including tracked files covered by ignore rules.
- Review the staged diff and where test data came from yourself. The scanner can’t tell whether every character name is invented.

## Read game files carefully

Use Character and Social ledgers and their archive for activity. While the map is open, read only zoning messages from `Player.log`. Keep game files read-only and player records local. Changes must not add monitoring of game processes, memory, windows, input, screenshots or network traffic.

The ledger reader caches unchanged files and retries incomplete writes. It removes duplicate Character/Social copies and archive overlap while preserving repeated actions within a file. Imported records stay in local history even if source rows disappear. On first use, it also migrates the folder choice from the original `preferences.json` format.

Connecting a character also imports the other discovered characters' ledgers and archives under the same game-data root. Background imports run every ten seconds using cached readers, preserve saved history, and must not change the selected character, move hunts or replay alerts. Previously imported folders are also refreshed when available.

Vendor prices are calculated from whole-stack sales across imported characters on the same server. Divide each sale by its quantity, round down to whole copper, and use the median unit price. Keep unknown values distinct from zero, and keep item estimates, full coin drops and recorded personal shares separate.

## Handle downloaded content safely

Keep remote requests behind the main-process APIs and their fixed destination rules. Display untrusted strings as text, preserve download limits, and keep renderer sandboxing and context isolation enabled. See [SECURITY.md](SECURITY.md) for the exact checks and limitations.

The renderer has no Node integration. A small preload bridge exposes specific operations. Local assets and sounds use a restricted app protocol and content security policy. Block arbitrary navigation, popups, embedded pages, permission requests and renderer network access. Keep exports outside known game-data folders.

## Project layout

```text
src/main.mjs           Electron startup, dialogs, local protocol and IPC
src/preload.cjs        Isolated bridge between the UI and main process
src/core/             File reading, saved records and app actions
src/renderer/         App screens, overlays and shared calculations
src/smoke.mjs         Electron workflow checks using sample data
scripts/              Syntax, public-file and smoke-test commands
tests/                Unit and integration tests
```

Saves use atomic replacement: write a new file, then replace the existing save. The previous collection is kept as `collection.json.bak`. Preserve unreadable history and report the problem rather than replacing it with an empty save.

## Write clearly

Use everyday words, short paragraphs and direct instructions. Start with what the reader needs to know. Explain unfamiliar terms when they first appear, and give errors a useful next step. Keep a little adventure flavour where it helps; keep controls and recovery messages clear.

Use **session** for automatically grouped activity and **hunt** for activity someone starts and ends themselves. Use **coin drops**, **recorded loot** and **net vendor earnings** consistently. Make clear when records include nearby players or estimates. Preserve standard licence text when editing documentation.

## Send a pull request or report

Explain what changes for the user and how you checked it. Include invented data that helps someone reproduce the problem. Use issues for feature requests and non-sensitive bugs. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

Contributions to the original source use the project’s [MIT licence](LICENSE). Keep any required third-party notices and describe them in [THIRD_PARTY.md](THIRD_PARTY.md).
