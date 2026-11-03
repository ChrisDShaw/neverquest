export function overlaySettings(companion, kind) {
  const saved = companion?.data.profiles[companion.sourceId]?.overlays?.[kind];
  return { background: Number.isInteger(saved?.background) ? Math.max(0, Math.min(100, Math.round(saved.background / 5) * 5)) : 100,
    pinned: saved?.pinned !== false };
}

export function applyOverlayProfile(panel, settings, { raise = false } = {}) {
  // Background alpha belongs to CSS. Calling native setOpacity, even with 1,
  // can make a transparent window disappear on Windows.
  if (panel.isDestroyed()) return;
  if (panel.isAlwaysOnTop() !== settings.pinned) panel.setAlwaysOnTop(settings.pinned);
  if (raise && settings.pinned && panel.isVisible()) panel.moveTop();
}

export function revealOverlay(panel) {
  if (panel.isDestroyed()) return;
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.moveTop();
  panel.webContents.invalidate();
}

export async function configureOverlay(companion, panels, kind, background, pinned) {
  if (!panels.has(kind) || !Number.isInteger(background) || background < 0 || background > 100)
    throw new Error('Open the overlay and choose a background opacity from 0 to 100.');
  const profile = companion.data.profiles[companion.sourceId] ??= {};
  profile.overlays ??= {};
  profile.overlays[kind] = { background: Math.round(background / 5) * 5, pinned: pinned === true };
  await companion.store.save();
  const settings = overlaySettings(companion, kind), panel = panels.get(kind);
  if (panel) applyOverlayProfile(panel, settings);
  return settings;
}
