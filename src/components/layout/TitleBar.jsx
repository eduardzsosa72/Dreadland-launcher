import { useI18n } from '../../context/I18nContext';
import { api } from '../../api';
import { ICONS } from '../../constants/icons';
import { Icon } from '../common/CommonComponents';
import dreadlandLogo from '../../assets/branding/dreadland-logo.jpg';

// Frameless window title bar with custom window controls (macOS keeps its native ones)
export function TitleBar({ appVersion }) {
  const { t } = useI18n();
  const showControls = !api.system.isMac && api.system.platform !== 'darwin';

  return (
    <div className="titlebar">
      <div className="titlebar-brand">
        <img className="titlebar-banner-logo" src={dreadlandLogo} alt={t('app.name')} draggable={false} />
        <span className="titlebar-version">{appVersion ? `v${appVersion}` : '1.0.0'}</span>
      </div>
      {showControls && (
        <div className="titlebar-controls">
          <button className="win-btn" onClick={() => api.system.minimizeWindow()} title={t('window.minimize')}>
            <Icon d={ICONS.minimize} size={11} />
          </button>
          <button className="win-btn" onClick={() => api.system.toggleMaximizeWindow()} title={t('window.maximize')}>
            <Icon d={ICONS.maximize} size={10} />
          </button>
          <button className="win-btn close" onClick={() => api.system.closeWindow()} title={t('window.close')}>
            <Icon d={ICONS.x} size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
