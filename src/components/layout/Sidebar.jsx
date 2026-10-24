import { useI18n } from '../../context/I18nContext';
import { ICONS } from '../../constants/icons';
import { Icon, MicrosoftLogo } from '../common/CommonComponents';
import { ProfileCardActions } from '../cards/Cards';
import { getVersionById, resolveMinecraftVersion } from '../../lib/minecraftLauncher';
import { getMcHeadsAvatarUrl } from '../../utils/formatters';

function avatarNameFor(profile) {
  return profile.skinName || profile.microsoftAccount || (profile.localName && profile.localName !== 'Player' ? profile.localName : '') || 'MHF_Steve';
}

function Avatar({ name, className }) {
  return (
    <div className={className}>
      <img
        key={`${className}-${name}`}
        src={getMcHeadsAvatarUrl(name, 64)}
        alt={name}
        onLoad={(e) => { e.currentTarget.style.display = 'block'; }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    </div>
  );
}

function NavItem({ active, icon, label, counter, children, onClick }) {
  return (
    <div className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="nav-icon"><Icon d={icon} size={14} /></span>
      <span>{label}</span>
      {counter !== undefined && <span className="nav-counter">{counter}</span>}
      {children}
    </div>
  );
}

// Left sidebar: profiles, navigation and the account card
export function Sidebar({
  profiles, activeProfileId, installedVersions, versionCatalog,
  account, authRefreshing, gameState,
  onSelectProfile, onEditProfile, onDuplicateProfile, onDeleteProfile, onNewProfile,
  activeTab, detailOpen, onNavigate, counters, settingsOpen, onOpenSettings,
  profileAvatarName, onOpenAccount, onLogin, onLogout,
}) {
  const { t } = useI18n();
  const locked = authRefreshing || gameState === 'running';
  const isTab = (tab) => activeTab === tab && !detailOpen;

  const discover = [
    { tab: 'news', icon: ICONS.news, label: t('sidebar.news') },
    { tab: 'explore', icon: ICONS.compass, label: t('sidebar.explore') },
  ];
  const library = [
    { tab: 'instances', icon: ICONS.layers, label: t('sidebar.instances') || 'Instances', counter: counters.instances },
    { tab: 'mods', icon: ICONS.cube, label: t('sidebar.mods'), counter: counters.enabledMods },
    { tab: 'shaders', icon: ICONS.sun, label: t('sidebar.shaders'), counter: counters.shaders },
    { tab: 'resourcepacks', icon: ICONS.layers, label: t('sidebar.resourcePacks'), counter: counters.resourcePacks },
    { tab: 'datapacks', icon: ICONS.datapack, label: t('sidebar.datapacks'), counter: counters.datapacks },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="sidebar-heading">
          <span className="sidebar-title">{t('sidebar.profiles')}</span>
        </div>

        <div className="profile-list">
          {profiles.map(p => {
            const installedProfileVersion = p.version
              ? installedVersions.find(v => v.id === p.version) || getVersionById(p.version, versionCatalog)
              : null;
            const profileVersionLabel = resolveMinecraftVersion(installedProfileVersion?.inheritsFrom || installedProfileVersion?.mcVer || p.version) || 'Auto';
            const isSelected = p.id === activeProfileId;
            const avatarName = (account.loggedIn && account.profileKey === p.id && account.name) ? account.name : avatarNameFor(p);

            return (
              <div
                key={p.id}
                className={`profile-card ${isSelected ? 'active' : ''}`}
                onClick={() => { if (!locked) onSelectProfile(p.id); }}
              >
                <Avatar name={avatarName} className="profile-avatar" />
                <div className="profile-info">
                  <div className="profile-name-row">
                    <span className="profile-name">{p.name}</span>
                    <ProfileCardActions
                      active={isSelected}
                      name={p.name}
                      disabled={locked}
                      onEdit={(e) => { e.stopPropagation(); onEditProfile(p.id); }}
                      onDuplicate={(e) => onDuplicateProfile(p.id, e)}
                      onDelete={(e) => { e.stopPropagation(); onDeleteProfile(p.id); }}
                    />
                  </div>
                  <div className="profile-badges-row">
                    <span className="profile-chip version">{profileVersionLabel}</span>
                    <span className="profile-chip">{p.ram || 4} GB</span>
                  </div>
                </div>
              </div>
            );
          })}

          <button className="add-profile-btn" onClick={onNewProfile} disabled={locked}>
            <Icon d={ICONS.plus} size={13} />
            <span>{t('sidebar.newProfile')}</span>
          </button>
        </div>

        <div className="sidebar-heading" style={{ marginTop: 10 }}>
          <span className="sidebar-title">{t('sidebar.discover')}</span>
        </div>
        <div className="sidebar-nav">
          {discover.map(item => (
            <NavItem key={item.tab} active={isTab(item.tab)} icon={item.icon} label={item.label} onClick={() => onNavigate(item.tab)} />
          ))}
        </div>

        <div className="sidebar-heading" style={{ marginTop: 12 }}>
          <span className="sidebar-title">{t('sidebar.library')}</span>
        </div>
        <div className="sidebar-nav">
          {library.map(item => (
            <NavItem key={item.tab} active={isTab(item.tab)} icon={item.icon} label={item.label} counter={item.counter} onClick={() => onNavigate(item.tab)} />
          ))}
        </div>

        <div className="sidebar-heading" style={{ marginTop: 12 }}>
          <span className="sidebar-title">{t('sidebar.system')}</span>
        </div>
        <div className="sidebar-nav">
          <NavItem active={isTab('console')} icon={ICONS.console} label={t('sidebar.console')} onClick={() => onNavigate('console')}>
            {gameState === 'running' && <span className="status-dot in-game" style={{ marginLeft: 'auto' }} />}
          </NavItem>
          <NavItem active={settingsOpen} icon={ICONS.settings} label={t('sidebar.settings')} onClick={onOpenSettings} />
        </div>
      </div>

      <div className="sidebar-account">
        <div className="account-card" style={{ cursor: 'pointer' }} onClick={onOpenAccount} title={t('accountModal.manageTitle')}>
          <Avatar name={profileAvatarName} className="account-avatar" />
          <div className="account-info">
            <span className="account-name">{account.name || t('account.loggedOut')}</span>
            <span className="account-status-label">
              <span className={`status-dot ${gameState === 'running' ? 'in-game' : account.loggedIn ? 'online' : ''}`} />
              <span>
                {authRefreshing ? t('account.refreshingAuth')
                  : gameState === 'running' ? t('account.inGame')
                    : account.kind === 'microsoft' ? t('account.microsoftBadge')
                      : account.loggedIn ? t('account.offline')
                        : t('account.guest')}
              </span>
            </span>
          </div>
          {account.kind === 'microsoft' ? (
            <button className="account-auth-btn logout" onClick={(e) => { e.stopPropagation(); onLogout(); }} title={t('account.logout')}>
              <Icon d={ICONS.logout} size={12} />
            </button>
          ) : (
            <button className="account-auth-btn" onClick={(e) => { e.stopPropagation(); onLogin(); }} title={t('account.loginWithMicrosoft')}>
              <MicrosoftLogo />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
