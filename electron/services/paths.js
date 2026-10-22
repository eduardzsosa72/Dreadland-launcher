import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Kept in its own file instead of launcher-state.json so renderer state saves can never wipe it
const ROOT_CONFIG_FILE = 'minecraft-root.json';

let customMinecraftRoot = undefined;

function rootConfigPath() {
  return path.join(app.getPath('userData'), ROOT_CONFIG_FILE);
}

function readCustomMinecraftRoot() {
  try {
    const raw = fs.readFileSync(rootConfigPath(), 'utf8');
    const dir = String(JSON.parse(raw)?.minecraftRoot || '').trim();
    return dir && path.isAbsolute(dir) ? dir : null;
  } catch {
    return null;
  }
}

export function getDefaultMinecraftRoot() {
  if (process.platform === 'win32') {
    const appDataDir = process.env.APPDATA || app.getPath('appData');
    return path.join(appDataDir, '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(app.getPath('home'), 'Library', 'Application Support', 'minecraft');
  }
  return path.join(app.getPath('home'), '.minecraft');
}

export function getMinecraftRoot() {
  if (customMinecraftRoot === undefined) customMinecraftRoot = readCustomMinecraftRoot();
  return customMinecraftRoot || getDefaultMinecraftRoot();
}

export function isCustomMinecraftRoot() {
  getMinecraftRoot();
  return Boolean(customMinecraftRoot);
}

export async function setCustomMinecraftRoot(dir) {
  const value = dir ? path.resolve(String(dir).trim()) : null;
  if (value) {
    await fs.promises.mkdir(value, { recursive: true });
    // Fail early on read-only drives or folders without permission
    const probe = path.join(value, `.write-test-${Date.now()}`);
    await fs.promises.writeFile(probe, '');
    await fs.promises.unlink(probe);
  }
  const isDefault = !value || path.resolve(value) === path.resolve(getDefaultMinecraftRoot());
  await fs.promises.mkdir(app.getPath('userData'), { recursive: true });
  await fs.promises.writeFile(rootConfigPath(), JSON.stringify({ minecraftRoot: isDefault ? null : value }, null, 2), 'utf8');
  customMinecraftRoot = isDefault ? null : value;
  return getMinecraftRoot();
}

export function getInstancesDir() {
  return path.join(getMinecraftRoot(), 'instances');
}

export function getInstanceDir(instanceId) {
  if (!instanceId) return getMinecraftRoot();
  return path.join(getInstancesDir(), String(instanceId));
}

export function getMinecraftRoots() {
  return [getMinecraftRoot()];
}
