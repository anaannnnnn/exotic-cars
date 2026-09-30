/* A light tap of the vibration motor where the phone supports it (Android Chrome); silent elsewhere and when the
   visitor asked for less motion. */
export function haptic(ms = 8) {
  if (!navigator.vibrate) return;
  if (document.documentElement.dataset.motion === 'reduce') return;
  try { navigator.vibrate(ms); } catch { /* blocked until the first user gesture */ }
}
