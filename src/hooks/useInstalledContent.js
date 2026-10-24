import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { CONTENT_TABS, exploreTypeToProjectType, tabToContentType } from '../utils/content';

const PACK_TYPES = {
  shaders: { type: 'shader', titleKey: 'mods.contentTypeShaders', successKey: 'mods.shadersImportedSuccess' },
  resourcepacks: { type: 'resourcepack', titleKey: 'mods.contentTypeResourcePacks', successKey: 'mods.resourcePacksImportedSuccess' },
  datapacks: { type: 'datapack', titleKey: 'mods.contentTypeDatapacks', successKey: 'mods.datapacksImportedSuccess' },
};

// Accepts both singular and plural forms ('shader' / 'shaders')
function normalizeContentType(type) {
  if (type === 'shader' || type === 'shaders') return 'shaders';
  if (type === 'resourcepack' || type === 'resourcepacks') return 'resourcepacks';
  if (type === 'datapack' || type === 'datapacks') return 'datapacks';
  return 'mods';
}

// Installed mods, shaders, resource packs and data packs of the active instance,
// plus every action on them (toggle, delete, import, drag & drop).
export function useInstalledContent({ activeInstanceId, activeTab, exploreType, enabled, t, pushToast, addLog }) {
  const [mods, setMods] = useState([]);
  const [shaders, setShaders] = useState([]);
  const [resourcePacks, setResourcePacks] = useState([]);
  const [datapacks, setDatapacks] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const loadMods = useCallback(async () => {
    try {
      const list = await api.content.listMods(activeInstanceId);
      if (Array.isArray(list)) setMods(list);
    } catch { /* keep the current list */ }
  }, [activeInstanceId]);

  const loadShaders = useCallback(async () => {
    try {
      const list = await api.content.listShaders(activeInstanceId);
      if (Array.isArray(list)) setShaders(list);
    } catch { /* keep the current list */ }
  }, [activeInstanceId]);

  const loadResourcePacks = useCallback(async () => {
    try {
      const list = await api.content.listResourcePacks(activeInstanceId);
      if (Array.isArray(list)) setResourcePacks(list);
    } catch { /* keep the current list */ }
  }, [activeInstanceId]);

  const loadDatapacks = useCallback(async () => {
    try {
      const list = await api.content.listDatapacks(activeInstanceId);
      if (Array.isArray(list)) setDatapacks(list);
    } catch { /* keep the current list */ }
  }, [activeInstanceId]);

  const reloadAll = useCallback(
    () => Promise.all([loadMods(), loadShaders(), loadResourcePacks(), loadDatapacks()]),
    [loadMods, loadShaders, loadResourcePacks, loadDatapacks],
  );

  const loaders = { mods: loadMods, shaders: loadShaders, resourcepacks: loadResourcePacks, datapacks: loadDatapacks };

  // Load once the saved state is known (so we never read the wrong folder first) and on instance change
  useEffect(() => {
    if (enabled) reloadAll();
  }, [enabled, reloadAll]);

  // Re-read when a content tab is opened: files may have been added outside the launcher.
  // Only tab changes trigger this; instance changes are handled above, so nothing loads twice.
  const reloadAllRef = useRef(reloadAll);
  useEffect(() => { reloadAllRef.current = reloadAll; }, [reloadAll]);
  useEffect(() => {
    if (enabled && CONTENT_TABS.includes(activeTab)) reloadAllRef.current();
  }, [enabled, activeTab]);

  // After a Modrinth install: use the list the main process returned, or re-read it
  const refreshAfterInstall = useCallback((projectType, res) => {
    if (projectType === 'shader') {
      if (Array.isArray(res?.items)) setShaders(res.items); else loadShaders();
    } else if (projectType === 'resourcepack') {
      if (Array.isArray(res?.items)) setResourcePacks(res.items); else loadResourcePacks();
    } else if (projectType === 'datapack') {
      if (Array.isArray(res?.items)) setDatapacks(res.items); else loadDatapacks();
    } else {
      const list = res?.mods || res?.items;
      if (Array.isArray(list)) setMods(list); else loadMods();
    }
  }, [loadMods, loadShaders, loadResourcePacks, loadDatapacks]);

  // ── Mods ──
  const handleModToggle = async (modId) => {
    const targetMod = mods.find(m => m.id === modId);
    if (!targetMod) return;
    try {
      await api.content.toggleMod(modId, !targetMod.enabled, activeInstanceId);
      loadMods();
    } catch (e) {
      addLog('error', `Failed to toggle mod: ${e?.message || e}`);
    }
  };

  const handleSetAllModsEnabled = async (enable) => {
    try {
      await api.content.setAllModsEnabled(enable, activeInstanceId);
      loadMods();
    } catch (e) {
      addLog('error', `Failed to set all mods enabled: ${e?.message || e}`);
    }
  };

  const handleModDelete = async (modId) => {
    try {
      await api.content.deleteMod(modId, activeInstanceId);
      loadMods();
    } catch (e) {
      addLog('error', `Failed to delete mod: ${e?.message || e}`);
    }
  };

  const importModPaths = async (filePaths) => {
    for (const filePath of filePaths) {
      await api.content.installModFile(filePath, activeInstanceId);
    }
    loadMods();
    pushToast({ tone: 'success', title: t('sidebar.modManager'), message: t('mods.modsImportedSuccess', { count: filePaths.length }) });
  };

  const handleAddModClick = async () => {
    try {
      const picked = await api.content.pickModFiles();
      const filePaths = Array.isArray(picked) ? picked : (picked?.filePaths || []);
      if (filePaths.length > 0) await importModPaths(filePaths);
    } catch (e) {
      addLog('error', `Failed to add mod: ${e?.message || e}`);
    }
  };

  // ── Shaders / resource packs / data packs ──
  const deletePack = async (kind, item, apiFn, titleKey) => {
    try {
      const res = await apiFn(item.fileName, activeInstanceId);
      if (res?.ok) {
        loaders[kind]();
        pushToast({ tone: 'success', title: t(titleKey), message: `${item.name || item.fileName} removed.` });
      }
    } catch (err) {
      pushToast({ tone: 'error', title: t(titleKey), message: err?.message || 'Delete failed.' });
    }
  };

  const handleDeleteShader = (shader) => deletePack('shaders', shader, api.content.deleteShader, 'mods.deleteShader');
  const handleDeleteResourcePack = (pack) => deletePack('resourcepacks', pack, api.content.deleteResourcePack, 'mods.deleteResourcePack');
  const handleDeleteDatapack = (pack) => deletePack('datapacks', pack, api.content.deleteDatapack, 'mods.deleteDatapack');

  // Imports pack files into the ACTIVE instance (this used to go to the base folder)
  const importPackPaths = async (kind, filePaths, fileNames = []) => {
    const { type, titleKey, successKey } = PACK_TYPES[kind];
    let imported = 0;
    for (let i = 0; i < filePaths.length; i += 1) {
      const res = await api.content.importFile({ type, sourcePath: filePaths[i], fileName: fileNames[i] }, activeInstanceId);
      if (res?.ok) imported += 1;
    }
    if (imported > 0) {
      loaders[kind]();
      pushToast({ tone: 'success', title: t(titleKey), message: t(successKey, { count: imported }) });
    }
  };

  const handleOpenContentFolder = async (type) => {
    try {
      await api.content.openFolder(type || tabToContentType(activeTab), activeInstanceId);
    } catch { /* folder could not be opened; nothing to do */ }
  };

  const handleAddContentClick = async (type) => {
    const kind = normalizeContentType(type || tabToContentType(activeTab));
    if (kind === 'mods') {
      await handleAddModClick();
      return;
    }
    try {
      const res = await api.content.pickFiles(PACK_TYPES[kind].type);
      if (res?.filePaths?.length > 0) await importPackPaths(kind, res.filePaths);
    } catch (e) {
      addLog('error', `Failed to add files: ${e?.message || e}`);
    }
  };

  // ── Drag & drop ──
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []).filter(f =>
      f.name.endsWith('.jar') || f.name.endsWith('.olpkg') || f.name.endsWith('.zip')
    );
    if (files.length === 0) return;

    const kind = activeTab === 'explore'
      ? normalizeContentType(exploreTypeToProjectType(exploreType))
      : normalizeContentType(tabToContentType(activeTab));
    const pathOf = (file) => api.system.getPathForFile(file) || file.path || file.name;

    addLog('info', t('mods.importingCount', { count: files.length }));
    try {
      if (kind === 'mods') {
        await importModPaths(files.map(pathOf));
      } else {
        const zips = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
        await importPackPaths(kind, zips.map(pathOf), zips.map(f => f.name));
      }
    } catch (err) {
      addLog('error', `Error importing files: ${err?.message || err}`);
    }
  };

  return {
    mods, setMods, shaders, resourcePacks, datapacks,
    loadMods, reloadAll, refreshAfterInstall,
    handleModToggle, handleSetAllModsEnabled, handleModDelete,
    handleDeleteShader, handleDeleteResourcePack, handleDeleteDatapack,
    handleOpenContentFolder, handleAddContentClick,
    isDragging, handleDragOver, handleDragLeave, handleDrop,
  };
}
