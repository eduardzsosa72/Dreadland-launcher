// Browser stand-in for electron/preload.cjs, used when the UI runs outside Electron
// (e.g. `npm run vite` in a normal browser). Same method names as the preload bridge.
// Where a public web API allows it (Modrinth, Minecraft news, version catalog) the mock
// fetches real data; everything that needs the file system returns an empty result.
import { loadLauncherCatalog } from '../lib/minecraftLauncher';
import { loadMinecraftNews, loadMinecraftArticle } from '../lib/minecraftNews';
import { searchModrinthProjects, getModrinthProject, getModrinthProjectVersions } from '../lib/modrinth';

const ok = (extra = {}) => Promise.resolve({ ok: true, ...extra });
const empty = () => Promise.resolve([]);
const skipped = () => Promise.resolve({ skipped: true });
const DESKTOP_ONLY = 'Esta acción requiere la aplicación de escritorio.';

export const mockLauncher = {
  platform: 'browser',
  isMac: typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform),
  getPathForFile: () => '',

  // System / window
  getSystemInfo: () => Promise.resolve({ totalRamGb: typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8, platform: 'browser' }),
  getAppVersion: () => Promise.resolve('dev'),
  getAppLanguage: () => Promise.resolve(null),
  setAppLanguage: () => ok(),
  openExternal: (url) => { window.open(url, '_blank', 'noopener,noreferrer'); return ok(); },
  windowMinimize: () => ok(),
  windowMaximize: () => ok(),
  windowClose: () => ok(),

  // State and settings
  minecraftGetState: () => Promise.resolve(null),
  minecraftSaveState: () => ok(),
  minecraftGetSettings: () => Promise.resolve({}),

  // Minecraft folder
  minecraftGetRoot: () => Promise.resolve({ root: '', defaultRoot: '', isCustom: false }),
  minecraftOpenRootDirectory: skipped,
  minecraftPickRootDirectory: () => Promise.resolve({ canceled: true }),
  minecraftResetRootDirectory: skipped,

  // Instances
  getInstances: empty,
  createInstance: (payload) => ok({ instance: payload }),
  updateInstance: (id, updates) => ok({ instance: { id, ...updates } }),
  deleteInstance: (id) => ok({ id }),
  scanBaseDirectory: () => Promise.resolve({ modsCount: 0, shaderpacksCount: 0, resourcepacksCount: 0, savesCount: 0, hasConfig: false, hasOptions: false }),
  migrateBaseToInstance: (payload) => ok({ instance: { id: 'migrated', ...payload } }),
  pickInstanceImage: () => Promise.resolve({ canceled: true }),

  // Installed content
  minecraftGetInstalledVersions: empty,
  minecraftGetInstalledMods: empty,
  minecraftGetInstalledShaders: empty,
  minecraftGetInstalledResourcePacks: empty,
  minecraftGetInstalledDatapacks: empty,
  minecraftToggleMod: () => ok(),
  minecraftSetAllModsEnabled: () => ok(),
  minecraftDeleteMod: () => ok(),
  minecraftDeleteShader: () => ok(),
  minecraftDeleteResourcePack: () => ok(),
  minecraftDeleteDatapack: () => ok(),
  minecraftOpenContentFolder: () => ok(),
  minecraftInstallModFile: () => ok(),
  minecraftImportContentFile: () => ok(),
  minecraftPickModFiles: () => Promise.resolve({ canceled: true, filePaths: [] }),
  minecraftPickContentFiles: () => Promise.resolve({ canceled: true, filePaths: [] }),
  minecraftCheckModUpdates: () => Promise.resolve({ updates: [] }),

  // Modrinth (public API, works from the browser)
  minecraftModrinthSearch: (params) => searchModrinthProjects(params),
  minecraftModrinthGetProject: (idOrSlug) => getModrinthProject(idOrSlug),
  minecraftModrinthGetVersions: (params) => getModrinthProjectVersions(params),
  minecraftModrinthInstall: () => Promise.resolve({ error: DESKTOP_ONLY }),

  // Game
  minecraftGetCatalog: (options) => loadLauncherCatalog(options),
  minecraftInstall: () => Promise.resolve({ installId: 'mock' }),
  minecraftInstallCancel: () => ok({ cancelled: true }),
  minecraftRun: () => Promise.resolve({ error: DESKTOP_ONLY }),
  minecraftStop: () => ok({ stopped: true }),
  syncServerPack: () => Promise.resolve({ ok: false, error: 'NoServerPack' }),

  // Account
  minecraftGetAuthState: () => Promise.resolve(null),
  minecraftLogin: () => Promise.resolve({ error: 'El inicio de sesión con Microsoft requiere la aplicación de escritorio.' }),
  minecraftLogout: () => Promise.resolve(null),

  // Launcher updates
  minecraftCheckUpdate: skipped,
  minecraftApplyUpdate: skipped,

  // News
  minecraftGetNews: (options) => loadMinecraftNews(options),
  minecraftGetArticle: (url) => loadMinecraftArticle(url),

  on: () => () => { },
};
