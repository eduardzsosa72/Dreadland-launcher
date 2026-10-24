// Launcher API for the React UI, grouped by domain.
// Components import `api` from here; only ./bridge.js knows whether Electron is behind it.
import { call, callSync, subscribe, readProperty, isDesktop } from './bridge';

// Events pushed from the main process (electron/ipc/registerIpc.js)
export const EVENTS = {
  RUN_LOG: 'minecraft:run-log',
  RUN_EXIT: 'minecraft:run-exit',
  MOD_CONFLICT: 'minecraft:mod-conflict',
  ASSET_PROGRESS: 'minecraft:asset-progress',
  INSTALL_PROGRESS: 'minecraft:install-progress',
  INSTALL_FILE_PROGRESS: 'minecraft:install-file-progress',
  INSTALL_COMPLETE: 'minecraft:install-complete',
  INSTALL_CANCELLED: 'minecraft:install-cancelled',
  UPDATE_AVAILABLE: 'minecraft:update-available',
  UPDATE_STATUS: 'minecraft:update-status',
  UPDATE_PROGRESS: 'minecraft:update-progress',
  UPDATE_COMPLETE: 'minecraft:update-complete',
  SHOW_ABOUT: 'app:show-about',
};

export const api = {
  isDesktop,

  system: {
    platform: readProperty('platform', 'browser'),
    isMac: Boolean(readProperty('isMac', false)),
    getInfo: () => call('getSystemInfo'),
    getAppVersion: () => call('getAppVersion'),
    getLanguage: () => call('getAppLanguage'),
    setLanguage: (language) => call('setAppLanguage', language),
    openExternal: (url) => call('openExternal', url),
    // Path of a file dropped onto the window ('' when not available)
    getPathForFile: (file) => callSync('getPathForFile', '', file) || '',
    minimizeWindow: () => call('windowMinimize'),
    toggleMaximizeWindow: () => call('windowMaximize'),
    closeWindow: () => call('windowClose'),
  },

  state: {
    load: () => call('minecraftGetState'),
    save: (state) => call('minecraftSaveState', state),
    getSettings: () => call('minecraftGetSettings'),
  },

  minecraftFolder: {
    get: () => call('minecraftGetRoot'),
    open: () => call('minecraftOpenRootDirectory'),
    pick: () => call('minecraftPickRootDirectory'),
    reset: () => call('minecraftResetRootDirectory'),
  },

  instances: {
    list: () => call('getInstances'),
    create: (payload) => call('createInstance', payload),
    update: (id, updates) => call('updateInstance', id, updates),
    remove: (id) => call('deleteInstance', id),
    scanBaseFolder: () => call('scanBaseDirectory'),
    migrateBaseFolder: (payload) => call('migrateBaseToInstance', payload),
    pickImage: () => call('pickInstanceImage'),
  },

  content: {
    listMods: (instanceId) => call('minecraftGetInstalledMods', instanceId),
    listShaders: (instanceId) => call('minecraftGetInstalledShaders', instanceId),
    listResourcePacks: (instanceId) => call('minecraftGetInstalledResourcePacks', instanceId),
    listDatapacks: (instanceId) => call('minecraftGetInstalledDatapacks', instanceId),
    toggleMod: (modId, enable, instanceId) => call('minecraftToggleMod', modId, enable, instanceId),
    setAllModsEnabled: (enable, instanceId) => call('minecraftSetAllModsEnabled', enable, instanceId),
    deleteMod: (modId, instanceId) => call('minecraftDeleteMod', modId, instanceId),
    deleteShader: (fileName, instanceId) => call('minecraftDeleteShader', fileName, instanceId),
    deleteResourcePack: (fileName, instanceId) => call('minecraftDeleteResourcePack', fileName, instanceId),
    deleteDatapack: (fileName, instanceId) => call('minecraftDeleteDatapack', fileName, instanceId),
    openFolder: (folderType, instanceId) => call('minecraftOpenContentFolder', folderType, instanceId),
    installModFile: (sourcePath, instanceId) => call('minecraftInstallModFile', sourcePath, instanceId),
    importFile: (payload, instanceId) => call('minecraftImportContentFile', payload, instanceId),
    pickModFiles: () => call('minecraftPickModFiles'),
    pickFiles: (type) => call('minecraftPickContentFiles', type),
    checkModUpdates: (params) => call('minecraftCheckModUpdates', params),
  },

  modrinth: {
    search: (params) => call('minecraftModrinthSearch', params),
    getProject: (idOrSlug) => call('minecraftModrinthGetProject', idOrSlug),
    getVersions: (params) => call('minecraftModrinthGetVersions', params),
    install: (payload) => call('minecraftModrinthInstall', payload),
  },

  game: {
    getCatalog: (options) => call('minecraftGetCatalog', options),
    listInstalledVersions: () => call('minecraftGetInstalledVersions'),
    install: (opts) => call('minecraftInstall', opts),
    cancelInstall: (opts) => call('minecraftInstallCancel', opts),
    run: (opts) => call('minecraftRun', opts),
    stop: (opts) => call('minecraftStop', opts),
    syncServerPack: () => call('syncServerPack'),
  },

  auth: {
    getState: (profileKey, options) => call('minecraftGetAuthState', profileKey, options),
    login: (profileKey) => call('minecraftLogin', profileKey),
    logout: (profileKey) => call('minecraftLogout', profileKey),
  },

  updates: {
    check: () => call('minecraftCheckUpdate'),
    // Main installs the update it found itself; the UI only confirms
    apply: () => call('minecraftApplyUpdate'),
  },

  news: {
    list: (options) => call('minecraftGetNews', options),
    getArticle: (url) => call('minecraftGetArticle', url),
  },

  events: {
    on: (channel, listener) => subscribe(channel, listener),
  },
};

export default api;
