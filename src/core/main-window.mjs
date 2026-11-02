export function applyMainProfile(window, profile = {}, { restoreBounds = false } = {}) {
  if (!window || window.isDestroyed()) return false;
  let changed = false;
  const pinned = profile.pinned === true;
  if (window.isAlwaysOnTop() !== pinned) { window.setAlwaysOnTop(pinned); changed = true; }
  const opacity = (Number.isInteger(profile.opacity) ? Math.max(30, Math.min(100, profile.opacity)) : 100) / 100;
  if (Math.abs(window.getOpacity() - opacity) > 0.001) { window.setOpacity(opacity); changed = true; }
  if (restoreBounds && profile.bounds) {
    const current = window.getBounds(), saved = profile.bounds;
    if (['x', 'y', 'width', 'height'].some(key => current[key] !== saved[key])) { window.setBounds(saved); changed = true; }
  }
  return changed;
}
