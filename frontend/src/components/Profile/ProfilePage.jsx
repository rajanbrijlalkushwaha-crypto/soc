import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import './ProfilePage.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

// Unlock body scroll while this full-page component is mounted
function useBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev || ''; };
  }, []);
}

// ── Subscription helpers ──
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}
function fmtDate(date) {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysLeft(endDate) {
  return Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
}
const FEATURES = [
  'Live Option Chain', 'Historical Data', 'Power AI Stock',
  'OI & Spot Charts', 'MCTR & Strategy 4.0', 'Shifting Levels',
  'LTP Calculator', 'Trading Journal',
];

const UI_TOGGLES = [
  { label: 'Greeks',         key: 'greeksActive',        action: 'TOGGLE_GREEKS' },
  { label: 'ATM Highlight',  key: 'atmActive',           action: 'TOGGLE_ATM' },
  { label: 'Indicators',     key: 'indicatorsActive',    action: 'TOGGLE_INDICATORS' },
  { label: 'LTP Display',    key: 'ltpDisplayActive',    action: 'TOGGLE_LTP_DISPLAY' },
  { label: 'Volume',         key: 'volumeDisplayActive', action: 'TOGGLE_VOLUME' },
  { label: 'OI Display',     key: 'oiDisplayActive',     action: 'TOGGLE_OI' },
  { label: 'MMI Display',    key: 'mmiDisplayActive',    action: 'TOGGLE_MMI' },
  { label: 'Reverse Table',  key: 'tableReversed',       action: 'TOGGLE_REVERSE' },
  { label: 'LTP Calculator', key: 'ltpCalcActive',       action: 'TOGGLE_LTP_CALC' },
  { label: 'Show in Lakh',   key: 'showInLakh',          action: 'TOGGLE_SHOW_IN_LAKH' },
];

const THEMES = [
  { value: 'white', label: 'Light' },
  { value: 'blue',  label: 'Blue'  },
  { value: 'black', label: 'Dark'  },
];

export default function ProfilePage() {
  useBodyScroll();
  const { state, dispatch } = useApp();
  const fileInputRef = useRef(null);

  const [profile, setProfile]     = useState(null);
  const [photoUrl, setPhotoUrl]   = useState(null);
  const [uploading, setUploading] = useState(false);
  const [photoMsg, setPhotoMsg]   = useState('');

  const [pwForm, setPwForm]       = useState({ current: '', newPw: '', confirm: '' });
  const [pwMsg, setPwMsg]         = useState('');
  const [pwError, setPwError]     = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const [uiMsg, setUiMsg]         = useState('');

  // Load full profile on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/auth/profile`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setProfile(d.profile);
          if (d.profile.hasPhoto) {
            setPhotoUrl(`${API_BASE}/api/auth/photo/${d.profile.userId}?t=${Date.now()}`);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handlePhotoClick = () => fileInputRef.current?.click();

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPhotoMsg('');
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const r = await fetch(`${API_BASE}/api/auth/upload-photo`, { method: 'POST', credentials: 'include', body: fd });
      const d = await r.json();
      if (d.success) {
        const userId = profile?.userId || state.user?.id;
        setPhotoUrl(`${API_BASE}/api/auth/photo/${userId}?t=${Date.now()}`);
        setPhotoMsg('Photo updated!');
      } else {
        setPhotoMsg(d.error || 'Upload failed');
      }
    } catch {
      setPhotoMsg('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwMsg(''); setPwError('');
    if (pwForm.newPw !== pwForm.confirm) { setPwError('New passwords do not match'); return; }
    if (pwForm.newPw.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    setPwLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw }),
      });
      const d = await r.json();
      if (d.success) {
        setPwMsg('Password changed successfully!');
        setPwForm({ current: '', newPw: '', confirm: '' });
      } else {
        setPwError(d.error || 'Failed to change password');
      }
    } catch {
      setPwError('Network error. Please try again.');
    } finally {
      setPwLoading(false);
    }
  };

  const handleSaveUI = async () => {
    setUiMsg('');
    const settings = { theme: state.theme };
    UI_TOGGLES.forEach(({ key }) => { settings[key] = state[key]; });
    try {
      const r = await fetch(`${API_BASE}/api/auth/ui-settings`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const d = await r.json();
      setUiMsg(d.success ? 'Settings saved!' : (d.error || 'Save failed'));
      setTimeout(() => setUiMsg(''), 3000);
    } catch {
      setUiMsg('Network error');
    }
  };

  // Use state.user as fallback while profile loads
  const displayName  = profile?.name      || state.user?.name  || '';
  const displayEmail = profile?.email     || state.user?.email || '';
  const initials     = displayName ? displayName.trim()[0].toUpperCase() : '?';

  // ── Subscription computed values ──
  const createdAt  = profile?.createdAt || null;
  const trialEnd   = createdAt ? addDays(createdAt, 90) : null;
  const remaining  = trialEnd ? daysLeft(trialEnd) : null;
  const isExpired  = remaining !== null && remaining < 0;
  const isExpiring = remaining !== null && remaining >= 0 && remaining <= 10;
  const usedDays   = remaining !== null ? Math.min(90, Math.max(0, 90 - remaining)) : 0;
  const pct        = Math.round((usedDays / 90) * 100);
  const trialColor = isExpired ? '#c62828' : isExpiring ? '#ff6f00' : '#2e7d32';

  return (
    <div className="profile-page">

      {/* ── Header ── */}
      <div className="profile-header">
        <div className="profile-header-avatar">
          {photoUrl
            ? <img src={photoUrl} alt="" className="profile-header-avatar-img" />
            : <span>{initials}</span>
          }
        </div>
        <div className="profile-header-info">
          <div className="profile-header-name">{displayName || 'My Profile'}</div>
          <div className="profile-header-email">{displayEmail}</div>
        </div>
      </div>

      <div className="profile-body">

        {/* ── 1. Account Details ── */}
        <div className="profile-card">
          <div className="profile-card-title">Account Details</div>
          <div className="profile-user-row">
            <div className="profile-photo-wrap">
              <div className="profile-photo" onClick={handlePhotoClick} title="Click to change photo">
                {photoUrl
                  ? <img src={photoUrl} alt="Profile" className="profile-photo-img" />
                  : <div className="profile-photo-placeholder">{initials}</div>
                }
                <div className="profile-photo-overlay">Change</div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handlePhotoChange} />
              {uploading && <div className="profile-photo-msg">Uploading...</div>}
              {!uploading && photoMsg && <div className="profile-photo-msg">{photoMsg}</div>}
            </div>
            <div className="profile-details">
              {profile ? (
                <table className="profile-detail-table">
                  <tbody>
                    <tr><td className="label">Name</td><td>{profile.name || '—'}</td></tr>
                    <tr><td className="label">Email</td><td>{profile.email}</td></tr>
                    <tr><td className="label">Mobile</td><td>{profile.mobile || '—'}</td></tr>
                    <tr><td className="label">City</td><td>{profile.city || '—'}</td></tr>
                    <tr>
                      <td className="label">Status</td>
                      <td>{profile.verified ? <span className="profile-badge verified">Verified</span> : <span className="profile-badge unverified">Not Verified</span>}</td>
                    </tr>
                    <tr><td className="label">Member Since</td><td>{profile.createdAt ? fmtDate(profile.createdAt) : '—'}</td></tr>
                    <tr><td className="label">Last Login</td><td>{profile.lastLogin ? fmtDate(profile.lastLogin) : '—'}</td></tr>
                  </tbody>
                </table>
              ) : (
                <div className="profile-loading">Loading account details...</div>
              )}
            </div>
          </div>
        </div>

        {/* ── 2. Subscription ── */}
        <div className="profile-card">
          <div className="profile-card-title">Subscription</div>
          <div className="profile-sub-plan-row">
            <span className="profile-sub-plan-name">Free Trial</span>
            <span className="profile-sub-badge" style={{ color: trialColor, background: isExpired ? '#ffebee' : '#e8f5e9' }}>
              {isExpired ? '⛔ Expired' : '● Active'}
            </span>
          </div>
          <div className="profile-sub-info-row">
            <span className="profile-sub-info-label">Start Date</span>
            <span className="profile-sub-info-val">{createdAt ? fmtDate(createdAt) : '—'}</span>
          </div>
          <div className="profile-sub-info-row">
            <span className="profile-sub-info-label">End Date</span>
            <span className="profile-sub-info-val" style={{ color: isExpired ? '#c62828' : isExpiring ? '#ff6f00' : '#222' }}>
              {trialEnd ? fmtDate(trialEnd) : '—'}
            </span>
          </div>
          <div className="profile-sub-info-row">
            <span className="profile-sub-info-label">Duration</span>
            <span className="profile-sub-info-val">90 Days</span>
          </div>
          {remaining !== null && (
            <div className="profile-sub-remaining" style={{ color: trialColor }}>
              {isExpired ? `Trial expired ${Math.abs(remaining)} day${Math.abs(remaining) !== 1 ? 's' : ''} ago` : remaining === 0 ? 'Trial expires today!' : `${remaining} day${remaining !== 1 ? 's' : ''} remaining`}
            </div>
          )}
          {profile && (
            <div className="profile-sub-track">
              <div className="profile-sub-bar" style={{ width: `${pct}%`, background: trialColor }} />
            </div>
          )}
          <div className="profile-sub-features">
            {FEATURES.map((f, i) => (
              <div key={i} className="profile-sub-feat">
                <span className="profile-sub-check">✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
          <div className="profile-sub-upgrade">
            <div className="profile-sub-upgrade-text">Contact us to upgrade after trial ends.</div>
            <div className="profile-sub-upgrade-btns">
              <a className="profile-sub-btn primary" href="mailto:simplifyoptionchain@gmail.com">📧 Email</a>
              <a className="profile-sub-btn outline" href="https://t.me/soc.ai.in" target="_blank" rel="noreferrer">✈️ Telegram</a>
            </div>
          </div>
        </div>

        {/* ── Change Password ── */}
        <div className="profile-card">
          <div className="profile-card-title">Change Password</div>
          <form className="profile-pw-form" onSubmit={handleChangePassword}>
            <div className="profile-field">
              <label>Current Password</label>
              <input
                type="password"
                value={pwForm.current}
                onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                placeholder="Enter current password"
                required
              />
            </div>
            <div className="profile-field">
              <label>New Password</label>
              <input
                type="password"
                value={pwForm.newPw}
                onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}
                placeholder="Minimum 6 characters"
                required
              />
            </div>
            <div className="profile-field">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="Repeat new password"
                required
              />
            </div>
            {pwError && <div className="profile-msg error">{pwError}</div>}
            {pwMsg   && <div className="profile-msg success">{pwMsg}</div>}
            <button type="submit" className="profile-btn" disabled={pwLoading}>
              {pwLoading ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* ── UI / Display Settings ── */}
        <div className="profile-card">
          <div className="profile-card-title">Display Settings</div>

          <div className="profile-ui-section">
            <div className="profile-ui-label">Theme</div>
            <div className="profile-theme-row">
              {THEMES.map(t => (
                <button
                  key={t.value}
                  className={`profile-theme-btn${state.theme === t.value ? ' active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_THEME', payload: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="profile-ui-section">
            <div className="profile-ui-label">Column Toggles</div>
            <div className="profile-toggles-grid">
              {UI_TOGGLES.map(({ label, key, action }) => (
                <div key={action} className="profile-toggle-row">
                  <span>{label}</span>
                  <button
                    className={`profile-toggle${state[key] ? ' on' : ''}`}
                    onClick={() => dispatch({ type: action })}
                    type="button"
                  >
                    <span className="profile-toggle-thumb" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="profile-save-row">
            <button className="profile-btn" onClick={handleSaveUI} type="button">
              Save Settings
            </button>
            {uiMsg && <span className={`profile-msg ${uiMsg.includes('saved') ? 'success' : 'error'}`}>{uiMsg}</span>}
          </div>
        </div>

      </div>
    </div>
  );
}
