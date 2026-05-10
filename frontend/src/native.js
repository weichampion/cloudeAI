let StatusBar;

async function loadPlugins() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    ({ StatusBar } = await import('@capacitor/status-bar'));
  } catch {}
}

export async function initNative() {
  await loadPlugins();
  if (StatusBar) {
    await StatusBar.setStyle({ style: 'dark' }).catch(() => {});
    await StatusBar.setBackgroundColor({ color: '#1e293b' }).catch(() => {});
  }
}

export async function getPlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}
