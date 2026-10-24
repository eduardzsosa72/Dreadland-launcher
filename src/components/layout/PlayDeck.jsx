import { useI18n } from '../../context/I18nContext';
import { ICONS } from '../../constants/icons';
import { Icon } from '../common/CommonComponents';
import { formatVersionLabel } from '../../lib/minecraftLauncher';

const LOADERS = [
  ['fabric', 'Fabric'],
  ['neoforge', 'NeoForge'],
  ['forge', 'Forge'],
  ['quilt', 'Quilt'],
];

function loaderBadge(loaderType) {
  const found = LOADERS.find(([key]) => loaderType.includes(key));
  return found ? { className: found[0], label: found[1] } : { className: 'vanilla', label: 'Vanilla' };
}

// Bottom dock: version selector and the Play / Stop button
export function PlayDeck({
  installedVersions, selectedVersionId, onSelectVersion, loaderType,
  gameState, authRefreshing, progress, installId, onCancelInstall, onPlay,
}) {
  const { t } = useI18n();
  const badge = loaderBadge(String(loaderType || '').toLowerCase());
  const busy = gameState === 'loading' || authRefreshing;

  return (
    <div className="play-deck">
      <div className="play-deck-controls">
        <div className="version-capsule">
          <select
            className="version-select"
            value={selectedVersionId}
            onChange={e => { if (gameState !== 'running') onSelectVersion(e.target.value); }}
            disabled={gameState === 'running'}
          >
            {installedVersions.length > 0 ? (
              installedVersions.map(v => (
                <option key={v.id} value={v.id}>{formatVersionLabel(v)}</option>
              ))
            ) : (
              <option value="">{t('profile.noVersionsInstalled')}</option>
            )}
          </select>
          <span className={`loader-badge ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {installId && (
          <button className="btn-secondary" onClick={onCancelInstall}>
            {t('game.cancelInstall')}
          </button>
        )}
        <button
          className={`hero-play-btn ${busy ? 'loading' : gameState === 'running' ? 'running' : ''}`}
          onClick={onPlay}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinning"><Icon d={ICONS.spinner} size={16} /></span>
              <span>{authRefreshing ? t('game.authenticating') : t('game.loading')}</span>
            </>
          ) : gameState === 'running' ? (
            <>
              <Icon d={ICONS.stop} size={16} />
              <span>{t('game.stop')}</span>
            </>
          ) : (
            <>
              <Icon d={ICONS.play} size={16} />
              <span>{t('game.play')}</span>
            </>
          )}
          {gameState === 'loading' && (
            <div className="progress-capsule">
              <div className="progress-capsule-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
