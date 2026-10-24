import { useState, useEffect, useCallback } from 'react';
import { api, EVENTS } from '../api';

const IDLE = { phase: 'idle', progress: 0, message: '' };

// Launcher self-update: progress events from the main process, the "update available"
// dialog, and the manual check / install actions.
export function useLauncherUpdate({ t, addLog, pushToast }) {
  const [updateState, setUpdateState] = useState(IDLE);
  const [updateModalInfo, setUpdateModalInfo] = useState(null);

  useEffect(() => {
    const offs = [
      api.events.on(EVENTS.UPDATE_AVAILABLE, (info) => {
        if (info?.available) setUpdateModalInfo(info);
      }),
      api.events.on(EVENTS.UPDATE_STATUS, (u) => {
        if (!u?.phase) return;
        setUpdateState(prev => ({ ...prev, phase: u.phase, message: u.message || '', currentVersion: u.currentVersion, latestVersion: u.latestVersion }));
      }),
      api.events.on(EVENTS.UPDATE_PROGRESS, (u) => {
        if (typeof u?.percent !== 'number') return;
        setUpdateState(prev => ({ ...prev, phase: u.phase || 'downloading', progress: u.percent, assetName: u.assetName }));
      }),
      api.events.on(EVENTS.UPDATE_COMPLETE, () => {
        setUpdateState(prev => ({ ...prev, phase: 'complete', message: 'Update ready' }));
      }),
    ];
    return () => offs.forEach(off => off());
  }, []);

  // Silent check on start (when enabled in settings)
  const checkSilently = useCallback(() => {
    api.updates.check()
      .then(res => { if (res?.available) setUpdateModalInfo(res); })
      .catch(() => { });
  }, []);

  const handleCheckForUpdates = async () => {
    addLog('info', t('messages.checkingUpdates'));
    pushToast({ tone: 'info', title: t('update.launcherUpdate'), message: t('messages.checkingUpdates') });
    try {
      const res = await api.updates.check();
      if (res?.available && res?.latestVersion) {
        setUpdateModalInfo(res);
      } else if (res?.upToDate) {
        pushToast({ tone: 'success', title: t('update.launcherUpdate'), message: t('messages.alreadyUpToDate') });
      }
    } catch (e) {
      addLog('error', `Update check failed: ${e?.message || e}`);
      pushToast({ tone: 'error', title: t('update.launcherUpdate'), message: t('messages.updateCheckFailed', { error: e?.message || '' }) });
    }
  };

  const handleApplyUpdate = async (updateInfo) => {
    setUpdateModalInfo(null);
    setUpdateState({
      phase: 'downloading',
      progress: 0,
      latestVersion: updateInfo?.latestVersion,
      message: t('updater.downloading', { assetName: updateInfo?.asset?.name || '' }),
    });
    try {
      const result = await api.updates.apply();
      if (result?.error) {
        setUpdateState(IDLE);
        addLog('error', `Update not installed: ${result.message || result.error}`);
        pushToast({ tone: 'error', title: t('update.launcherUpdate'), message: result.message || result.error });
      }
    } catch (e) {
      setUpdateState(IDLE);
      addLog('error', `Failed to apply update: ${e?.message || e}`);
    }
  };

  return {
    updateState, updateModalInfo, setUpdateModalInfo,
    checkSilently, handleCheckForUpdates, handleApplyUpdate,
  };
}
