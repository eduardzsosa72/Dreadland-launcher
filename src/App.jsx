import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { INSTALL_TARGETS, getVersionById, resolveMinecraftVersion } from './lib/minecraftLauncher';
import { useI18n } from './context/I18nContext';
import { api, EVENTS } from './api';
import { Toast } from './components/common/CommonComponents';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { ActionBar, UpdateBanner } from './components/layout/ActionBar';
import { PlayDeck } from './components/layout/PlayDeck';
import { ModConflictModal } from './components/modals/ModConflictModal';
import { ProjectDetailView } from './components/views/ProjectDetailView';
import { ArticleDetailView } from './components/views/ArticleDetailView';
import { NewsTab } from './components/views/tabs/NewsTab';
import { ExploreTab } from './components/views/tabs/ExploreTab';
import { ModsTab } from './components/views/tabs/ModsTab';
import { ShadersTab } from './components/views/tabs/ShadersTab';
import { ResourcePacksTab } from './components/views/tabs/ResourcePacksTab';
import { DatapacksTab } from './components/views/tabs/DatapacksTab';
import { ConsoleTab } from './components/views/tabs/ConsoleTab';
import { InstancesTab } from './components/views/tabs/InstancesTab';
import {
  ProfileModal,
  InstallModal,
  SettingsModal,
  AboutModal,
  LoginLoadingModal,
  UpdateModal,
} from './components/modals/LauncherModals';
import { InstanceModal } from './components/modals/InstanceModal';
import { AccountModal } from './components/modals/AccountModal';
import { MigrateInstanceModal } from './components/modals/MigrateInstanceModal';
import { ConfirmModal } from './components/modals/ConfirmModal';
import { useToasts } from './hooks/useToasts';
import { useLauncherLogs } from './hooks/useLauncherLogs';
import { useNews } from './hooks/useNews';
import { useLauncherUpdate } from './hooks/useLauncherUpdate';
import { useInstalledContent } from './hooks/useInstalledContent';
import { useModrinthExplore } from './hooks/useModrinthExplore';
import { useModUpdates } from './hooks/useModUpdates';
import { useAccount } from './hooks/useAccount';
import { createOfflineSession } from './utils/formatters';
import { isProjectInstalled, localItemToProject } from './utils/content';

const APP_SOURCE_URL = 'https://github.com/eduardzsosa72/Dreadland-launcher';
const APP_RELEASES_URL = 'https://github.com/eduardzsosa72/Dreadland-launcher/releases/latest';
const ACTIVE_INSTANCE_STORAGE_KEY = 'openlauncher_active_instance';
const DEFAULT_PROFILE = { id: 'default', name: 'Default', localName: 'Player', version: null, ram: 4, jvmArguments: '', javaPath: '' };

