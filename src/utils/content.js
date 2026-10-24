// Pure helpers for installed content (mods, shaders, resource packs, data packs).

export const CONTENT_TABS = ['mods', 'shaders', 'resourcepacks', 'datapacks', 'explore'];

// Explore tab type ('mods' | 'shaders' | ...) -> Modrinth project type ('mod' | 'shader' | ...)
export function exploreTypeToProjectType(exploreType) {
  if (exploreType === 'shaders') return 'shader';
  if (exploreType === 'resourcepacks') return 'resourcepack';
  if (exploreType === 'datapacks') return 'datapack';
  return 'mod';
}

// Content tab -> folder type understood by api.content.openFolder / pickFiles
export function tabToContentType(activeTab) {
  if (activeTab === 'shaders' || activeTab === 'resourcepacks' || activeTab === 'datapacks') return activeTab;
  return 'mods';
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchesPack(item, slug, projId, cleanTitle) {
  const id = String(item.id || '').toLowerCase().trim();
  const name = String(item.name || '').toLowerCase().trim();
  const file = String(item.fileName || '').toLowerCase().trim();
  return Boolean((slug && (id === slug || file.startsWith(slug))) || (projId && id === projId) || (cleanTitle && name === cleanTitle));
}

// Is a Modrinth project already installed? `content` = { mods, shaders, resourcePacks, datapacks }
export function isProjectInstalled(project, content, exploreType) {
  if (!project) return false;
  const projectType = project.project_type || exploreTypeToProjectType(exploreType);
  const slug = String(project.slug || '').toLowerCase().trim();
  const projId = String(project.project_id || project.id || '').toLowerCase().trim();
  const cleanTitle = String(project.title || '').toLowerCase().trim();

  const packList = projectType === 'shader' ? content.shaders
    : projectType === 'resourcepack' ? content.resourcePacks
      : projectType === 'datapack' ? content.datapacks
        : null;
  if (packList) {
    return Array.isArray(packList) && packList.some(item => matchesPack(item, slug, projId, cleanTitle));
  }

  const mods = content.mods;
  if (!Array.isArray(mods) || mods.length === 0) return false;
  // Built once per call instead of once per mod; the slug is escaped so "c++" etc. cannot throw
  const slugPrefixRegex = slug ? new RegExp(`^${escapeRegExp(slug)}(?:[-_+v0-9.mc]|fabric|neoforge|forge)`, 'i') : null;

  return mods.some(m => {
    const mModId = String(m.modId || '').toLowerCase().trim();
    const mName = String(m.name || '').toLowerCase().trim();
    const mFile = String(m.fileName || m.id || '').toLowerCase().trim();

    // 1. Exact match by internal jar modId or project id
    if (mModId && (mModId === slug || mModId === projId)) return true;
    // 2. Exact match by mod title
    if (cleanTitle && mName === cleanTitle) return true;
    // 3. File name starts with the slug (excluding known add-ons that share the prefix)
    if (slug) {
      if (slug === 'sodium' && (mFile.includes('extra') || mFile.includes('reeses') || mFile.includes('options'))) return false;
      if (slug === 'iris' && mFile.includes('flawless')) return false;
      if (mFile === `${slug}.jar` || mFile === `${slug}.olpkg`) return true;
      if (slugPrefixRegex.test(mFile)) return true;
    }
    return false;
  });
}

// Builds the project object the detail view expects from an installed item
export function localItemToProject(item, projectType, modUpdates = {}) {
  if (projectType === 'mod') {
    const fileKey = item.fileName ? item.fileName.replace(/\.jar(\.disabled)?$/i, '').toLowerCase() : '';
    const updateInfo = modUpdates[item.fileName] || modUpdates[fileKey] || modUpdates[item.name] || modUpdates[item.id] || null;
    const knownProjectId = updateInfo?.projectId || item.projectId || item.modrinthId;
    const slugCandidate = knownProjectId || item.modId || (item.fileName ? item.fileName.replace(/\.jar(\.disabled)?$/i, '').replace(/[-_]v?\d+.*$/i, '') : '') || item.id;
    return {
      project_id: knownProjectId || slugCandidate,
      slug: knownProjectId || slugCandidate,
      modId: item.modId,
      title: item.name || item.fileName || item.id,
      name: item.name || item.fileName || item.id,
      author: item.authors || '',
      authors: item.authors || '',
      description: item.description || '',
      icon_url: item.iconUrl,
      project_type: 'mod',
      localItem: item,
    };
  }
  const slugCandidate = item.projectId || item.modrinthId || item.id || (item.fileName ? item.fileName.replace(/\.zip$/i, '') : '');
  return {
    project_id: slugCandidate,
    slug: slugCandidate,
    title: item.name || item.fileName,
    name: item.name || item.fileName,
    author: item.authors || '',
    authors: item.authors || '',
    description: item.description || '',
    icon_url: item.iconUrl,
    project_type: projectType,
    localItem: item,
  };
}
