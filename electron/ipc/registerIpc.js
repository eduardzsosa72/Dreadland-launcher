import { app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getMinecraftRoot, getDefaultMinecraftRoot, isCustomMinecraftRoot, setCustomMinecraftRoot } from '../services/paths.js';
import { getMainWindow } from '../services/windowManager.js';
import { checkForLauncherUpdate, downloadAndApplyUpdate } from '../services/updater.js';
import {
  readInstalledMods,
  readInstalledShaders,
  readInstalledResourcePacks,
  readInstalledDatapacks,
  toggleMod,
  setAllModsEnabled,
  deleteMod,
  deleteShader,
  deleteResourcePack,
  deleteDatapack,
  openContentFolder,
  importModFile,
  importContentFile,
  pickContentFiles,
  installModrinthProject,
  checkInstalledModsUpdates,
} from '../services/contentManager.js';
import {
  readInstalledVersions,
  installMinecraft,
  cancelInstall,
  activeInstalls,
} from '../services/minecraftInstaller.js';
import {
  launchMinecraft,
  stopMinecraft,
  runningChildren,
} from '../services/minecraftRunner.js';
import { syncServerPack, readServerPackInstanceConfig } from '../services/serverPack.js';
import { loadLauncherCatalog } from '../../src/lib/minecraftLauncher.js';
import { loadMinecraftNews, loadMinecraftArticle } from '../../src/lib/minecraftNews.js';
import { loadLauncherState, saveLauncherState } from '../../src/lib/launcherState.js';
import {
  getMicrosoftAuthState,
  loginMicrosoftInteractive,
  logoutMicrosoft,
} from '../../src/lib/microsoftAuth.js';
import {
  searchModrinthProjects,
  getModrinthProject,
  getModrinthProjectVersions,
} from '../../src/lib/modrinth.js';
import {
  readAllInstances,
  createInstance,
  updateInstance,
  deleteInstance,
  scanBaseDirectory,
  migrateBaseToInstance,
} from '../services/instanceManager.js';
import {
  validated,
  asObject,
  asString,
  asFileName,
  asInstanceId,
  asHttpUrl,
  asAbsolutePath,
  asPositiveInt,
  isSafeSegment,
  ValidationError,
} from './validators.js';

// Files offered by Modrinth search are only ever downloaded from Modrinth's CDN
const MODRINTH_HOSTS = ['modrinth.com'];
const ARTICLE_HOSTS = ['minecraft.net'];
const CONTENT_TYPES = ['mod', 'mods', 'shader', 'shaders', 'shaderpacks', 'resourcepack', 'resourcepacks', 'texturepack', 'textures', 'datapack', 'datapacks'];
const FOLDER_TYPES = ['mods', 'instance', 'root', 'shaders', 'shaderpacks', 'texturepacks', 'resourcepacks', 'textures', 'datapacks', 'datapack', 'saves', 'worlds', 'config', 'logs', 'screenshots'];

// Version ids end up as folder names under versions/, so they must be a single segment
function asVersionId(value, label, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return value;
  const id = asString(String(value ?? ''), label, { max: 128 });
  if (!isSafeSegment(id)) throw new ValidationError(`${label} is not valid.`);
  return id;
}

