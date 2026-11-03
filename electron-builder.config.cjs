// Keep the app identity stable: changing it can break upgrades and shortcuts.
const publisher = process.env.NEVERQUEST_PUBLISHER?.trim();
const signed = Boolean(publisher && process.env.CSC_LINK);
if (Boolean(publisher) !== Boolean(process.env.CSC_LINK)) {
  throw new Error('Signing needs both NEVERQUEST_PUBLISHER and CSC_LINK. Leave both unset for an unsigned build.');
}

module.exports = {
  appId: 'com.chrisdshaw.neverquest',
  productName: 'Neverquest',
  copyright: 'Copyright © 2026 Neverquest contributors',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**', '!src/smoke.mjs', '!src/smoke-fixtures.mjs', 'package.json', 'LICENSE', 'THIRD_PARTY.md'],
  asar: true,
  extraResources: [{ from: 'build/THIRD-PARTY-LICENSES.txt', to: 'THIRD-PARTY-LICENSES.txt' }],
  npmRebuild: false,
  extraMetadata: { neverquestRelease: { signed, publisher: signed ? publisher : null } },
  publish: { provider: 'github', owner: 'ChrisDShaw', repo: 'neverquest', releaseType: 'draft' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    signAndEditExecutable: true,
    forceCodeSigning: signed,
    signtoolOptions: signed ? { publisherName: publisher } : undefined
  },
  nsis: {
    oneClick: true, perMachine: false, runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    artifactName: 'Neverquest-Setup-${version}.${ext}'
  }
};
