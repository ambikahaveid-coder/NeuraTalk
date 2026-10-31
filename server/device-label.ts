/** Human-readable device names and browser detection from a User-Agent. */

export function describeDevice(ua: string | null | undefined): string {
  const s = String(ua ?? "").replace(/^\[Linked\]\s*/, "");
  const browser = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : /Dart|okhttp/i.test(s) || !s.trim() ? "NeuraTalk app" : "Browser";
  const os = /Windows/.test(s) ? "Windows" : /Mac OS X/.test(s) && !/iPhone|iPad/.test(s) ? "Mac" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iPhone" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/**
 * True for a real web browser (Chrome, Edge, Firefox, Safari), including
 * computers linked by QR. False for the NeuraTalk app, which signs in either
 * natively (Dart) or through an Android WebView ("; wv)").
 */
export function isBrowserAgent(ua: string | null | undefined): boolean {
  const s = String(ua ?? "");
  return /Mozilla\//.test(s) && /(Safari|Firefox)\//.test(s) && !/; wv\)/.test(s);
}
