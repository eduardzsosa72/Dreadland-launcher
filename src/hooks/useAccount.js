import { useState, useEffect } from 'react';
import { api } from '../api';
import { createOfflineSession } from '../utils/formatters';

const NO_ACCOUNT = { name: '', loggedIn: false, profileKey: 'default', kind: 'none', session: null };

function localAccount(name, profileKey) {
  return name
    ? { name, loggedIn: true, profileKey, kind: 'local', session: createOfflineSession(name) }
    : { name: '', loggedIn: false, profileKey, kind: 'none', session: null };
}

// Account of the active profile: Microsoft login/logout, offline name, and keeping the
// profile's display name in sync with the Microsoft account.
export function useAccount({ activeProfile, isOnline, updateProfile, t, addLog, pushToast }) {
  const [account, setAccount] = useState(NO_ACCOUNT);
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const profileId = activeProfile?.id;

  // Re-read the stored auth whenever the active profile changes
  useEffect(() => {
    if (!activeProfile) return undefined;
    const profileKey = String(activeProfile.id || 'default');
    const fallbackName = String(activeProfile.skinName || activeProfile.localName || activeProfile.name || '').trim();
    let isMounted = true;
    setAuthRefreshing(true);

    api.auth.getState(profileKey)
      .then(auth => {
        if (!isMounted) return;
        if (auth?.loggedIn && auth.name) {
          setAccount({ name: auth.name, loggedIn: true, profileKey, kind: 'microsoft', session: auth });
          if (activeProfile.skinName !== auth.name || activeProfile.microsoftAccount !== auth.name) {
            updateProfile(profileKey, { skinName: auth.name, microsoftAccount: auth.name, localName: auth.name });
          }
        } else if (auth?.hasStoredToken && (auth?.name || activeProfile.skinName || activeProfile.microsoftAccount)) {
          // Token is stored but the refresh failed (e.g. offline): keep the Microsoft identity
          const savedName = auth.name || activeProfile.skinName || activeProfile.microsoftAccount || 'Player';
          setAccount({ name: savedName, loggedIn: true, profileKey, kind: 'microsoft', session: auth?.access_token ? auth : createOfflineSession(savedName) });
        } else {
          setAccount(localAccount(fallbackName, profileKey));
        }
      })
      .catch(() => {
        if (isMounted) setAccount(localAccount(fallbackName, profileKey));
      })
      .finally(() => {
        if (isMounted) setAuthRefreshing(false);
      });

    return () => { isMounted = false; };
    // Only a profile switch should trigger a re-read, not every edit of the profile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Fresh Microsoft session right before launching (tokens expire)
  const getLaunchSession = async () => {
    if (account.kind !== 'microsoft' || !activeProfile) return account.session;
    try {
      const freshAuth = await api.auth.getState(String(activeProfile.id || 'default'));
      if (freshAuth?.loggedIn && freshAuth?.access_token) {
        setAccount(prev => ({ ...prev, session: freshAuth }));
        return freshAuth;
      }
    } catch { /* offline or transient error: keep the existing session */ }
    return account.session;
  };

  const handleLogin = async () => {
    if (!isOnline) {
      pushToast({ tone: 'error', title: t('account.loginWithMicrosoft'), message: t('offline.loginRequiresInternet') });
      return;
    }
    const profileKey = String(activeProfile?.id || 'default');
    setLoginLoading(true);
    addLog('info', `${t('account.loginWithMicrosoft')}...`);
    try {
      const accountInfo = await api.auth.login(profileKey);
      if (accountInfo?.error) {
        if (accountInfo.cancelled) {
          addLog('info', t('account.loginCancelled'));
        } else {
          addLog('error', `Login failed: ${accountInfo.error}`);
          pushToast({ tone: 'error', title: t('account.loginWithMicrosoft'), message: accountInfo.error });
        }
        return;
      }
      if (!accountInfo?.name) {
        addLog('error', 'Login did not return account information.');
        return;
      }
      setAccount({ name: accountInfo.name, loggedIn: true, profileKey, kind: 'microsoft', session: accountInfo });
      updateProfile(profileKey, { skinName: accountInfo.name, microsoftAccount: accountInfo.name, localName: accountInfo.name });
      addLog('success', `Logged in as ${accountInfo.name}`);
      pushToast({ tone: 'success', title: t('account.loginWithMicrosoft'), message: t('messages.loginSuccess', { name: accountInfo.name }) });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.message?.includes('cancelled')) {
        addLog('info', t('account.loginCancelled'));
      } else {
        addLog('error', `Login failed: ${error?.message || error}`);
        pushToast({ tone: 'error', title: t('account.loginWithMicrosoft'), message: error?.message || t('messages.loginFailed', { error: '' }) });
      }
    } finally {
      setLoginLoading(false);
    }
  };

  // Hides the waiting dialog; the browser login page itself is left to the user
  const cancelLogin = () => {
    setLoginLoading(false);
    addLog('info', 'Login cancelled by user');
  };

  const handleLogout = async () => {
    const profileKey = String(activeProfile?.id || 'default');
    try {
      await api.auth.logout(profileKey);
      const fallbackName = (activeProfile?.name && activeProfile?.name !== 'Default') ? activeProfile.name : 'Player';
      updateProfile(profileKey, { microsoftAccount: '', skinName: '', localName: fallbackName });
      setAccount(localAccount(fallbackName, profileKey));
      addLog('info', 'Logged out from Microsoft.');
      pushToast({ tone: 'info', title: t('account.logout'), message: t('messages.logoutSuccess') });
    } catch (e) {
      addLog('error', `Logout failed: ${e?.message || e}`);
    }
  };

  const saveOfflineName = (newName) => {
    if (!activeProfile) return;
    updateProfile(activeProfile.id, { localName: newName, name: newName });
    setAccount(prev => ({ ...prev, name: newName, loggedIn: true, kind: 'local', session: createOfflineSession(newName) }));
    pushToast({ tone: 'success', title: t('accountModal.accountUpdatedTitle'), message: t('accountModal.accountUpdatedMessage', { name: newName }) });
  };

  return {
    account, authRefreshing, loginLoading,
    getLaunchSession, handleLogin, cancelLogin, handleLogout, saveOfflineName,
  };
}
