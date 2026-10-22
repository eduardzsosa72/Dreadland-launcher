import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getInstanceDir, getMinecraftRoot } from './paths.js';
import { createRequire } from 'module';
import { installMinecraft, saveResponseBodyToFile } from './minecraftInstaller.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

// Edit server-pack.json in the repo and push: every launcher picks it up on next start, no release needed
export const SERVER_PACK_URL = 'https://raw.githubusercontent.com/eduardzsosa72/Dreadland-launcher/main/server-pack.json';

const CACHE_FILE_NAME = 'server-pack.cache.json';
const MANAGED_FILES_MANIFEST = '.server-pack-files.json';
const DOWNLOAD_CONCURRENCY = 6;

let activeSync = null;

function sanitizeId(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileNameFromUrl(url) {
  try {
    return path.basename(decodeURIComponent(new URL(url).pathname));
  } catch {
    return '';
  }
}

// Rejects absolute paths and "..": pack entries must stay inside the instance folder
function isSafeRelativePath(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.normalize(relativePath);
  return !normalized.startsWith('..') && !normalized.split(path.sep).includes('..');
}

export function normalizeServerPack(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Server pack is not a JSON object.');
  const id = sanitizeId(raw.id);
  const minecraftVersion = String(raw.minecraftVersion || '').trim();
  if (!id) throw new Error('Server pack is missing "id".');
  if (!minecraftVersion) throw new Error('Server pack is missing "minecraftVersion".');

  const loaderType = String(raw.loader?.type || 'vanilla').toLowerCase().trim();
  const loaderVersion = String(raw.loader?.version || '').trim();
  if (!['vanilla', 'fabric'].includes(loaderType)) throw new Error(`Unsupported loader "${loaderType}" (use "vanilla" or "fabric").`);
  if (loaderType === 'fabric' && !loaderVersion) throw new Error('Fabric server packs need "loader.version".');

  const mods = (Array.isArray(raw.mods) ? raw.mods : []).map((mod) => {
    const url = String(mod?.url || '').trim();
    const fileName = path.basename(String(mod?.fileName || fileNameFromUrl(url)).trim());
    if (!url || !fileName.toLowerCase().endsWith('.jar')) throw new Error(`Invalid mod entry: ${JSON.stringify(mod)}`);
    return {
      name: String(mod?.name || fileName),
      fileName,
      url,
      sha1: mod?.sha1 ? String(mod.sha1).toLowerCase() : null,
      md5: mod?.md5 ? String(mod.md5).toLowerCase() : null,
      size: Number(mod?.size) || null,
    };
  });

  const files = (Array.isArray(raw.files) ? raw.files : []).map((file) => {
    const url = String(file?.url || '').trim();
    const relativePath = String(file?.path || '').trim();
    if (!url || !isSafeRelativePath(relativePath)) throw new Error(`Invalid file entry: ${JSON.stringify(file)}`);
    return {
      path: relativePath,
      url,
      sha1: file?.sha1 ? String(file.sha1).toLowerCase() : null,
      md5: file?.md5 ? String(file.md5).toLowerCase() : null,
      size: Number(file?.size) || null,
      overwrite: Boolean(file?.overwrite),
    };
  });

  // Zips extracted into the instance folder, e.g. a mod config bundle or a custom main menu
  const archives = (Array.isArray(raw.archives) ? raw.archives : []).map((archive) => {
    const url = String(archive?.url || '').trim();
    const fileName = path.basename(String(archive?.fileName || fileNameFromUrl(url)).trim());
    if (!url || !fileName.toLowerCase().endsWith('.zip')) throw new Error(`Invalid archive entry: ${JSON.stringify(archive)}`);
    return {
      name: String(archive?.name || fileName),
      fileName,
      url,
      sha1: archive?.sha1 ? String(archive.sha1).toLowerCase() : null,
      md5: archive?.md5 ? String(archive.md5).toLowerCase() : null,
      size: Number(archive?.size) || null,
      overwrite: Boolean(archive?.overwrite),
    };
  });

  const address = String(raw.server?.address || '').trim();
  return {
    id,
    name: String(raw.name || id).trim(),
    packVersion: String(raw.packVersion || '0').trim(),
    minecraftVersion,
    loader: { type: loaderType, version: loaderVersion },
    versionId: loaderType === 'fabric' ? `fabric-loader-${loaderVersion}-${minecraftVersion}` : minecraftVersion,
    ram: Number(raw.ram) || 4,
    server: address ? { address, autoConnect: raw.server?.autoConnect !== false } : null,
    mods,
    files,
    archives,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function fetchRemotePack() {
  // Cache-busting query avoids GitHub raw's CDN serving a stale copy right after a push
  const res = await fetch(`${SERVER_PACK_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Remote first, then the last good copy, then the one bundled in the build, so the pack still works offline
export async function loadServerPack({ onLog = null } = {}) {
  const cachePath = path.join(app.getPath('userData'), CACHE_FILE_NAME);
  try {
    const pack = normalizeServerPack(await fetchRemotePack());
    await fs.promises.writeFile(cachePath, JSON.stringify(pack, null, 2), 'utf8').catch(() => { });
    return { pack, source: 'remote' };
  } catch (error) {
    onLog?.('warn', `Could not fetch server pack (${error?.message || error}), using local copy.`);
  }
  for (const [candidate, source] of [[cachePath, 'cache'], [path.join(app.getAppPath(), 'server-pack.json'), 'bundled']]) {
    try {
      return { pack: normalizeServerPack(await readJson(candidate)), source };
    } catch { }
  }
  return { pack: null, source: null };
}

async function hashFile(filePath, algorithm) {
  const hash = crypto.createHash(algorithm);
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex');
}

async function downloadVerified(entry, outPath) {
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${entry.url}`);
  await saveResponseBodyToFile(res, outPath);
  const size = fs.statSync(outPath).size;
  const badSize = entry.size && size !== entry.size;
  const badHash = (entry.sha1 && (await hashFile(outPath, 'sha1')) !== entry.sha1)
    || (entry.md5 && (await hashFile(outPath, 'md5')) !== entry.md5);
  if (badSize || badHash) {
    await fs.promises.unlink(outPath).catch(() => { });
    throw new Error(`Checksum mismatch for ${path.basename(outPath)}`);
  }
}

function checksumOf(entry) {
  return entry.sha1 || entry.md5 || null;
}

async function runPool(items, worker) {
  let index = 0;
  const errors = [];
  const next = async () => {
    while (index < items.length) {
      const item = items[index++];
      try { await worker(item); } catch (error) { errors.push(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, items.length) }, next));
  return errors;
}

function isVersionInstalled(versionId) {
  const versionDir = path.join(getMinecraftRoot(), 'versions', versionId);
  return fs.existsSync(path.join(versionDir, `${versionId}.json`)) || fs.existsSync(path.join(versionDir, 'version.json'));
}

async function ensurePackVersion(pack, { onLog, onProgress }) {
  if (isVersionInstalled(pack.versionId)) return;
  onLog?.('info', `Installing ${pack.versionId} for ${pack.name}...`);
  const result = pack.loader.type === 'fabric'
    ? await installMinecraft({ type: 'fabric', gameVersion: pack.minecraftVersion, loaderVersion: pack.loader.version }, { onLog, onProgress })
    : await installMinecraft({ type: 'minecraft', version: pack.minecraftVersion }, { onLog, onProgress });
  if (result?.error) throw new Error(result.message || result.error);
}

async function ensurePackInstance(pack) {
  const instanceDir = getInstanceDir(pack.id);
  const configPath = path.join(instanceDir, 'instance.json');
  let existing = null;
  try { existing = await readJson(configPath); } catch { }

  for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'saves']) {
    await fs.promises.mkdir(path.join(instanceDir, sub), { recursive: true });
  }

  // Version, loader and server come from the pack; RAM, Java and icon stay whatever the player picked
  const config = {
    icon: 'grass_block',
    ram: pack.ram,
    jvmArguments: '',
    javaPath: '',
    created: Date.now(),
    lastPlayed: null,
    ...(existing || {}),
    id: pack.id,
    name: pack.name,
    version: pack.versionId,
    loader: pack.loader.type,
    serverPack: { packVersion: pack.packVersion, server: pack.server },
  };
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  return { instanceDir, created: !existing };
}

async function syncPackFiles(pack, instanceDir, { onLog }) {
  const manifestPath = path.join(instanceDir, MANAGED_FILES_MANIFEST);
  let manifest = { mods: {}, files: {}, archives: {} };
  try { manifest = { mods: {}, files: {}, archives: {}, ...(await readJson(manifestPath)) }; } catch { }

  const modsDir = path.join(instanceDir, 'mods');
  const wantedMods = new Map(pack.mods.map(mod => [mod.fileName, mod]));

  // Only remove mods the pack installed earlier; anything the player added by hand is left alone
  for (const fileName of Object.keys(manifest.mods)) {
    if (wantedMods.has(fileName)) continue;
    const baseName = fileName.replace(/\.jar$/i, '');
    for (const candidate of [fileName, `${baseName}.olpkg`]) {
      await fs.promises.unlink(path.join(modsDir, candidate)).catch(() => { });
    }
    onLog?.('info', `Removed mod no longer in the pack: ${fileName}`);
  }

  const pendingMods = pack.mods.filter((mod) => {
    const target = path.join(modsDir, mod.fileName);
    const disabled = path.join(modsDir, `${mod.fileName.replace(/\.jar$/i, '')}.olpkg`);
    const previous = manifest.mods[mod.fileName];
    const sameEntry = previous && previous.url === mod.url && previous.checksum === checksumOf(mod);
    // A mod the player disabled counts as present, so syncing does not re-enable it
    if (sameEntry && fs.existsSync(disabled)) return false;
    if (!sameEntry || !fs.existsSync(target)) return true;
    return Boolean(mod.size) && fs.statSync(target).size !== mod.size;
  });

  const pendingFiles = pack.files.filter((file) => {
    const target = path.join(instanceDir, file.path);
    if (!fs.existsSync(target)) return true;
    if (!file.overwrite) return false;
    const previous = manifest.files[file.path];
    return !previous || previous.url !== file.url || previous.checksum !== checksumOf(file);
  });

  const total = pendingMods.length + pendingFiles.length;
  if (total > 0) onLog?.('info', `Downloading ${total} server pack file(s)...`);

  const nextManifest = { mods: {}, files: { ...manifest.files }, archives: { ...manifest.archives } };
  for (const mod of pack.mods) {
    if (!pendingMods.includes(mod) && manifest.mods[mod.fileName]) nextManifest.mods[mod.fileName] = manifest.mods[mod.fileName];
  }

  let done = 0;
  const errors = await runPool([...pendingMods.map(m => ({ kind: 'mod', entry: m })), ...pendingFiles.map(f => ({ kind: 'file', entry: f }))], async ({ kind, entry }) => {
    const target = kind === 'mod' ? path.join(modsDir, entry.fileName) : path.join(instanceDir, entry.path);
    try {
      await downloadVerified(entry, target);
      const record = { url: entry.url, checksum: checksumOf(entry) };
      if (kind === 'mod') nextManifest.mods[entry.fileName] = record;
      else nextManifest.files[entry.path] = record;
    } catch (error) {
      onLog?.('error', `Failed to download ${kind === 'mod' ? entry.name : entry.path}: ${error?.message || error}`);
      throw error;
    } finally {
      done += 1;
      if (total > 4 && done % Math.ceil(total / 4) === 0) onLog?.('info', `Server pack: ${done}/${total}`);
    }
  });

  let archiveFailures = 0;
  for (const archive of pack.archives) {
    const previous = manifest.archives[archive.fileName];
    if (previous && previous.url === archive.url && previous.checksum === checksumOf(archive)) continue;
    try {
      await extractPackArchive(archive, instanceDir, { onLog });
      nextManifest.archives[archive.fileName] = { url: archive.url, checksum: checksumOf(archive) };
    } catch (error) {
      archiveFailures += 1;
      onLog?.('error', `Failed to apply ${archive.name}: ${error?.message || error}`);
    }
  }

  await fs.promises.writeFile(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');
  return { downloaded: total - errors.length, failed: errors.length + archiveFailures };
}

async function extractPackArchive(archive, instanceDir, { onLog }) {
  onLog?.('info', `Downloading ${archive.name}...`);
  const tempPath = path.join(instanceDir, `.${archive.fileName}.download`);
  try {
    await downloadVerified(archive, tempPath);
    let written = 0;
    for (const entry of new AdmZip(tempPath).getEntries()) {
      if (entry.isDirectory || !isSafeRelativePath(entry.entryName)) continue;
      const target = path.join(instanceDir, entry.entryName);
      // Without overwrite, files the player already has (and may have tweaked) are kept
      if (!archive.overwrite && fs.existsSync(target)) continue;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, entry.getData());
      written += 1;
    }
    onLog?.('info', `${archive.name}: ${written} file(s) updated.`);
  } finally {
    await fs.promises.unlink(tempPath).catch(() => { });
  }
}

async function runSync({ onLog = null, onProgress = null } = {}) {
  const { pack, source } = await loadServerPack({ onLog });
  if (!pack) return { ok: false, error: 'NoServerPack', message: 'No server pack available (offline and no cached copy).' };

  await ensurePackVersion(pack, { onLog, onProgress });
  const { instanceDir, created } = await ensurePackInstance(pack);
  const { downloaded, failed } = await syncPackFiles(pack, instanceDir, { onLog });
  if (failed > 0) {
    return { ok: false, error: 'DownloadFailed', message: `${failed} server pack file(s) failed to download.`, instanceId: pack.id, versionId: pack.versionId };
  }
  if (downloaded > 0 || created) onLog?.('success', `${pack.name} pack ${pack.packVersion} is ready.`);
  return { ok: true, source, created, instanceId: pack.id, versionId: pack.versionId, packVersion: pack.packVersion, name: pack.name };
}

// Startup and the Play button can both trigger a sync; share one run instead of downloading twice
export function syncServerPack(callbacks = {}) {
  if (!activeSync) {
    activeSync = runSync(callbacks)
      .catch(error => ({ ok: false, error: 'SyncFailed', message: error?.message || String(error) }))
      .finally(() => { activeSync = null; });
  }
  return activeSync;
}

export async function readServerPackInstanceConfig(instanceId) {
  if (!instanceId) return null;
  try {
    const config = await readJson(path.join(getInstanceDir(instanceId), 'instance.json'));
    return config?.serverPack ? config : null;
  } catch {
    return null;
  }
}