function detectLoader(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('fabric')) return 'fabric';
  if (text.includes('neoforge')) return 'neoforge';
  if (text.includes('forge')) return 'forge';
  if (text.includes('quilt')) return 'quilt';
  return '';
}

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const { logs, setLogs, addLog, logFilter, setLogFilter, autoScroll, setAutoScroll } = useLauncherLogs();
  const { toasts, pushToast, dismissToast } = useToasts();

  // ── Profiles and saved state ──
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [stateHydrated, setStateHydrated] = useState(false);
  const [settings, setSettings] = useState({
    keepOpen: false, launchBehavior: 'hide', showConsole: true, autoUpdate: true, showSnapshots: false, javaPath: '', minecraftRoot: '', language,
  });

  // ── Navigation ──
  const [activeTab, setActiveTab] = useState('news');
  const [exploreType, setExploreType] = useState('mods'); // 'mods' | 'shaders' | 'resourcepacks' | 'datapacks'
  const [modSearch, setModSearch] = useState('');
  const [shaderSearch, setShaderSearch] = useState('');
  const [resourcePackSearch, setResourcePackSearch] = useState('');
  const [datapackSearch, setDatapackSearch] = useState('');
  const [selectedModDetail, setSelectedModDetail] = useState(null); // null | { project, initialTab }

  // ── Versions and instances ──
  const [versionCatalog, setVersionCatalog] = useState([]);
  const [installedVersions, setInstalledVersions] = useState([]);
  const [installTargets, setInstallTargets] = useState(INSTALL_TARGETS);
  const [instances, setInstances] = useState([]);
  const [activeInstanceId, setActiveInstanceId] = useState(null);

  // ── Game session ──
  const [gameState, setGameState] = useState('idle'); // idle | loading | running
  const [progress, setProgress] = useState(0);
  const [runPid, setRunPid] = useState(null);
  const [installId, setInstallId] = useState(null);

  // ── Dialogs ──
  const [modal, setModal] = useState(null); // null | 'install' | 'settings' | 'about'
  const [profileEditor, setProfileEditor] = useState(null); // null | { mode: 'new' | 'edit', profileId }
  const [instanceEditor, setInstanceEditor] = useState(null); // null | { mode: 'create' | 'edit', instance }
  const [migrateModalOpen, setMigrateModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [showBetaInfo, setShowBetaInfo] = useState(false);

  // ── System ──
  const [appVersion, setAppVersion] = useState('');
  const [systemTotalRam, setSystemTotalRam] = useState(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const consoleRef = useRef(null);
  const betaInfoRef = useRef(null);

  // ── Persistence ──
  // stateRef always holds the latest persisted values so async callbacks never save stale data
  const stateRef = useRef({ profiles, activeProfileId, activeInstanceId, logs, settings, versionCatalog, installTargets });
  const hydratedRef = useRef(false);
  const saveStateTimerRef = useRef(null);
  useEffect(() => {
    stateRef.current = { profiles, activeProfileId, activeInstanceId, logs, settings, versionCatalog, installTargets };
  }, [profiles, activeProfileId, activeInstanceId, logs, settings, versionCatalog, installTargets]);

  const persistState = useCallback((updates = {}) => {
    const next = { ...stateRef.current };
    for (const key of ['profiles', 'activeProfileId', 'activeInstanceId', 'logs', 'settings', 'installTargets']) {
      if (updates[key] !== undefined) next[key] = updates[key];
    }
    if (updates.versions !== undefined) next.versionCatalog = updates.versions;
    stateRef.current = next;
    // Saving before the stored state was read would overwrite the saved profiles with defaults
    if (!hydratedRef.current) return;
    if (updates.activeInstanceId !== undefined) {
      try {
        if (updates.activeInstanceId) localStorage.setItem(ACTIVE_INSTANCE_STORAGE_KEY, updates.activeInstanceId);
        else localStorage.removeItem(ACTIVE_INSTANCE_STORAGE_KEY);
      } catch { /* storage unavailable */ }
    }
    // Coalesce bursts of updates into one write. Installed content is never saved: it is
    // always re-read from disk (with mod icons it made launcher-state.json ~6 MB).
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
    saveStateTimerRef.current = setTimeout(() => {
      saveStateTimerRef.current = null;
      const s = stateRef.current;
      api.state.save({
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        activeInstanceId: s.activeInstanceId,
        logs: s.logs,
        versions: s.versionCatalog,
        installTargets: s.installTargets,
        settings: s.settings,
      });
    }, 250);
  }, []);

  const updateProfile = useCallback((profileId, patch) => {
    setProfiles(prev => {
      const next = prev.map(p => (p.id === profileId ? { ...p, ...patch } : p));
      persistState({ profiles: next, activeProfileId: profileId });
      return next;
    });
  }, [persistState]);

  const selectInstance = useCallback((id) => {
    setActiveInstanceId(id);
    persistState({ activeInstanceId: id });
  }, [persistState]);

  // Clears the console for a new task and (optionally) shows it
  const startConsoleTask = useCallback(({ switchTab = true } = {}) => {
    setLogs([]);
    persistState({ logs: [] });
    if (switchTab) setActiveTab('console');
  }, [setLogs, persistState]);

  // ── Derived values ──
  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || null;
  const activeProfileVersion = activeProfile?.version
    ? installedVersions.find(v => v.id === activeProfile.version) || getVersionById(activeProfile.version, versionCatalog)
    : null;
  const activeVersion = activeProfileVersion || installedVersions[0] || versionCatalog[0] || null;
  const selectedInstalledVersionId = activeProfile?.version || (installedVersions[0] ? installedVersions[0].id : '');
  const activeInstance = instances.find(i => i.id === activeInstanceId) || null;
  const profileLoaderType = String(activeProfileVersion?.type || activeVersion?.type || activeProfile?.version || '');
  const currentLoader = String(activeInstance?.loader || '').toLowerCase() || detectLoader(profileLoaderType);
  const currentMcVer = resolveMinecraftVersion(
    activeInstance?.version || activeProfileVersion?.inheritsFrom || activeProfileVersion?.mcVer || activeVersion?.inheritsFrom || activeVersion?.mcVer || activeProfile?.version || activeVersion?.id || ''
  );

  // ── Feature hooks ──
  const news = useNews({ t });
  const launcherUpdate = useLauncherUpdate({ t, addLog, pushToast });
  const content = useInstalledContent({ activeInstanceId, activeTab, exploreType, enabled: stateHydrated, t, pushToast, addLog });
  const { mods, shaders, resourcePacks, datapacks } = content;
  const explore = useModrinthExplore({
    exploreType, activeTab, isOnline, activeInstanceId, currentLoader, currentMcVer,
    refreshAfterInstall: content.refreshAfterInstall, startConsoleTask, addLog, pushToast, t,
  });
  const modUpdates = useModUpdates({
    isOnline, activeTab, activeInstanceId,
    loader: explore.effectiveLoader || currentLoader || 'fabric',
    gameVersion: explore.effectiveMcVer || currentMcVer || '',
    baseLoader: currentLoader || 'fabric',
    baseGameVersion: currentMcVer || '',
    mods, setMods: content.setMods, loadMods: content.loadMods, startConsoleTask, pushToast, t,
  });
  const auth = useAccount({ activeProfile, isOnline, updateProfile, t, addLog, pushToast });
  const { account } = auth;
  const { checkSilently: checkUpdatesSilently } = launcherUpdate;

  const isModInstalled = useCallback(
    (project) => isProjectInstalled(project, { mods, shaders, resourcePacks, datapacks }, exploreType),
    [mods, shaders, resourcePacks, datapacks, exploreType],
  );

  // ── Effects ──
  useEffect(() => {
    if (!showBetaInfo) return undefined;
    const handleClickOutside = (e) => {
      if (betaInfoRef.current && !betaInfoRef.current.contains(e.target)) setShowBetaInfo(false);
    };
    const handleKeyDown = (e) => { if (e.key === 'Escape') setShowBetaInfo(false); };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showBetaInfo]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      pushToast({ tone: 'warning', title: t('offline.badge'), message: t('offline.noConnectionToast') });
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [t, pushToast]);

  useEffect(() => {
    if (autoScroll && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs, autoScroll]);

  // Install / game process events from the main process
  useEffect(() => {
    const offs = [
      api.events.on(EVENTS.SHOW_ABOUT, () => setModal('about')),
      api.events.on(EVENTS.INSTALL_PROGRESS, (p) => {
        if (typeof p?.percent === 'number' && Number.isFinite(p.percent)) setProgress(p.percent);
        if (p?.message) addLog('info', p.message);
        if (p?.installId) setInstallId(p.installId);
      }),
      api.events.on(EVENTS.INSTALL_FILE_PROGRESS, (f) => {
        if (typeof f?.percent === 'number' && Number.isFinite(f.percent)) setProgress(f.percent);
      }),
      api.events.on(EVENTS.INSTALL_COMPLETE, (r) => {
        addLog('success', `Installation completed: ${r?.version || r?.label || 'version'}`);
        setProgress(100);
        setInstallId(null);
        api.game.listInstalledVersions().then((versions) => {
          if (!Array.isArray(versions)) return;
          setInstalledVersions(versions);
          // First installed version becomes the active profile's version if it had none
          const { profiles: currentProfiles, activeProfileId: curActiveId } = stateRef.current;
          const curActiveProfile = currentProfiles.find(p => p.id === curActiveId);
          if (versions.length > 0 && !curActiveProfile?.version) {
            const nextProfiles = currentProfiles.map(p => (p.id === curActiveId ? { ...p, version: versions[0].id } : p));
            setProfiles(nextProfiles);
            persistState({ profiles: nextProfiles });
          }
        });
      }),
      api.events.on(EVENTS.INSTALL_CANCELLED, (e) => {
        addLog('info', `Installation cancelled: ${e?.message || 'user cancelled'}`);
        setInstallId(null);
      }),
      api.events.on(EVENTS.RUN_LOG, (l) => {
        const type = l?.type === 'stderr' || l?.type === 'error' ? 'error' : l?.type === 'warn' ? 'warn' : 'info';
        addLog(type, l?.msg || '');
      }),
      api.events.on(EVENTS.ASSET_PROGRESS, (a) => {
        if (typeof a?.percent === 'number' && Number.isFinite(a.percent)) setProgress(a.percent);
      }),
      api.events.on(EVENTS.RUN_EXIT, (s) => {
        addLog('info', `Game process exited with code ${s?.code}`);
        setGameState('idle');
        setRunPid(null);
      }),
    ];
    return () => offs.forEach(off => off());
  }, [addLog, persistState]);

  // Startup: read saved state, instances, versions and catalog. Runs ONCE: it used to re-run on
  // every language change (re-syncing the server pack, refetching the catalog, re-checking updates).
  const initialLanguageRef = useRef(language);
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return; // StrictMode mounts effects twice in development
    initStartedRef.current = true;

    const initializeLauncher = async () => {
      try {
        const state = await api.state.load();
        const savedProfiles = Array.isArray(state?.profiles) && state.profiles.length > 0 ? state.profiles : null;
        const hydratedProfiles = savedProfiles || [DEFAULT_PROFILE];
        const hydratedActiveId = savedProfiles && savedProfiles.some(p => p.id === state.activeProfileId)
          ? state.activeProfileId
          : hydratedProfiles[0].id;
        setProfiles(hydratedProfiles);
        setActiveProfileId(hydratedActiveId);

        const hydratedSettings = state?.settings
          ? { ...stateRef.current.settings, ...state.settings, language: state.settings.language || initialLanguageRef.current }
          : stateRef.current.settings;
        if (state?.settings) setSettings(prev => ({ ...prev, ...hydratedSettings }));
        if (Array.isArray(state?.logs)) setLogs(state.logs);

        // Saved profiles and settings are in memory now, so later saves cannot overwrite them with defaults
        stateRef.current = { ...stateRef.current, profiles: hydratedProfiles, activeProfileId: hydratedActiveId, settings: hydratedSettings };
        hydratedRef.current = true;

        const rootRes = await api.minecraftFolder.get();
        if (rootRes?.root) {
          setSettings(prev => ({ ...prev, minecraftRoot: rootRes.root, minecraftRootIsCustom: Boolean(rootRes.isCustom) }));
        }

        const [instVers, loadedInstances] = await Promise.all([
          api.game.listInstalledVersions().catch(() => []),
          api.instances.list().catch(() => []),
        ]);
        if (Array.isArray(instVers)) setInstalledVersions(instVers);

        const storedInstanceId = state?.activeInstanceId || (() => {
          try { return localStorage.getItem(ACTIVE_INSTANCE_STORAGE_KEY); } catch { return null; }
        })();
        let resolvedActiveInstanceId = null;
        if (Array.isArray(loadedInstances)) {
          setInstances(loadedInstances);
          // Deleted externally or invalid id -> global .minecraft
          resolvedActiveInstanceId = loadedInstances.some(inst => inst.id === storedInstanceId) ? storedInstanceId : null;
          setActiveInstanceId(resolvedActiveInstanceId);
        }
        persistState({ activeInstanceId: resolvedActiveInstanceId });

        const snapshot = await api.game.getCatalog({ includeSnapshots: state?.settings?.showSnapshots === true }).catch(() => null);
        if (snapshot?.versions?.length > 0) setVersionCatalog(snapshot.versions);
        if (snapshot?.installTargets) setInstallTargets(snapshot.installTargets);

        // Background sync of the server's pinned version and mods; its instance becomes the default selection
        api.game.syncServerPack()
          .then(async (res) => {
            if (!res?.instanceId) {
              if (res?.error && res.error !== 'NoServerPack') addLog('warn', `Server pack: ${res.message || res.error}`);
              return;
            }
            const [freshInstances, freshVersions] = await Promise.all([
              api.instances.list().catch(() => null),
              api.game.listInstalledVersions().catch(() => null),
            ]);
            if (Array.isArray(freshInstances)) setInstances(freshInstances);
            if (Array.isArray(freshVersions)) setInstalledVersions(freshVersions);
            if (res.created || !resolvedActiveInstanceId) selectInstance(res.instanceId);
          })
          .catch(() => { });

        // The only automatic launcher update check (the main process no longer runs its own)
        if (state?.settings?.autoUpdate !== false) checkUpdatesSilently();
      } catch (err) {
        console.error('Failed to initialize launcher state:', err);
      } finally {
        setStateHydrated(true);
      }
    };

    api.system.getAppVersion().then(ver => { if (ver) setAppVersion(String(ver)); }).catch(() => { });
    api.system.getInfo().then(info => { if (info?.totalRamGb > 0) setSystemTotalRam(info.totalRamGb); }).catch(() => { });
    initializeLauncher();
  }, [addLog, persistState, selectInstance, setLogs, checkUpdatesSilently]);

  // ── Profiles ──
  const handleSaveProfile = (profileData) => {
    setProfiles(prev => {
      const targetId = profileData.id || `profile-${Date.now()}`;
      const next = profileData.id
        ? prev.map(p => (p.id === profileData.id ? { ...p, ...profileData } : p))
        : [...prev, { ...profileData, id: targetId }];
      if (!profileData.id) setActiveProfileId(targetId);
      persistState({ profiles: next, activeProfileId: profileData.id ? activeProfileId : targetId });
      return next;
    });
  };

  const handleDeleteProfile = (profileId) => {
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== profileId);
      let nextActiveId = activeProfileId;
      if (next.length === 0) {
        next.push(DEFAULT_PROFILE);
        nextActiveId = DEFAULT_PROFILE.id;
      } else if (activeProfileId === profileId) {
        nextActiveId = next[0].id;
      }
      if (nextActiveId !== activeProfileId) setActiveProfileId(nextActiveId);
      persistState({ profiles: next, activeProfileId: nextActiveId });
      return next;
    });
  };

  const handleDuplicateProfile = (profileId, e) => {
    e?.stopPropagation();
    const sourceProfile = profiles.find(p => p.id === profileId);
    if (!sourceProfile) return;
    const newId = `profile-${Date.now()}`;
    setProfiles(prev => {
      const next = [...prev, { ...sourceProfile, id: newId, name: `${sourceProfile.name} (Copy)` }];
      setActiveProfileId(newId);
      persistState({ profiles: next, activeProfileId: newId });
      return next;
    });
  };

  const handleSelectProfile = (profileId) => {
    setActiveProfileId(profileId);
    persistState({ activeProfileId: profileId });
  };

  const handleSelectVersion = (versionId) => {
    if (!activeProfileId) return;
    setProfiles(prev => {
      const next = prev.map(p => (p.id === activeProfileId ? { ...p, version: versionId } : p));
      persistState({ profiles: next });
      return next;
    });
  };

  // ── Install and play ──
  const handleInstall = async (type, opts) => {
    if (!isOnline) {
      pushToast({ tone: 'error', title: t('install.minecraft') || 'Install', message: t('offline.installRequiresInternet') });
      return;
    }
    startConsoleTask();
    const installPayload = typeof opts === 'string' ? { version: opts } : (opts || {});
    addLog('info', `Starting ${type} installation...`);
    setProgress(0);
    try {
      const res = await api.game.install({ type, ...installPayload });
      if (res?.error) addLog('error', `Installation failed: ${res.message || res.error}`);
    } catch (e) {
      addLog('error', `Install launch failed: ${e?.message || e}`);
    } finally {
      setInstallId(null);
    }
  };

  const handleCancelInstall = async () => {
    if (!installId) return;
    try {
      await api.game.cancelInstall({ installId });
    } catch (e) {
      addLog('error', `Failed to cancel install: ${e?.message || e}`);
    } finally {
      setInstallId(null);
    }
  };

  // `instanceId` lets callers launch an instance they just selected (state updates are async,
  // so reading activeInstanceId here would still return the previous one)
  const handlePlay = async (instanceId = activeInstanceId) => {
    if (gameState === 'running') {
      if (!runPid) return;
      try {
        await api.game.stop({ pid: runPid });
        setGameState('idle');
        setRunPid(null);
      } catch (e) {
        addLog('error', `Failed to stop game: ${e?.message || e}`);
      }
      return;
    }

    if (!activeProfile) return;
    startConsoleTask({ switchTab: settings.showConsole !== false });
    setGameState('loading');
    setProgress(0);
    addLog('info', `Launching profile: ${activeProfile.name}`);

    try {
      const runSession = await auth.getLaunchSession();
      const instance = instances.find(i => i.id === instanceId) || null;
      const targetVersion = instance?.version
        ? (installedVersions.find(v => v.id === instance.version) || instance.version)
        : (activeVersion || activeProfile?.version);
      const res = await api.game.run({
        profile: {
          ...activeProfile,
          ram: instance?.ram || activeProfile.ram,
          jvmArguments: instance?.jvmArguments || activeProfile.jvmArguments,
          javaPath: instance?.javaPath || activeProfile.javaPath,
        },
        version: targetVersion,
        instanceId,
        session: runSession || createOfflineSession(activeProfile.localName || 'Player'),
      });
      if (res?.error) {
        addLog('error', `Launch failed: ${res.message || res.error}`);
        setGameState('idle');
        return;
      }
      if (res?.pid) {
        setRunPid(res.pid);
        setGameState('running');
        addLog('success', `Minecraft process started (PID: ${res.pid})`);
      }
    } catch (e) {
      addLog('error', `Launch exception: ${e?.message || e}`);
      setGameState('idle');
    }
  };

  const handlePlayButton = () => {
    if (installedVersions.length === 0 && !activeProfile?.version) {
      setModal('install');
      return;
    }
    handlePlay();
  };

  // ── Settings ──
  const handleSettingChange = (key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      persistState({ settings: next });
      if (key === 'showSnapshots') {
        api.game.getCatalog({ includeSnapshots: Boolean(val), showSnapshots: Boolean(val) })
          .then((catalog) => {
            if (catalog?.versions) setVersionCatalog(catalog.versions);
            if (catalog?.installTargets) setInstallTargets(catalog.installTargets);
          })
          .catch((err) => console.error('Failed to refresh catalog on setting change:', err));
      }
      return next;
    });
  };

  const handleOpenMinecraftDirectory = async () => {
    try {
      if (activeInstanceId) await api.content.openFolder('instance', activeInstanceId);
      else await api.minecraftFolder.open();
    } catch (e) {
      addLog('error', `Failed to open directory: ${e?.message || e}`);
    }
  };

  const handleChangeMinecraftDirectory = async (reset = false) => {
    try {
      const res = reset ? await api.minecraftFolder.reset() : await api.minecraftFolder.pick();
      if (!res || res.canceled) return;
      if (res.error) {
        pushToast({ tone: 'error', title: t('settings.minecraftDirectory'), message: t('settings.changeMinecraftDirectoryFailed', { error: res.message || res.error }) });
        return;
      }
      addLog('info', `Minecraft directory set to ${res.root}`);
      // Versions, instances and content all live under the root, so reload to re-read everything
      window.location.reload();
    } catch (e) {
      addLog('error', `Failed to change Minecraft directory: ${e?.message || e}`);
    }
  };

  const handleOpenSourceCode = () => { api.system.openExternal(APP_SOURCE_URL).catch(() => { }); };
  const handleOpenReleases = () => { api.system.openExternal(APP_RELEASES_URL).catch(() => { }); };

  // ── Console ──
  const handleCopyConsole = () => {
    navigator.clipboard?.writeText(logs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n'));
    pushToast({ tone: 'info', title: t('console.copy'), message: t('console.copiedToClipboard') });
  };
  const handleClearConsole = () => {
    setLogs([]);
    persistState({ logs: [] });
  };

  // ── Instances ──
  const refreshInstances = async () => {
    const updated = await api.instances.list();
    if (Array.isArray(updated)) setInstances(updated);
    return Array.isArray(updated) ? updated : [];
  };

  const handleSaveInstance = async (instanceData) => {
    if (instanceEditor?.mode === 'create') {
      const res = await api.instances.create(instanceData);
      if (res?.ok && res?.instance) {
        await refreshInstances();
        selectInstance(res.instance.id);
        pushToast({ tone: 'success', title: t('instances.createdTitle'), message: t('instances.createdMessage', { name: instanceData.name }) });
      }
      return;
    }
    const res = await api.instances.update(instanceData.id, instanceData);
    if (res?.ok) {
      await refreshInstances();
      pushToast({ tone: 'success', title: t('instances.savedTitle'), message: t('instances.savedMessage') });
    }
  };

  const handleMigrateInstance = async (migrateData) => {
    const res = await api.instances.migrateBaseFolder(migrateData);
    if (res?.ok && res?.instance) {
      await refreshInstances();
      selectInstance(res.instance.id);
      pushToast({
        tone: 'success',
        title: t('migration.successTitle'),
        message: t(res.mode === 'converted' ? 'migration.convertedMessage' : 'migration.copiedMessage', { name: res.instance.name }),
      });
    } else {
      pushToast({ tone: 'critical', title: t('common.error') || 'Error', message: res?.message || 'Migration failed' });
    }
  };

  const handleDeleteInstanceClick = (inst) => {
    setConfirmDialog({
      title: t('instances.delete'),
      message: t('instances.deleteConfirm', { name: inst.name }),
      confirmText: t('common.delete') || 'Delete',
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        await api.instances.remove(inst.id);
        const updated = await refreshInstances();
        if (activeInstanceId === inst.id) selectInstance(updated[0]?.id || null);
        pushToast({ tone: 'info', title: t('instances.deletedTitle'), message: t('instances.deletedMessage', { name: inst.name }) });
      },
    });
  };

  // ── Navigation helpers ──
  const navigateTo = (tab) => {
    setSelectedModDetail(null);
    news.setSelectedArticle(null);
    setActiveTab(tab);
  };
  const openLocalDetails = (item, projectType) => {
    setSelectedModDetail({ project: localItemToProject(item, projectType, modUpdates.modUpdates), initialTab: 'overview' });
  };

  const detailProjectType = selectedModDetail?.project?.project_type;
  const detailContentList = detailProjectType === 'shader' || exploreType === 'shaders' ? shaders
    : detailProjectType === 'resourcepack' || exploreType === 'resourcepacks' ? resourcePacks
      : detailProjectType === 'datapack' || exploreType === 'datapacks' ? datapacks
        : mods;
  const parentTabTitle = {
    explore: t('sidebar.explore'),
    mods: t('sidebar.mods'),
    shaders: t('sidebar.shaders'),
    resourcepacks: t('sidebar.resourcePacks'),
    datapacks: t('sidebar.datapacks'),
  }[activeTab] || t('sidebar.explore');

  const profileAvatarName = (account.loggedIn && account.name)
    ? account.name
    : (activeProfile?.skinName || activeProfile?.microsoftAccount || (activeProfile?.localName && activeProfile?.localName !== 'Player' ? activeProfile?.localName : '') || 'MHF_Steve');
  const profileToEdit = profileEditor?.mode === 'edit' ? profiles.find(p => p.id === profileEditor.profileId) || null : null;

  const dragProps = {
    isDragging: content.isDragging,
    handleDragOver: content.handleDragOver,
    handleDragLeave: content.handleDragLeave,
    handleDrop: content.handleDrop,
    handleOpenContentFolder: content.handleOpenContentFolder,
    handleAddContentClick: content.handleAddContentClick,
    setExploreType,
    setActiveTab,
  };

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onClose={dismissToast} />
        ))}
      </div>

      <TitleBar appVersion={appVersion} />

      <div className="app-layout">
        <Sidebar
          profiles={profiles}
          activeProfileId={activeProfileId}
          installedVersions={installedVersions}
          versionCatalog={versionCatalog}
          account={account}
          authRefreshing={auth.authRefreshing}
          gameState={gameState}
          onSelectProfile={handleSelectProfile}
          onEditProfile={(id) => setProfileEditor({ mode: 'edit', profileId: id })}
          onDuplicateProfile={handleDuplicateProfile}
          onDeleteProfile={handleDeleteProfile}
          onNewProfile={() => setProfileEditor({ mode: 'new', profileId: null })}
          activeTab={activeTab}
          detailOpen={Boolean(selectedModDetail || news.selectedArticle)}
          onNavigate={navigateTo}
          counters={{
            instances: instances.length,
            enabledMods: mods.filter(m => m.enabled).length,
            shaders: shaders.length,
            resourcePacks: resourcePacks.length,
            datapacks: datapacks.length,
          }}
          settingsOpen={modal === 'settings'}
          onOpenSettings={() => setModal('settings')}
          profileAvatarName={profileAvatarName}
          onOpenAccount={() => setAccountModalOpen(true)}
          onLogin={auth.handleLogin}
          onLogout={auth.handleLogout}
        />

        <main className="main-content">
          {news.selectedArticle ? (
            <ArticleDetailView item={news.selectedArticle} onBack={() => news.setSelectedArticle(null)} />
          ) : selectedModDetail ? (
            <ProjectDetailView
              project={selectedModDetail.project}
              initialTab={selectedModDetail.initialTab || 'overview'}
              currentLoader={currentLoader}
              currentMcVer={currentMcVer}
              mods={detailContentList}
              installingVersionId={explore.installingVersionId}
              onBack={() => setSelectedModDetail(null)}
              onInstallVersion={explore.handleInstallSpecificVersion}
              parentTabTitle={selectedModDetail.parentTitle || parentTabTitle}
            />
          ) : (
            <>
              <ActionBar
                activeTab={activeTab}
                onSelectTab={setActiveTab}
                activeInstance={activeInstance}
                isOnline={isOnline}
                gameState={gameState}
                onOpenInstall={() => setModal('install')}
                onOpenMinecraftDirectory={handleOpenMinecraftDirectory}
                onOpenSettings={() => setModal('settings')}
              />

              <UpdateBanner updateState={launcherUpdate.updateState} />

              <InstancesTab
                active={activeTab === 'instances'}
                instances={instances}
                activeInstanceId={activeInstanceId}
                onSelectInstance={selectInstance}
                onPlayInstance={(inst) => {
                  selectInstance(inst.id);
                  handlePlay(inst.id);
                }}
                onCreateInstanceClick={() => setInstanceEditor({ mode: 'create', instance: null })}
                onMigrateClick={() => setMigrateModalOpen(true)}
                onEditInstanceClick={(inst) => setInstanceEditor({ mode: 'edit', instance: inst })}
                onDeleteInstanceClick={handleDeleteInstanceClick}
                onOpenFolderClick={(id) => api.content.openFolder('instance', id)}
                runningInstanceId={gameState === 'running' ? activeInstanceId : null}
              />

              <NewsTab
                active={activeTab === 'news'}
                isOnline={isOnline}
                newsItems={news.newsItems}
                newsLoading={news.newsLoading}
                newsError={news.newsError}
                loadNews={news.loadNews}
                handleOpenNewsSource={news.handleOpenNewsSource}
                handleOpenNewsArticle={news.handleOpenNewsArticle}
              />

              <ExploreTab
                active={activeTab === 'explore'}
                isOnline={isOnline}
                exploreType={exploreType}
                setExploreType={setExploreType}
                showBetaInfo={showBetaInfo}
                setShowBetaInfo={setShowBetaInfo}
                betaInfoRef={betaInfoRef}
                modrinthQuery={explore.modrinthQuery}
                setModrinthQuery={explore.setModrinthQuery}
                modrinthSort={explore.modrinthSort}
                setModrinthSort={explore.setModrinthSort}
                modrinthLoaderFilter={explore.modrinthLoaderFilter}
                setModrinthLoaderFilter={explore.setModrinthLoaderFilter}
                currentLoader={currentLoader}
                modrinthVersionFilter={explore.modrinthVersionFilter}
                setModrinthVersionFilter={explore.setModrinthVersionFilter}
                currentMcVer={currentMcVer}
                modrinthCategory={explore.modrinthCategory}
                setModrinthCategory={explore.setModrinthCategory}
                modrinthLoading={explore.modrinthLoading}
                modrinthResults={explore.modrinthResults}
                isModInstalled={isModInstalled}
                modrinthInstalling={explore.modrinthInstalling}
                handleInstallModrinthMod={explore.handleInstallModrinthMod}
                handleOpenModDetails={(project) => setSelectedModDetail({ project, initialTab: 'overview' })}
                modrinthSentinelRef={explore.modrinthSentinelRef}
                modrinthLoadingMore={explore.modrinthLoadingMore}
              />

              <ModsTab
                active={activeTab === 'mods'}
                {...dragProps}
                modSearch={modSearch}
                setModSearch={setModSearch}
                mods={mods}
                handleSetAllModsEnabled={content.handleSetAllModsEnabled}
                handleCheckModUpdates={modUpdates.handleCheckModUpdates}
                checkingModUpdates={modUpdates.checkingModUpdates}
                modUpdates={modUpdates.modUpdates}
                updatingMods={modUpdates.updatingMods}
                handleModToggle={content.handleModToggle}
                handleModDelete={content.handleModDelete}
                handleUpdateMod={modUpdates.handleUpdateMod}
                handleOpenLocalModDetails={(mod) => openLocalDetails(mod, 'mod')}
              />

              <ShadersTab
                active={activeTab === 'shaders'}
                {...dragProps}
                shaderSearch={shaderSearch}
                setShaderSearch={setShaderSearch}
                shaders={shaders}
                handleOpenLocalShaderDetails={(shader) => openLocalDetails(shader, 'shader')}
                handleDeleteShader={content.handleDeleteShader}
              />

              <ResourcePacksTab
                active={activeTab === 'resourcepacks'}
                {...dragProps}
                resourcePackSearch={resourcePackSearch}
                setResourcePackSearch={setResourcePackSearch}
                resourcePacks={resourcePacks}
                handleOpenLocalResourcePackDetails={(pack) => openLocalDetails(pack, 'resourcepack')}
                handleDeleteResourcePack={content.handleDeleteResourcePack}
              />

              <DatapacksTab
                active={activeTab === 'datapacks'}
                {...dragProps}
                datapackSearch={datapackSearch}
                setDatapackSearch={setDatapackSearch}
                datapacks={datapacks}
                handleOpenLocalDatapackDetails={(pack) => openLocalDetails(pack, 'datapack')}
                handleDeleteDatapack={content.handleDeleteDatapack}
              />

              <ConsoleTab
                active={activeTab === 'console'}
                gameState={gameState}
                runPid={runPid}
                logFilter={logFilter}
                setLogFilter={setLogFilter}
                autoScroll={autoScroll}
                setAutoScroll={setAutoScroll}
                handleCopyConsole={handleCopyConsole}
                handleClearConsole={handleClearConsole}
                consoleRef={consoleRef}
                logs={logs}
              />
            </>
          )}

          <PlayDeck
            installedVersions={installedVersions}
            selectedVersionId={selectedInstalledVersionId}
            onSelectVersion={handleSelectVersion}
            loaderType={profileLoaderType}
            gameState={gameState}
            authRefreshing={auth.authRefreshing}
            progress={progress}
            installId={installId}
            onCancelInstall={handleCancelInstall}
            onPlay={handlePlayButton}
          />
        </main>
      </div>

      {/* ── Dialogs ── */}
      {instanceEditor && (
        <InstanceModal
          mode={instanceEditor.mode}
          instance={instanceEditor.instance}
          availableVersions={installedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setInstanceEditor(null)}
          onSave={handleSaveInstance}
        />
      )}
      {migrateModalOpen && (
        <MigrateInstanceModal
          availableVersions={installedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setMigrateModalOpen(false)}
          onMigrate={handleMigrateInstance}
        />
      )}
      {accountModalOpen && (
        <AccountModal
          currentAccount={account}
          loginLoading={auth.loginLoading}
          onClose={() => setAccountModalOpen(false)}
          onSaveOfflineName={auth.saveOfflineName}
          onLoginMicrosoft={() => { setAccountModalOpen(false); auth.handleLogin(); }}
          onLogout={() => { setAccountModalOpen(false); auth.handleLogout(); }}
        />
      )}
      {profileEditor && (
        <ProfileModal
          mode={profileEditor.mode}
          profile={profileToEdit}
          versions={installedVersions}
          systemTotalRam={systemTotalRam}
          onClose={() => setProfileEditor(null)}
          onSave={handleSaveProfile}
        />
      )}
      {modal === 'install' && (
        <InstallModal
          initialType="minecraft"
          installTargets={installTargets}
          showSnapshots={settings.showSnapshots}
          onToggleSnapshots={(val) => handleSettingChange('showSnapshots', val)}
          onClose={() => setModal(null)}
          onInstall={handleInstall}
          onCatalogLoaded={(catalog) => {
            if (catalog?.versions) setVersionCatalog(catalog.versions);
            if (catalog?.installTargets) setInstallTargets(catalog.installTargets);
          }}
        />
      )}
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={handleSettingChange}
          onClose={() => setModal(null)}
          onCheckUpdates={launcherUpdate.handleCheckForUpdates}
          onOpenAbout={() => setModal('about')}
          onOpenMinecraftDirectory={handleOpenMinecraftDirectory}
          onChangeMinecraftDirectory={() => handleChangeMinecraftDirectory(false)}
          onResetMinecraftDirectory={() => handleChangeMinecraftDirectory(true)}
          onOpenSourceCode={handleOpenSourceCode}
          onOpenReleases={handleOpenReleases}
          language={language}
          onLanguageChange={setLanguage}
          appVersion={appVersion}
        />
      )}
      {modal === 'about' && (
        <AboutModal
          appVersion={appVersion}
          language={language}
          onClose={() => setModal(null)}
          onOpenSourceCode={handleOpenSourceCode}
          onOpenReleases={handleOpenReleases}
          onCheckUpdates={launcherUpdate.handleCheckForUpdates}
        />
      )}
      {modUpdates.modConflict && (
        <ModConflictModal
          conflict={modUpdates.modConflict}
          mods={mods}
          onClose={() => modUpdates.setModConflict(null)}
          onResolveUpdate={modUpdates.handleResolveConflictUpdate}
          onAutoFixAll={modUpdates.handleAutoFixAllConflicts}
          fixingAll={modUpdates.fixingAllConflicts}
          onOpenModsFolder={handleOpenMinecraftDirectory}
        />
      )}
      {auth.loginLoading && <LoginLoadingModal onCancel={auth.cancelLogin} />}
      {launcherUpdate.updateModalInfo && (
        <UpdateModal
          updateInfo={launcherUpdate.updateModalInfo}
          onClose={() => launcherUpdate.setUpdateModalInfo(null)}
          onInstall={launcherUpdate.handleApplyUpdate}
        />
      )}
      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </>
  );
}
