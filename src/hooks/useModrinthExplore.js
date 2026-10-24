import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { exploreTypeToProjectType } from '../utils/content';

const EMPTY_QUERIES = { mods: '', shaders: '', resourcepacks: '', datapacks: '' };
const EMPTY_CATEGORIES = { mods: 'all', shaders: 'all', resourcepacks: 'all', datapacks: 'all' };
const PAGE_SIZE = 60;

const projectTypeLabel = (projectType) => (
  projectType === 'shader' ? 'Shader' : projectType === 'resourcepack' ? 'Texture pack' : projectType === 'datapack' ? 'Data pack' : 'Mod'
);

// Explore tab: Modrinth search (with infinite scroll) and installing results into the active instance.
export function useModrinthExplore({
  exploreType, activeTab, isOnline, activeInstanceId, currentLoader, currentMcVer,
  refreshAfterInstall, startConsoleTask, addLog, pushToast, t,
}) {
  const [queries, setQueries] = useState(EMPTY_QUERIES);
  const [categories, setCategories] = useState(EMPTY_CATEGORIES);
  const [modrinthSort, setModrinthSort] = useState('relevance');
  const [modrinthLoaderFilter, setModrinthLoaderFilter] = useState('auto');
  const [modrinthVersionFilter, setModrinthVersionFilter] = useState('auto');
  const [modrinthResults, setModrinthResults] = useState([]);
  const [modrinthTotalHits, setModrinthTotalHits] = useState(0);
  const [modrinthLoading, setModrinthLoading] = useState(false);
  const [modrinthLoadingMore, setModrinthLoadingMore] = useState(false);
  const [modrinthInstalling, setModrinthInstalling] = useState({});
  const [installingVersionId, setInstallingVersionId] = useState(null);
  const modrinthSentinelRef = useRef(null);

  // Query and category are remembered per explore type
  const modrinthQuery = queries[exploreType] || '';
  const modrinthCategory = categories[exploreType] || 'all';
  const setModrinthQuery = (val) => setQueries(prev => ({
    ...prev,
    [exploreType]: typeof val === 'function' ? val(prev[exploreType] || '') : val,
  }));
  const setModrinthCategory = (val) => setCategories(prev => ({
    ...prev,
    [exploreType]: typeof val === 'function' ? val(prev[exploreType] || 'all') : val,
  }));

  const effectiveLoader = modrinthLoaderFilter === 'auto' ? currentLoader : (modrinthLoaderFilter === 'all' ? '' : modrinthLoaderFilter);
  const effectiveMcVer = modrinthVersionFilter === 'auto' ? currentMcVer : '';

  const executeModrinthSearch = useCallback(async (isLoadMore = false) => {
    if (!isOnline) {
      setModrinthLoading(false);
      setModrinthLoadingMore(false);
      return;
    }
    if (isLoadMore) {
      if (modrinthLoading || modrinthLoadingMore) return;
      setModrinthLoadingMore(true);
    } else {
      setModrinthLoading(true);
    }

    const currentOffset = isLoadMore ? modrinthResults.length : 0;
    const projectType = exploreTypeToProjectType(exploreType);

    try {
      const data = await api.modrinth.search({
        projectType,
        query: modrinthQuery,
        loader: projectType === 'mod' ? effectiveLoader : '',
        gameVersion: effectiveMcVer,
        category: modrinthCategory === 'all' ? '' : modrinthCategory,
        sortBy: modrinthSort,
        offset: currentOffset,
        limit: PAGE_SIZE,
      });
      if (data?.hits) {
        if (isLoadMore) {
          setModrinthResults(prev => {
            const existingIds = new Set(prev.map(p => p.project_id || p.slug));
            return [...prev, ...data.hits.filter(h => !existingIds.has(h.project_id || h.slug))];
          });
        } else {
          setModrinthResults(data.hits);
        }
        setModrinthTotalHits(data.total_hits || (isLoadMore ? modrinthResults.length + data.hits.length : data.hits.length));
      }
    } catch (e) {
      console.error('Modrinth search failed:', e);
      if (!isLoadMore) pushToast({ tone: 'error', title: 'Modrinth', message: e?.message || 'Failed to search.' });
    } finally {
      if (isLoadMore) setModrinthLoadingMore(false);
      else setModrinthLoading(false);
    }
  }, [isOnline, exploreType, modrinthQuery, effectiveLoader, effectiveMcVer, modrinthCategory, modrinthSort, modrinthLoading, modrinthLoadingMore, modrinthResults.length, pushToast]);

  // New explore type: clear the previous type's results right away
  useEffect(() => {
    setModrinthResults([]);
    setModrinthTotalHits(0);
    setModrinthLoading(true);
  }, [exploreType]);

  // Debounced search whenever the filters change while the tab is open
  const searchRef = useRef(executeModrinthSearch);
  useEffect(() => { searchRef.current = executeModrinthSearch; }, [executeModrinthSearch]);
  useEffect(() => {
    if (activeTab !== 'explore') return undefined;
    if (!isOnline) {
      setModrinthLoading(false);
      return undefined;
    }
    setModrinthLoading(true);
    const timer = setTimeout(() => searchRef.current(false), 300);
    return () => clearTimeout(timer);
  }, [activeTab, exploreType, isOnline, modrinthQuery, effectiveLoader, effectiveMcVer, modrinthCategory, modrinthSort]);

  // Infinite scroll: load the next page when the sentinel comes into view
  const hasMoreModrinth = modrinthResults.length < modrinthTotalHits;
  useEffect(() => {
    if (activeTab !== 'explore') return undefined;
    if (!isOnline || !hasMoreModrinth || modrinthLoading || modrinthLoadingMore) return undefined;
    const sentinel = modrinthSentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) executeModrinthSearch(true);
    }, { rootMargin: '250px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, isOnline, hasMoreModrinth, modrinthLoading, modrinthLoadingMore, executeModrinthSearch]);

  const ensureOnline = () => {
    if (isOnline) return true;
    pushToast({ tone: 'error', title: 'Modrinth', message: t('offline.noConnectionToast') });
    return false;
  };

  const handleInstallModrinthMod = async (project) => {
    if (!ensureOnline()) return;
    const projectId = project.project_id || project.slug;
    const projectType = project.project_type || exploreTypeToProjectType(exploreType);
    const name = project.title || projectId;
    setModrinthInstalling(prev => ({ ...prev, [projectId]: true }));
    startConsoleTask();
    addLog('info', `Installing ${projectType} '${name}' from Modrinth...`);

    try {
      const res = await api.modrinth.install({
        projectId,
        projectType,
        gameVersion: effectiveMcVer || currentMcVer,
        loader: projectType === 'mod' ? (effectiveLoader || currentLoader) : undefined,
        instanceId: activeInstanceId,
      });
      if (!res?.ok) throw new Error(res?.message || res?.error || 'Installation failed');
      refreshAfterInstall(projectType, res);
      addLog('success', `${projectTypeLabel(projectType)} '${name}' installed.`);
      pushToast({ tone: 'success', title: t('mods.install'), message: t('mods.installedSuccess', { name }) });
    } catch (err) {
      addLog('error', `Failed to install '${name}': ${err?.message || err}`);
      pushToast({ tone: 'error', title: t('mods.install'), message: t('mods.installError', { name, error: err?.message || '' }) });
    } finally {
      setModrinthInstalling(prev => ({ ...prev, [projectId]: false }));
    }
  };

  const handleInstallSpecificVersion = async (project, version) => {
    if (!ensureOnline()) return;
    const projectId = project.project_id || project.slug || project.id;
    const projectType = project.project_type || exploreTypeToProjectType(exploreType);
    const primaryFile = version.files?.find(f => f.primary) || version.files?.[0];
    const verNumber = version.version_number || version.name || '';
    const name = project.title || projectId;
    setInstallingVersionId(version.id);
    startConsoleTask();
    addLog('info', `[Modrinth] Installing ${name} (v${verNumber})...`);

    try {
      const res = await api.modrinth.install({
        projectId,
        projectType,
        versionId: version.id,
        fileUrl: primaryFile?.url,
        fileName: primaryFile?.filename,
        gameVersion: version.game_versions?.[0] || effectiveMcVer || currentMcVer,
        loader: projectType === 'mod' ? (version.loaders?.[0] || effectiveLoader || currentLoader) : undefined,
        instanceId: activeInstanceId,
      });
      if (!res?.ok) throw new Error(res?.message || res?.error || 'Installation failed');
      refreshAfterInstall(projectType, res);
      addLog('success', `[Modrinth] '${name}' (v${verNumber}) installed.`);
      pushToast({ tone: 'success', title: t('mods.install'), message: t('mods.installedSuccess', { name: `${name} v${verNumber}` }) });
    } catch (err) {
      addLog('error', `[Modrinth] Failed to install version: ${err?.message || err}`);
      pushToast({ tone: 'error', title: t('mods.install'), message: t('mods.installError', { name, error: err?.message || '' }) });
    } finally {
      setInstallingVersionId(null);
    }
  };

  return {
    modrinthQuery, setModrinthQuery, modrinthCategory, setModrinthCategory,
    modrinthSort, setModrinthSort,
    modrinthLoaderFilter, setModrinthLoaderFilter, modrinthVersionFilter, setModrinthVersionFilter,
    effectiveLoader, effectiveMcVer,
    modrinthResults, modrinthLoading, modrinthLoadingMore, modrinthSentinelRef,
    modrinthInstalling, installingVersionId,
    handleInstallModrinthMod, handleInstallSpecificVersion,
  };
}
