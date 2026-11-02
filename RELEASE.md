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
```

- [ ] Fix test and syntax failures, and review any dependency audit findings. Check the impact of dependency changes before applying them.
- [ ] Confirm that [Source checks](.github/workflows/checks.yml) passes for the release commit on every configured Windows/Node.js combination. The source workflow skips install scripts; desktop verification below requires the Electron runtime.
- [ ] Confirm that the package version and lockfile agree with the intended release version.

## Windows desktop verification

Run `npm run smoke` after installing the Electron runtime. It uses isolated invented data. Then manually check the app with demo data and record the Windows version used:

- [ ] Electron smoke test passes for the release commit.
- [ ] The main window opens. Sample data is clearly labelled and connecting a character is easy to follow.
- [ ] Item details show vendor estimates, listing age, available servers, goals and decisions. Matching listings and wiki links work.
- [ ] Automatic sessions can be revisited, renamed, split with a preview, merged and reset without changing records.
- [ ] Named runs can be started, ended, renamed and revisited.
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

Neverquest currently runs from source. Source releases should link to the [README](README.md) for setup instructions. There’s no installer, code signing or automated packaging yet.

For any future packaged build:

- [ ] Include only the intended app files. Leave out development tests, caches, saves and private data.
- [ ] Preserve Electron's `LICENSE`, `LICENSES.chromium.html` and applicable dependency notices.
- [ ] Check the final package for private data and test it from a clean Windows account.
- [ ] Publish checksums for the distributed files and state their signing status clearly.
