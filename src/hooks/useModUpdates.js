import { useState, useCallback, useEffect, useRef } from 'react';
import { api, EVENTS } from '../api';
import { findModInList } from '../utils/formatters';

const stripV = (value) => String(value || '').replace(/^v/i, '').trim();

// Mod update checks, single/bulk updates and the mod-conflict dialog (all on the active instance).
export function useModUpdates({
  isOnline, activeTab, activeInstanceId, loader, gameVersion, baseLoader, baseGameVersion,
  mods, setMods, loadMods, startConsoleTask, pushToast, t,
}) {
  const [modUpdates, setModUpdates] = useState({});
  const [checkingModUpdates, setCheckingModUpdates] = useState(false);
  const [updatingMods, setUpdatingMods] = useState(new Set());
  const [modConflict, setModConflict] = useState(null);
  const [fixingAllConflicts, setFixingAllConflicts] = useState(false);
  const checkingRef = useRef(false);
  const checkedOnTabOpenRef = useRef(false);

  // The main process reports a conflict when the game crashes on start because of mods
  useEffect(() => api.events.on(EVENTS.MOD_CONFLICT, (conflictData) => setModConflict(conflictData)), []);

  const applyModsResult = useCallback((res) => {
    if (Array.isArray(res?.mods)) setMods(res.mods);
    else loadMods();
  }, [setMods, loadMods]);

  // Installs a specific mod version into the active instance. Updates follow the explore filters;
  // conflict fixes always use the instance's own loader and game version.
  const installModVersion = (payload) => api.modrinth.install({ loader, gameVersion, instanceId: activeInstanceId, ...payload });
  const installForInstance = (payload) => installModVersion({ loader: baseLoader, gameVersion: baseGameVersion, ...payload });

  const handleCheckModUpdates = useCallback(async ({ silent = false } = {}) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setCheckingModUpdates(true);
    try {
      if (!isOnline) {
        if (!silent) pushToast({ tone: 'warning', title: t('mods.checkUpdates'), message: t('offline.noConnectionToast') });
        return;
      }
      const res = await api.content.checkModUpdates({ loader, gameVersion, instanceId: activeInstanceId });
      if (res?.updates) {
        setModUpdates(res.updates);
        const count = Object.keys(res.updates).filter(k => k.includes('.jar')).length;
        if (!silent) {
          pushToast(count > 0
            ? { tone: 'success', title: t('mods.checkUpdates'), message: t('mods.updatesAvailable', { count }) }
            : { tone: 'info', title: t('mods.checkUpdates'), message: t('mods.upToDate') });
        }
      }
    } catch (e) {
      if (!silent) pushToast({ tone: 'error', title: t('mods.checkUpdates'), message: e?.message || String(e) });
    } finally {
      checkingRef.current = false;
      setCheckingModUpdates(false);
    }
  }, [isOnline, loader, gameVersion, activeInstanceId, pushToast, t]);

  // Quiet check the first time the mods tab is opened (again after leaving it)
  const checkRef = useRef(handleCheckModUpdates);
  useEffect(() => { checkRef.current = handleCheckModUpdates; }, [handleCheckModUpdates]);
  useEffect(() => {
    if (activeTab !== 'mods') {
      checkedOnTabOpenRef.current = false;
      return;
    }
    if (isOnline && !checkedOnTabOpenRef.current) {
      checkedOnTabOpenRef.current = true;
      checkRef.current({ silent: true });
    }
  }, [activeTab, isOnline]);

  const handleUpdateMod = async (updateInfo) => {
    if (!updateInfo) return;
    const key = updateInfo.fileName || updateInfo.fileKey;
    setUpdatingMods(prev => new Set(prev).add(key));
    try {
      const res = await installModVersion({
        projectId: updateInfo.projectId,
        versionId: updateInfo.versionId,
        fileUrl: updateInfo.fileUrl,
        fileName: updateInfo.targetFileName || updateInfo.fileName,
      });
      if (res?.error) {
        pushToast({ tone: 'error', title: t('mods.updateMod'), message: res.message || res.error });
        return;
      }
      applyModsResult(res);
      setModUpdates(prev => {
        const next = { ...prev };
        delete next[updateInfo.fileName];
        delete next[updateInfo.fileKey];
        return next;
      });
      pushToast({ tone: 'success', title: t('mods.updateMod'), message: t('mods.installedSuccess', { name: updateInfo.newVersionName || updateInfo.fileName }) });
    } catch (e) {
      pushToast({ tone: 'error', title: t('mods.updateMod'), message: e?.message || String(e) });
    } finally {
      setUpdatingMods(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleUpdateAllMods = async () => {
    const entries = Object.values(modUpdates).filter((u, i, arr) => arr.findIndex(x => x.fileName === u.fileName) === i);
    for (const updateInfo of entries) {
      await handleUpdateMod(updateInfo);
    }
  };

  const handleResolveConflictUpdate = async (rec) => {
    if (!rec) return;
    startConsoleTask({ switchTab: false });
    try {
      pushToast({ tone: 'info', title: t('mods.updating'), message: `${rec.displayName || rec.modId} -> v${rec.targetVersion}` });
      const res = await installForInstance({ projectId: rec.modId, versionId: null, versionNumber: rec.targetVersion });
      if (res?.error) {
        pushToast({ tone: 'error', title: t('mods.conflictTitle'), message: res.message || res.error });
        return;
      }
      applyModsResult(res);
      setModConflict(null);
      const done = t('mods.installedSuccess', { name: rec.displayName || rec.modId });
      pushToast({ tone: 'success', title: done, message: done });
    } catch (e) {
      pushToast({ tone: 'error', title: t('mods.conflictTitle'), message: e?.message || String(e) });
    }
  };

  const handleAutoFixAllConflicts = async (compatFixes) => {
    if (!compatFixes || compatFixes.length === 0) return;
    startConsoleTask({ switchTab: false });
    setFixingAllConflicts(true);
    pushToast({ tone: 'info', title: t('mods.conflictFixAllBtn'), message: t('mods.conflictFixing') });
    try {
      for (const fix of compatFixes) {
        // Base mod: only when the installed version is not already the target
        const mainMod = findModInList(mods, fix.modId, fix.displayName);
        if (!stripV(mainMod?.version) || stripV(mainMod?.version) !== stripV(fix.targetVersion)) {
          await installForInstance({ projectId: fix.modId, versionNumber: fix.targetVersion });
        }
        // Companion mods that must move together with it
        for (const item of Array.isArray(fix.cascade) ? fix.cascade : []) {
          const cascadeMod = findModInList(mods, item.modId, item.displayName);
          if (cascadeMod && (!stripV(cascadeMod.version) || stripV(cascadeMod.version) !== stripV(item.targetVersion))) {
            await installForInstance({ projectId: item.modId, versionNumber: item.targetVersion });
          }
        }
      }

      // Re-enable Iris if it was disabled
      const irisMod = mods.find(m => String(m.id || '').toLowerCase() === 'iris' || String(m.fileName || '').toLowerCase().includes('iris'));
      if (irisMod && !irisMod.enabled) {
        await api.content.toggleMod(irisMod.id || irisMod.fileName, true, activeInstanceId);
      }

      await loadMods();
      setModConflict(null);
      pushToast({ tone: 'success', title: t('mods.conflictFixAllBtn'), message: t('mods.conflictFixedSuccess') });
    } catch (e) {
      pushToast({ tone: 'error', title: t('mods.conflictTitle'), message: e?.message || String(e) });
    } finally {
      setFixingAllConflicts(false);
    }
  };

  return {
    modUpdates, checkingModUpdates, updatingMods,
    handleCheckModUpdates, handleUpdateMod, handleUpdateAllMods,
    modConflict, setModConflict, fixingAllConflicts,
    handleResolveConflictUpdate, handleAutoFixAllConflicts,
  };
}
