# Release checklist

Use this checklist for each public source release or packaged build. Start with fresh checkboxes and record the results, tested commit and known limitations in the release notes.

## Public source

- [ ] Review the staged changes and every file included in the release. Keep local caches, `node_modules`, build output, game files, companion saves and private workflow files out of source commits and archives.
- [ ] Run `npm run check:public` against the Git repository and review `git diff --cached --stat` and the staged diff. Ignore rules don’t remove files Git already tracks.
- [ ] Use invented data for fixtures, examples and screenshots. Check source files and release attachments for private data and credentials.
- [ ] Check that [LICENSE](LICENSE), the package licence field and [THIRD_PARTY.md](THIRD_PARTY.md) agree. Check permission and required notices for any third-party content you include.
- [ ] Verify that GitHub private vulnerability reporting is enabled and the repository's Security → Advisories page offers a private report option. Follow [SECURITY.md](SECURITY.md).

## Automated checks

From a clean checkout, using a supported Node.js version:

```powershell
npm ci
npm test
npm run check
npm run check:public
npm audit
npm audit --omit=dev
```

- [ ] Fix test and syntax failures, and review any dependency audit findings. Check the impact of dependency changes before applying them.
- [ ] Confirm that [Source checks](.github/workflows/checks.yml) passes for the release commit on every configured Windows/Node.js combination, and [Windows installer](.github/workflows/windows-build.yml) builds and passes both smoke checks. Dependency lifecycle scripts stay disabled; Electron is installed explicitly for desktop checks.
- [ ] Confirm that the package version and lockfile agree with the intended release version.

## Windows desktop verification

Run `npm run smoke` after installing the Electron runtime. It uses isolated invented data. Then manually check the app with demo data and record the Windows version used:

- [ ] Electron smoke test passes for the release commit.
- [ ] The main window opens. Sample data is clearly labelled and connecting a character is easy to follow.
- [ ] Item details show vendor estimates, listing age, available servers, goals and decisions. Matching listings and wiki links work.
- [ ] Automatic sessions can be revisited, renamed, split with a preview, merged and reset without changing records.
- [ ] Hunts can be started, ended, renamed and revisited.
- [ ] Solo hunts default to the current character; group members with no loot receive a share, and nearby non-members are excluded.
- [ ] Hunt settlements use item values only, block unresolved prices, preserve agreed prices/exclusions, and conserve whole copper across payments.
- [ ] Copied hunt messages use p/g/s/c, omit coin drops and fit within 240 characters including page numbers; verify pasting in game manually.
- [ ] The hunt overlay supports adding/removing members, preserves typed names during polling, and opens the matching hunt details.
- [ ] Running hunt copies mark provisional values and omit payments for unpriced loot; new overlays default to 100% background opacity while saved choices are preserved.
- [ ] End a solo and group hunt with unpriced loot. Confirm hunt details and the hunt overlay retain **Copy loot summary**, showing unpriced counts without payment instructions. Complete pricing and confirm settlement copying is available.
- [ ] Loot, session, timer and map overlays open, move and resize; pinning works; backgrounds at 0%, 15% and 100% keep text solid and windows visible.
- [ ] Hover over and click overlay backgrounds and controls while the app checks for updates. Confirm the overlay and its settings stay visible, main-window preference saves do not cover it, and reopening raises the existing overlay.
- [ ] Check overlay interaction with the game in windowed mode. Test borderless mode separately if available and record which display modes were tested.
- [ ] Map downloads start disabled. Test enabling, cancellation and offline use, marker filters, zoom and private pins. Confirm the map follows the zone without implying player-position tracking.
- [ ] With downloads off, follow from a cached zone to an uncached zone. Confirm **No cached map found** replaces the previous image and pins, and image controls are disabled until a map loads.
- [ ] Close and restart the app; verify saved preferences and companion records using test data.

## Release notes

- [ ] List the version, commit, supported platforms and runtime requirements.
- [ ] Summarise user-visible changes, known issues and any data-format or upgrade considerations.
- [ ] Record the checks actually performed, their results and any verification still outstanding. Describe overlay compatibility only for display modes that were tested.
- [ ] Include setup instructions for the files being published.

## Distribution

Build locally on Windows:

```powershell
npm ci
npm exec --no -- install-electron
npm run dist
npm run smoke:packaged
npm run release:checksums
```

`dist/` contains `Neverquest-Setup-<version>.exe`, its `.blockmap`, `latest.yml` and `SHA256SUMS.txt`. Publish all four together. The release workflow appends the downloaded build artifact’s SHA-256 checksums to the draft’s release notes. Do not hardcode a local installer’s hash into source release notes: a CI rebuild can produce different bytes. Do not upload `builder-debug.yml` or the unpacked application directory. No signing credentials are needed for the default unsigned build; state that status in the release notes. Source users can continue following the README.

For a release, update the package and lockfile version together (`npm version <version> --no-git-tag-version`), write `docs/releases/<version>.md`, commit the intended files, then push a matching stable `v<version>` tag. The Windows workflow validates the version and notes, builds with a read-only token, and uses a separate job to create a **draft** release. Review and test the draft’s exact installer before publishing it on GitHub. Drafts are not offered to installed clients.

Use one stable update channel. Never replace assets on a published version or reuse a tag. Fix a bad release with a higher version. Do not change the app ID, product name, installer identity or `%APPDATA%\Neverquest` path casually: these are part of upgrade continuity.

For each packaged build:

- [ ] Include only the intended app files. Leave out development tests, caches, saves and private data.
- [ ] Preserve Electron's `LICENSE`, `LICENSES.chromium.html` and applicable dependency notices.
- [ ] Check the final package for private data and test it from a clean Windows account.
- [ ] Publish checksums for the distributed files and state their signing status clearly.
- [ ] Verify the installer’s clean-account install, shortcuts, launch and uninstall; confirm uninstall preserves test records.
- [ ] Test upgrading a previous installed version to the candidate with invented history, goals, notes, pins and window settings. Check explicit restart and normal-quit installation, including with overlays open.
- [ ] Check interrupted/offline downloads, a missing release, a failed installer launch and insufficient disk space. Confirm failures leave the current app usable.
- [ ] Confirm update metadata names the uploaded installer and the checksums match the final assets. Finish uploading assets before publishing the draft.
- [ ] Confirm an unsigned build is labelled unsigned and does not claim publisher verification. If signing is added, verify the final EXE/installer Authenticode signatures and expected publisher in `resources/app-update.yml`.
- [ ] Keep a copy of the previous installer and test-data backup for recovery. Data-format changes need explicit versioned migrations and a separate pre-migration backup; the current update adds no format change.
