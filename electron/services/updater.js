import { app, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { loadLauncherState } from '../../src/lib/launcherState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPDATE_REPOSITORY = 'eduardzsosa72/Dreadland-launcher';
const UPDATE_RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
const UPDATE_RELEASES_PAGE = `https://github.com/${UPDATE_REPOSITORY}/releases/latest`;
// Only files attached to this repo's releases may be downloaded and run
const UPDATE_DOWNLOAD_PREFIX = `https://github.com/${UPDATE_REPOSITORY}/releases/download/`;
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt';

const localeCache = new Map();

// Last update found by checkForLauncherUpdate. The renderer only asks to apply it;
// it never gets to choose which URL is downloaded and executed.
let pendingUpdate = null;

export async function loadLocaleData(language = 'en') {
  const lang = String(language || 'en').trim().toLowerCase();
  if (localeCache.has(lang)) return localeCache.get(lang);

  try {
    const localePath = path.resolve(__dirname, `../../src/locales/${lang}.json`);
    const content = await fs.promises.readFile(localePath, 'utf8');
    const parsed = JSON.parse(content);
    localeCache.set(lang, parsed);
    return parsed;
  } catch {
    if (lang !== 'en') {
      return loadLocaleData('en');
    }
    return {};
  }
}

export async function getUpdaterStrings(language) {
  const locale = await loadLocaleData(language);
  return locale?.updater || {};
}

export function versionToTuple(version) {
  const value = String(version || '').trim();
  const lower = value.toLowerCase();
  let versionType = 2;
  if (lower.includes('alpha')) versionType = 0;
  else if (lower.includes('beta')) versionType = 1;
  const match = value.match(/(\d+(?:\.\d+)*)/);
  if (!match) return [versionType, 0];
  return [versionType, ...match[1].split('.').map(part => Number(part) || 0)];
}

export function compareVersionTuples(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

export function normalizeReleaseVersionTag(release) {
  const raw = String(release?.tag_name || release?.name || '').trim();
  return raw.replace(/^v/i, '');
}

export function isLaunchableUpdateAsset(assetName) {
  const lowerName = String(assetName || '').toLowerCase();
  if (process.platform === 'win32') {
    return lowerName.endsWith('.exe') || lowerName.endsWith('.zip');
  }
  if (process.platform === 'linux') {
    return lowerName.endsWith('.appimage') || lowerName.endsWith('.deb') || lowerName.endsWith('.tar.gz') || lowerName.endsWith('.tar.xz');
  }
  if (process.platform === 'darwin') {
    return lowerName.endsWith('.dmg') || lowerName.endsWith('.zip');
  }
  return lowerName.endsWith('.exe') || lowerName.endsWith('.appimage');
}

export function formatI18nMessage(template, values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => {
    return values[key] !== undefined ? String(values[key]) : match;
  });
}

export async function getPreferredLanguage() {
  try {
    const state = await loadLauncherState(app.getPath('userData'));
    return state.settings?.language || 'en';
  } catch {
    return 'en';
  }
}

export function pickUpdateAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (assets.length === 0) return null;
  const platform = process.platform;
  const scoredAssets = assets
    .filter(asset => asset && typeof asset === 'object')
    .filter(asset => !/source code/i.test(String(asset.name || '')))
    .map(asset => {
      const assetName = String(asset.name || '').toLowerCase();
      let score = 0;
      if (platform === 'win32') {
        if (assetName.endsWith('.exe')) {
          if (assetName.includes('portable')) {
            score += 80;
          } else {
            score += 100;
          }
        }
        if (assetName.includes('setup') || assetName.includes('installer')) score += 20;
        if (assetName.endsWith('.zip')) score += 90;
        if (assetName.includes('win')) score += 5;
      } else if (platform === 'linux') {
        if (assetName.endsWith('.appimage')) {
          score += process.env.APPIMAGE ? 120 : 100;
        }
        if (assetName.endsWith('.deb')) {
          score += 90;
        }
        if (assetName.endsWith('.tar.gz') || assetName.endsWith('.tar.xz')) {
          score += 80;
        }
        if (assetName.includes('linux')) score += 5;
      } else if (platform === 'darwin') {
        if (assetName.endsWith('.dmg')) score += 100;
        if (assetName.endsWith('.zip')) score += 80;
        if (assetName.includes('mac')) score += 10;
      }
      return { asset, score };
    })
    .sort((left, right) => right.score - left.score);
  if (scoredAssets.length === 0) return null;
  return scoredAssets[0].asset;
}

export function isTrustedUpdateUrl(url) {
  return typeof url === 'string' && url.startsWith(UPDATE_DOWNLOAD_PREFIX) && !url.includes('..');
}

function normalizeSha256(value) {
  const hex = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(hex) ? hex : null;
}

// Parses "sha256sum" output: "<hex>  <file name>" per line
export function parseChecksumsFile(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match) map.set(path.basename(match[2].trim()), match[1].toLowerCase());
  }
  return map;
}

