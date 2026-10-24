// The ONLY module in the UI that knows Electron exists.
// Everything else imports `api` from './index.js' and never touches window.launcher.
import { mockLauncher } from './mock';

const desktopBridge = typeof window !== 'undefined' && window.launcher ? window.launcher : null;

export const isDesktop = Boolean(desktopBridge);

const backend = desktopBridge || mockLauncher;

// Calls a method exposed by electron/preload.cjs (or its browser mock with the same name)
export function call(method, ...args) {
  const fn = backend[method];
  if (typeof fn !== 'function') {
    return Promise.reject(new Error(`Launcher method not available: ${method}`));
  }
  try {
    return Promise.resolve(fn.apply(backend, args));
  } catch (error) {
    return Promise.reject(error);
  }
}

// Subscribes to a main-process event; returns the unsubscribe function
export function subscribe(channel, listener) {
  if (typeof backend.on !== 'function') return () => { };
  const off = backend.on(channel, listener);
  return typeof off === 'function' ? off : () => { };
}

export function readProperty(name, fallback) {
  const value = backend[name];
  return value === undefined ? fallback : value;
}

// Synchronous helpers (no IPC round trip)
export function callSync(method, fallback, ...args) {
  const fn = backend[method];
  if (typeof fn !== 'function') return fallback;
  try {
    return fn.apply(backend, args);
  } catch {
    return fallback;
  }
}
