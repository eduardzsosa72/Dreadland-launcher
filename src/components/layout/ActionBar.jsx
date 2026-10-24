import { Fragment } from 'react';
import { useI18n } from '../../context/I18nContext';
import { ICONS } from '../../constants/icons';
import { Icon } from '../common/CommonComponents';
import { getInstanceIconSrc } from '../../constants/instanceIcons';

function TabButton({ tab, activeTab, icon, label, onSelect }) {
  return (
    <button className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => onSelect(tab)}>
      <Icon d={icon} size={13} />
      <span>{label}</span>
    </button>
  );
}

// Top toolbar: tab buttons, active instance badge and quick actions
export function ActionBar({ activeTab, onSelectTab, activeInstance, isOnline, gameState, onOpenInstall, onOpenMinecraftDirectory, onOpenSettings }) {
  const { t } = useI18n();
  const groups = [
    [
      { tab: 'news', icon: ICONS.news, label: t('sidebar.news') },
      { tab: 'explore', icon: ICONS.compass, label: t('sidebar.explore') },
    ],
    [
      { tab: 'instances', icon: ICONS.layers, label: t('sidebar.instances') || 'Instances' },
      { tab: 'mods', icon: ICONS.cube, label: t('sidebar.mods') },
      { tab: 'shaders', icon: ICONS.sun, label: t('sidebar.shaders') },
      { tab: 'resourcepacks', icon: ICONS.layers, label: t('sidebar.resourcePacks') },
      { tab: 'datapacks', icon: ICONS.datapack, label: t('sidebar.datapacks') },
    ],
    [
      { tab: 'console', icon: ICONS.console, label: t('sidebar.console') },
    ],
  ];

  return (
    <div className="action-bar">
      <div className="action-bar-tabs">
        {groups.map((group, index) => (
          <Fragment key={group[0].tab}>
            {index > 0 && <div className="tab-group-divider" />}
            <div className="tab-group">
              {group.map(item => (
                <TabButton key={item.tab} {...item} activeTab={activeTab} onSelect={onSelectTab} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>

      <div className="action-bar-actions">
        <div
          className={`environment-badge ${activeInstance ? 'is-instance' : 'is-global'}`}
          onClick={() => onSelectTab('instances')}
          title={activeInstance ? t('instances.managingInstance', { name: activeInstance.name }) : t('instances.managingGlobal')}
        >
          {activeInstance ? (
            <>
              <img src={getInstanceIconSrc(activeInstance.icon)} alt={activeInstance.name} className="env-icon" />
              <span className="env-name">{activeInstance.name}</span>
            </>
          ) : (
            <>
              <Icon d={ICONS.folder} size={13} className="env-icon-svg" />
              <span className="env-name">{t('instances.globalInstallation')}</span>
            </>
          )}
        </div>

        {!isOnline && (
          <div className="offline-pill" title={t('offline.newsDesc')}>
            <Icon d={ICONS.wifiOff} size={12} />
            <span>{t('offline.badge')}</span>
          </div>
        )}
        <button
          className="btn-primary"
          onClick={onOpenInstall}
          disabled={gameState === 'running'}
          title={t('install.installVersion')}
          style={{ gap: 6, padding: '7px 14px' }}
        >
          <Icon d={ICONS.download} size={13} />
          <span>{t('install.installVersion')}</span>
        </button>
        <button className="btn-secondary" onClick={onOpenMinecraftDirectory} title={t('settings.openMinecraftDirectory')}>
          <Icon d={ICONS.folder} size={12} />
        </button>
        <button className="btn-secondary" onClick={onOpenSettings} title={t('settings.title')}>
          <Icon d={ICONS.settings} size={12} />
        </button>
      </div>
    </div>
  );
}

// Progress strip while the launcher downloads/installs its own update
export function UpdateBanner({ updateState }) {
  const { t } = useI18n();
  if (!['downloading', 'verifying', 'launching', 'complete'].includes(updateState.phase)) return null;
  const progress = Math.max(0, Math.min(100, updateState.progress || 0));
  return (
    <div className="update-banner">
      <div className="update-banner-header">
        <span className="update-banner-title">{t('update.launcherUpdate')} — {updateState.latestVersion || ''}</span>
        <span style={{ fontSize: 11, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>
          {updateState.phase === 'downloading' ? `${updateState.progress || 0}%` : updateState.phase}
        </span>
      </div>
      <div className="update-banner-progress">
        <div className="update-banner-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