// GitHub publishes a "digest" (sha256) for every release asset; SHA256SUMS.txt is the fallback
async function resolveExpectedSha256(release, asset) {
  const fromDigest = normalizeSha256(asset?.digest);
  if (fromDigest) return fromDigest;

  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const sumsAsset = assets.find(a => a?.name === CHECKSUMS_ASSET_NAME);
  if (!sumsAsset || !isTrustedUpdateUrl(sumsAsset.browser_download_url)) return null;
  try {
    const response = await fetch(sumsAsset.browser_download_url, { headers: { 'User-Agent': 'DREADLAND-Launcher-Updater' } });
    if (!response.ok) return null;
    return parseChecksumsFile(await response.text()).get(asset.name) || null;
  } catch {
    return null;
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

export async function downloadFileToPath(url, outPath, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'DREADLAND-Launcher-Updater', Accept: 'application/octet-stream' },
  });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  const total = Number(response.headers.get('content-length')) || null;
  let loaded = 0;
  let lastProgressTime = 0;
  const readable = Readable.fromWeb(response.body);
  const writable = fs.createWriteStream(outPath);
  readable.on('data', (chunk) => {
    loaded += chunk.length;
    const now = Date.now();
    if (now - lastProgressTime > 100 || (total && loaded >= total)) {
      lastProgressTime = now;
      const percent = total ? Math.round((loaded / total) * 100) : null;
      onProgress?.({ loaded, total, percent });
    }
  });
  await new Promise((resolve, reject) => {
    readable.pipe(writable);
    writable.on('finish', resolve);
    writable.on('error', reject);
    readable.on('error', reject);
  });
  return outPath;
}