export function registerAllIpc() {
  const sendToRenderer = (channel, payload) => {
    try {
      const win = getMainWindow();
      win?.webContents.send(channel, payload);
    } catch { }
  };

  const sendLog = (type, msg) => {
    sendToRenderer('minecraft:run-log', { type, msg });
  };

  // ── Window and Shell Controls ──
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.handle('window:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => getMainWindow()?.close());
  // Only web links: file:, smb: or custom protocol URLs could launch programs on the PC
  ipcMain.handle('shell:open-external', validated((_, url) => shell.openExternal(asHttpUrl(url))));

  // ── Directory and System Information ──
  ipcMain.handle('minecraft:open-root-directory', async () => {
    const minecraftRoot = getMinecraftRoot();
    try {
      await fs.promises.mkdir(minecraftRoot, { recursive: true });
      const result = await shell.openPath(minecraftRoot);
      if (result) {
        return { error: 'OpenPathFailed', message: result, path: minecraftRoot };
      }
      return { ok: true, path: minecraftRoot };
    } catch (error) {
      return { error: 'OpenPathFailed', message: error?.message || String(error), path: minecraftRoot };
    }
  });

  ipcMain.handle('minecraft:get-root', async () => ({
    root: getMinecraftRoot(),
    defaultRoot: getDefaultMinecraftRoot(),
    isCustom: isCustomMinecraftRoot(),
  }));

  const changeMinecraftRoot = async (dir) => {
    if (runningChildren.size > 0 || activeInstalls.size > 0) {
      return { error: 'Busy', message: 'Close the game and wait for installs to finish before changing the Minecraft directory.' };
    }
    try {
      const root = await setCustomMinecraftRoot(dir);
      return { ok: true, root, defaultRoot: getDefaultMinecraftRoot(), isCustom: isCustomMinecraftRoot() };
    } catch (error) {
      return { error: 'InvalidDirectory', message: error?.message || String(error) };
    }
  };

  ipcMain.handle('minecraft:pick-root-directory', async () => {
    const result = await dialog.showOpenDialog(getMainWindow() || undefined, {
      title: 'Select Minecraft directory',
      defaultPath: getMinecraftRoot(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return changeMinecraftRoot(result.filePaths[0]);
  });

  ipcMain.handle('minecraft:reset-root-directory', async () => changeMinecraftRoot(null));
  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('system:get-info', async () => {
    const totalBytes = os.totalmem();
    const totalRamGb = Math.max(2, Math.round(totalBytes / (1024 * 1024 * 1024)));
    return {
      totalRamGb,
      platform: process.platform,
      arch: process.arch,
    };
  });

  // ── State and Settings ──
  ipcMain.handle('minecraft:get-state', async () => {
    const state = await loadLauncherState(app.getPath('userData'));
    return { ...state, minecraftRoot: getMinecraftRoot() };
  });

  ipcMain.handle('minecraft:save-state', validated(async (_, rawState) => {
    const state = asObject(rawState, 'state');
    if (state.settings && typeof state.settings === 'object') {
      state.settings.javaPath = state.settings.javaPath || '';
    }
    return saveLauncherState(app.getPath('userData'), state);
  }));

  ipcMain.handle('minecraft:get-settings', async () => {
    const state = await loadLauncherState(app.getPath('userData'));
    return {
      keepOpen: state.settings?.keepOpen ?? false,
      showConsole: state.settings?.showConsole ?? true,
      autoUpdate: state.settings?.autoUpdate ?? true,
      showSnapshots: state.settings?.showSnapshots ?? false,
    };
  });

  ipcMain.handle('app:get-language', async () => {
    try {
      const state = await loadLauncherState(app.getPath('userData'));
      return state.settings?.language || 'en';
    } catch {
      return 'en';
    }
  });

  ipcMain.handle('app:set-language', async (_, language) => {
    try {
      const currentState = await loadLauncherState(app.getPath('userData'));
      await saveLauncherState(app.getPath('userData'), {
        ...currentState,
        settings: { ...currentState.settings, language: typeof language === 'string' && language.trim() ? language.trim() : 'en' },
      });
      return { ok: true };
    } catch (error) {
      return { error: 'SaveFailed', message: error?.message || String(error) };
    }
  });

  // ── Catalog and News ──
  ipcMain.handle('minecraft:get-catalog', async (_, options) => {
    const currentState = await loadLauncherState(app.getPath('userData'));
    const includeSnapshots = options?.includeSnapshots !== undefined
      ? Boolean(options.includeSnapshots)
      : (options?.showSnapshots !== undefined
        ? Boolean(options.showSnapshots)
        : currentState.settings?.showSnapshots === true);
    const catalog = await loadLauncherCatalog({ includeSnapshots });
    try {
      const nextSettings = { ...(currentState.settings || {}), showSnapshots: includeSnapshots };
      await saveLauncherState(app.getPath('userData'), {
        ...currentState,
        settings: nextSettings,
        versions: catalog.versions,
        installTargets: catalog.installTargets,
        latest: catalog.latest,
      });
    } catch { }
    return catalog;
  });

  ipcMain.handle('minecraft:get-news', async (_, options = {}) => {
    try {
      const limit = Number(options?.limit) > 0 ? Number(options.limit) : 60;
      return await loadMinecraftNews({ limit });
    } catch (error) {
      return { error: error?.message || 'Failed to load Minecraft news.', items: [], sourceUrl: 'https://www.minecraft.net/en-us/articles' };
    }
  });

  ipcMain.handle('minecraft:get-article', async (_, url) => {
    try {
      // Relative paths are resolved against minecraft.net by the loader; absolute URLs must point there
      const value = asString(url, 'url', { max: 4096 });
      return await loadMinecraftArticle(/^https?:/i.test(value) ? asHttpUrl(value, 'url', { hosts: ARTICLE_HOSTS }) : value);
    } catch (error) {
      return { error: error?.message || 'Failed to load article content.', url };
    }
  });

  // ── Authentication ──
  ipcMain.handle('minecraft:get-auth-state', validated(async (_, profileKey = 'default', options = {}) => {
    return getMicrosoftAuthState({
      profileKey: asString(profileKey, 'profileKey', { max: 128 }),
      storageDir: app.getPath('userData'),
      forceRefresh: Boolean(options?.forceRefresh),
    });
  }));

  ipcMain.handle('minecraft:login', validated(async (event, profileKey = 'default') => {
    const controller = new AbortController();
    const key = asString(profileKey, 'profileKey', { max: 128 });
    try {
      return await loginMicrosoftInteractive({
        profileKey: key,
        storageDir: app.getPath('userData'),
        openExternal: url => shell.openExternal(url),
        abortSignal: controller.signal,
      });
    } catch (error) {
      if (error?.message === 'Login cancelled by user') {
        return { error: error.message, cancelled: true };
      }
      return { error: error?.message || 'Microsoft login failed.' };
    }
  }));

  ipcMain.handle('minecraft:logout', validated(async (_, profileKey = 'default') => {
    return logoutMicrosoft({ profileKey: asString(profileKey, 'profileKey', { max: 128 }), storageDir: app.getPath('userData') });
  }));

  // ── Instances ──
  ipcMain.handle('instances:get-all', async () => readAllInstances());
  ipcMain.handle('instances:create', validated(async (_, payload) => createInstance(asObject(payload))));
  ipcMain.handle('instances:update', validated(async (_, payload) => {
    const { id, updates } = asObject(payload);
    return updateInstance(asInstanceId(id, { optional: false }), asObject(updates, 'updates'));
  }));
  ipcMain.handle('instances:delete', validated(async (_, id) => deleteInstance(asInstanceId(id, { optional: false }))));
  ipcMain.handle('instances:scan-base', async () => scanBaseDirectory());
  ipcMain.handle('instances:migrate-base', validated(async (_, payload) => migrateBaseToInstance(asObject(payload))));
  ipcMain.handle('instances:pick-image', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select instance icon image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    try {
      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const buf = await fs.promises.readFile(filePath);
      return { canceled: false, dataUri: `data:${mime};base64,${buf.toString('base64')}` };
    } catch (err) {
      return { canceled: true, error: err.message };
    }
  });

  // ── Content Management (Mods, Shaders, Resource Packs, Data Packs) ──
  ipcMain.handle('minecraft:get-installed-versions', async () => readInstalledVersions());
  ipcMain.handle('minecraft:get-installed-mods', validated(async (_, instanceId) => readInstalledMods(asInstanceId(instanceId))));
  ipcMain.handle('minecraft:get-installed-shaders', validated(async (_, instanceId) => readInstalledShaders(asInstanceId(instanceId))));
  ipcMain.handle('minecraft:get-installed-resourcepacks', validated(async (_, instanceId) => readInstalledResourcePacks(asInstanceId(instanceId))));
  ipcMain.handle('minecraft:get-installed-datapacks', validated(async (_, instanceId) => readInstalledDatapacks(asInstanceId(instanceId))));

  // modId / fileName become file names inside mods/, shaderpacks/... so they must not contain "../"
  ipcMain.handle('minecraft:toggle-mod', validated(async (_, payload) => {
    const { modId, enable, instanceId } = asObject(payload);
    return toggleMod(asFileName(modId, 'modId'), Boolean(enable), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:set-all-mods-enabled', validated(async (_, payload) => {
    const { enable, instanceId } = asObject(payload);
    return setAllModsEnabled(Boolean(enable), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:delete-mod', validated(async (_, payload) => {
    const { modId, instanceId } = asObject(payload);
    return deleteMod(asFileName(modId, 'modId'), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:delete-shader', validated(async (_, payload) => {
    const { fileName, instanceId } = asObject(payload);
    return deleteShader(asFileName(fileName), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:delete-resourcepack', validated(async (_, payload) => {
    const { fileName, instanceId } = asObject(payload);
    return deleteResourcePack(asFileName(fileName), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:delete-datapack', validated(async (_, payload) => {
    const { fileName, instanceId } = asObject(payload);
    return deleteDatapack(asFileName(fileName), asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:open-content-folder', validated(async (_, folderType = 'mods', instanceId) => {
    if (!FOLDER_TYPES.includes(folderType)) throw new ValidationError('Unknown folder type.');
    return openContentFolder(folderType, asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:install-mod-file', validated(async (_, payload) => {
    const { sourcePath, instanceId } = asObject(payload);
    return importModFile({ sourcePath: asAbsolutePath(sourcePath, 'sourcePath') }, asInstanceId(instanceId));
  }));
  ipcMain.handle('minecraft:import-content-file', validated(async (_, rawPayload, instanceId) => {
    const payload = asObject(rawPayload);
    const type = payload.type ?? 'mod';
    if (!CONTENT_TYPES.includes(type)) throw new ValidationError('Unknown content type.');
    return importContentFile({
      type,
      sourcePath: payload.sourcePath ? asAbsolutePath(payload.sourcePath, 'sourcePath') : undefined,
      fileName: payload.fileName ? asFileName(payload.fileName) : undefined,
      fileBytes: payload.fileBytes,
      instanceId: asInstanceId(payload.instanceId),
    }, asInstanceId(instanceId));
  }));

  ipcMain.handle('minecraft:pick-mod-files', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select mod files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft Mods', extensions: ['jar', 'olpkg'] }, { name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: result.filePaths || [] };
  });

  ipcMain.handle('minecraft:pick-content-files', validated(async (_, type = 'mod') => {
    if (!CONTENT_TYPES.includes(type)) throw new ValidationError('Unknown content type.');
    return pickContentFiles(type);
  }));

  // ── Modrinth Integration ──
  ipcMain.handle('minecraft:modrinth-search', async (_, params) => searchModrinthProjects(params));
  ipcMain.handle('minecraft:modrinth-get-project', async (_, idOrSlug) => getModrinthProject(idOrSlug));
  ipcMain.handle('minecraft:modrinth-get-versions', async (_, params) => getModrinthProjectVersions(params));
  ipcMain.handle('minecraft:modrinth-install', validated(async (_, rawPayload) => {
    const payload = asObject(rawPayload);
    return installModrinthProject({
      ...payload,
      fileUrl: payload.fileUrl ? asHttpUrl(payload.fileUrl, 'fileUrl', { hosts: MODRINTH_HOSTS }) : undefined,
      fileName: payload.fileName ? asFileName(payload.fileName) : undefined,
      instanceId: asInstanceId(payload.instanceId),
    }, { onLog: sendLog });
  }));
  ipcMain.handle('minecraft:check-mod-updates', validated(async (_, params) => {
    const payload = asObject(params);
    return checkInstalledModsUpdates({ ...payload, instanceId: asInstanceId(payload.instanceId) });
  }));

  // ── Updates ──
  ipcMain.handle('minecraft:check-update', async () => {
    return checkForLauncherUpdate({
      onEvent: sendToRenderer,
    });
  });

  // The renderer's payload is ignored: main only installs the update it found itself
  ipcMain.handle('minecraft:apply-update', async () => {
    return downloadAndApplyUpdate({ onEvent: sendToRenderer });
  });

  // ── Game Installation and Execution ──
  ipcMain.handle('minecraft:install', validated(async (_, rawOpts) => {
    const opts = asObject(rawOpts, 'opts');
    asVersionId(opts.version, 'version', { optional: true });
    asVersionId(opts.gameVersion, 'gameVersion', { optional: true });
    asVersionId(opts.loaderVersion, 'loaderVersion', { optional: true });
    return installMinecraft(opts, {
      onLog: sendLog,
      onProgress: (p) => {
        sendToRenderer('minecraft:install-file-progress', p);
        sendToRenderer('minecraft:install-progress', p);
      },
      onComplete: (c) => sendToRenderer('minecraft:install-complete', c),
    });
  }));

  ipcMain.handle('minecraft:install-cancel', validated(async (_, payload) => {
    const installId = asString(asObject(payload).installId, 'installId', { max: 128 });
    const result = cancelInstall(installId);
    if (result.ok) {
      sendToRenderer('minecraft:install-cancelled', { installId });
    }
    return result;
  }));

  const packSyncCallbacks = {
    onLog: sendLog,
    onProgress: (p) => sendToRenderer('minecraft:install-file-progress', p),
  };

  ipcMain.handle('serverPack:sync', async () => syncServerPack(packSyncCallbacks));

  ipcMain.handle('minecraft:run', validated(async (_, rawOpts) => {
    let opts = asObject(rawOpts, 'opts');
    opts = { ...opts, instanceId: asInstanceId(opts.instanceId) };
    if (await readServerPackInstanceConfig(opts.instanceId)) {
      // Sync right before playing so a pack pushed while the launcher was open is still applied
      const sync = await syncServerPack(packSyncCallbacks);
      if (!sync.ok && sync.error !== 'NoServerPack') {
        sendLog('warn', `Server pack sync failed: ${sync.message}. Launching with the files already installed.`);
      }
      if (sync.versionId) {
        const installed = await readInstalledVersions();
        opts = { ...opts, version: installed.find(v => v.id === sync.versionId) || sync.versionId };
      }
    }
    return launchMinecraft(opts, {
      onLog: sendLog,
      onAssetProgress: (p) => sendToRenderer('minecraft:asset-progress', p),
      onExit: (e) => sendToRenderer('minecraft:run-exit', e),
      onConflict: (c) => sendToRenderer('minecraft:mod-conflict', c),
    });
  }));

  ipcMain.handle('minecraft:stop', validated(async (_, payload) => stopMinecraft(asPositiveInt(asObject(payload).pid, 'pid'))));
}