export async function launchDownloadedUpdate(filePath) {
  const resolvedPath = String(filePath || '').trim();
  if (!resolvedPath) throw new Error('Missing update file path.');
  const extension = path.extname(resolvedPath).toLowerCase();
  const basename = path.basename(resolvedPath).toLowerCase();

  if (process.platform === 'linux') {
    if (extension === '.appimage' || extension === '' || basename.endsWith('.tar.gz') || basename.endsWith('.tar.xz')) {
      await fs.promises.chmod(resolvedPath, 0o755).catch(() => { });
    }
    if (extension === '.appimage') {
      try {
        if (process.env.APPIMAGE) {
          try {
            await fs.promises.copyFile(resolvedPath, process.env.APPIMAGE);
            await fs.promises.chmod(process.env.APPIMAGE, 0o755);
            const child = spawn(process.env.APPIMAGE, [], { detached: true, stdio: 'ignore' });
            child.unref();
            return { ok: true, launched: true, path: process.env.APPIMAGE };
          } catch { }
        }
        const child = spawn(resolvedPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { ok: true, launched: true, path: resolvedPath };
      } catch (e) {
        try { await shell.openExternal(UPDATE_RELEASES_PAGE); } catch { }
        return { ok: false, launched: false, path: resolvedPath, error: e?.message || String(e) };
      }
    }
    if (extension === '.deb') {
      await shell.openPath(resolvedPath);
      return { ok: true, launched: true, path: resolvedPath };
    }
    if (basename.endsWith('.tar.gz') || basename.endsWith('.tar.xz')) {
      await shell.openPath(path.dirname(resolvedPath));
      return { ok: true, launched: true, path: resolvedPath };
    }
  }

  if (process.platform === 'darwin') {
    if (extension === '.dmg' || extension === '.zip') {
      await shell.openPath(resolvedPath);
      return { ok: true, launched: true, path: resolvedPath };
    }
  }

  if (process.platform === 'win32') {
    if (extension === '.zip') {
      await shell.openPath(resolvedPath);
      return { ok: true, launched: true, path: resolvedPath };
    }
    if (extension === '.exe') {
      try {
        const child = spawn(resolvedPath, ['/S'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        return { ok: true, launched: true, path: resolvedPath };
      } catch (e) {
        try { await shell.openExternal(UPDATE_RELEASES_PAGE); } catch { }
        return { ok: false, launched: false, path: resolvedPath, error: e?.message || String(e) };
      }
    }
  }

  if (isLaunchableUpdateAsset(resolvedPath)) {
    try {
      const child = spawn(resolvedPath, [], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
      child.unref();
      return { ok: true, launched: true, path: resolvedPath };
    } catch (e) {
      try { await shell.openExternal(UPDATE_RELEASES_PAGE); } catch { }
      return { ok: false, launched: false, path: resolvedPath, error: e?.message || String(e) };
    }
  }

  await shell.openExternal(UPDATE_RELEASES_PAGE);
  return { ok: true, launched: false, path: resolvedPath };
}

// Takes nothing from the renderer on purpose: we only apply the update that this
// process found itself, so a compromised UI cannot make us run another file.
export async function downloadAndApplyUpdate({ onEvent = null } = {}) {
  if (!pendingUpdate) await checkForLauncherUpdate({ onEvent });
  const currentVersion = String(app.getVersion() || '').trim();
  if (!pendingUpdate) return { ok: true, upToDate: true, currentVersion };

  const { release, asset, latestVersion } = pendingUpdate;
  const releaseUrl = UPDATE_RELEASES_PAGE;
  const updaterStrings = await getUpdaterStrings(await getPreferredLanguage());

  const openReleasePage = async () => {
    onEvent?.('minecraft:update-status', { phase: 'release-page', currentVersion, latestVersion, message: updaterStrings.openingReleasePage });
    await shell.openExternal(releaseUrl);
    return { ok: true, available: true, openedReleasePage: true, currentVersion, latestVersion };
  };

  if (!asset || !isTrustedUpdateUrl(asset.browser_download_url) || !isLaunchableUpdateAsset(asset.name)) {
    return openReleasePage();
  }

  // Without a known hash we cannot prove the file is intact, so let the user download it by hand
  const expectedSha256 = await resolveExpectedSha256(release, asset);
  if (!expectedSha256) return openReleasePage();

  onEvent?.('minecraft:update-status', {
    phase: 'downloading',
    currentVersion,
    latestVersion,
    assetName: asset.name,
    message: formatI18nMessage(updaterStrings.downloading, { assetName: asset.name }),
  });

  const updatesDir = path.join(app.getPath('userData'), 'updates');
  await fs.promises.mkdir(updatesDir, { recursive: true });
  const downloadPath = path.join(updatesDir, path.basename(String(asset.name || `DREADLAND-Launcher-${latestVersion}`)));
  try { await fs.promises.rm(downloadPath, { force: true }).catch(() => { }); } catch { }

  await downloadFileToPath(asset.browser_download_url, downloadPath, {
    onProgress: ({ loaded, total, percent }) => {
      onEvent?.('minecraft:update-progress', { phase: 'downloading', loaded, total, percent, currentVersion, latestVersion, assetName: asset.name });
    },
  });

  onEvent?.('minecraft:update-status', { phase: 'verifying', currentVersion, latestVersion, assetName: asset.name, message: updaterStrings.verifying });
  const actualSha256 = await sha256File(downloadPath);
  if (actualSha256 !== expectedSha256) {
    await fs.promises.rm(downloadPath, { force: true }).catch(() => { });
    const message = updaterStrings.verifyFailed || 'The downloaded update is corrupted or was tampered with. It was deleted and not installed.';
    onEvent?.('minecraft:update-status', { phase: 'error', currentVersion, latestVersion, assetName: asset.name, message });
    return { error: 'ChecksumMismatch', message, expected: expectedSha256, actual: actualSha256, currentVersion, latestVersion };
  }

  onEvent?.('minecraft:update-status', { phase: 'launching', currentVersion, latestVersion, assetName: asset.name, message: updaterStrings.launching });
  const launchResult = await launchDownloadedUpdate(downloadPath);
  onEvent?.('minecraft:update-complete', { phase: 'complete', currentVersion, latestVersion, assetName: asset.name, path: downloadPath });

  if (launchResult?.launched) {
    setTimeout(() => {
      app.quit();
    }, 400);
  }

  return { ok: true, available: true, downloaded: true, path: downloadPath, currentVersion, latestVersion };
}

export async function checkForLauncherUpdate({ onEvent = null } = {}) {
  const currentVersion = String(app.getVersion() || '').trim();
  const updaterStrings = await getUpdaterStrings(await getPreferredLanguage());
  onEvent?.('minecraft:update-status', { phase: 'checking', currentVersion, message: updaterStrings.checking });

  const response = await fetch(UPDATE_RELEASES_API, {
    headers: { 'User-Agent': 'DREADLAND-Launcher-Updater', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`Failed to check updates: ${response.status}`);
  const release = await response.json();
  const latestVersion = normalizeReleaseVersionTag(release);

  if (!latestVersion) return { error: 'InvalidRelease', message: 'Release metadata did not include a version tag.' };

  const currentTuple = versionToTuple(currentVersion);
  const latestTuple = versionToTuple(latestVersion);

  if (compareVersionTuples(latestTuple, currentTuple) <= 0) {
    pendingUpdate = null;
    onEvent?.('minecraft:update-status', { phase: 'up-to-date', currentVersion, latestVersion, message: updaterStrings.upToDate });
    return { ok: true, upToDate: true, currentVersion, latestVersion };
  }

  const asset = pickUpdateAsset(release);
  pendingUpdate = { release, asset, latestVersion };
  const updateInfo = {
    ok: true,
    available: true,
    currentVersion,
    latestVersion,
    releaseNotes: release.body || '',
    releaseUrl: release.html_url || UPDATE_RELEASES_PAGE,
    asset,
  };

  onEvent?.('minecraft:update-available', updateInfo);
  return updateInfo;
}
