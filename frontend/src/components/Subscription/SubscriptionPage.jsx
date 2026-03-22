import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './SubscriptionPage.css';

function useBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev || ''; };
  }, []);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(date) {
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function daysLeft(endDate) {
  return Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
}

const FEATURES = [
  'Live Option Chain (Real-time data)',
  'Historical Data Analysis',
  'Power AI Stock Signals',
  'OI Charts & Spot Charts',
  'MCTR & Strategy 4.0 Levels',
  'Shifting Levels Detection',
  'LTP Calculator',
  'Trading Journal',
];

export default function SubscriptionPage() {
  useBodyScroll();
  const { state } = useApp();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    fetch('/api/auth/profile', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setProfile(d.profile); })
      .catch(() => {});
  }, []);

  const createdAt = profile?.createdAt || null;
  const trialEnd  = createdAt ? addDays(createdAt, 90) : null;
  const remaining = trialEnd ? daysLeft(trialEnd) : null;
  const isExpired  = remaining !== null && remaining < 0;
  const isExpiring = remaining !== null && remaining >= 0 && remaining <= 10;

  const usedDays = remaining !== null ? Math.min(90, Math.max(0, 90 - remaining)) : 0;
  const pct = Math.round((usedDays / 90) * 100);

  return (
    <div className="sub-page">

      {/* ── Header ── */}
      <div className="sub-header">
        <span className="sub-header-icon">💎</span>
        <div>
          <div className="sub-header-title">Subscription</div>
          <div className="sub-header-sub">Your account plan &amp; billing</div>
        </div>
        <div className="sub-header-user">{state.user?.name || ''}</div>
      </div>

      <div className="sub-body">

        {/* ── Trial Status Card ── */}
        <div className={`sub-card sub-status-card ${isExpired ? 'expired' : isExpiring ? 'expiring' : 'active'}`}>
          <div className="sub-plan-top">
            <div className="sub-plan-name">Free Trial</div>
            <span className={`sub-plan-badge ${isExpired ? 'red' : 'green'}`}>
              {isExpired ? '⛔ Expired' : '● Active'}
            </span>
          </div>

          <div className="sub-dates">
            <div className="sub-date-item">
              <div className="sub-date-label">Registration Date</div>
              <div className="sub-date-val">{profile ? fmt(createdAt) : '—'}</div>
            </div>
            <div className="sub-date-arrow">▶</div>
            <div className="sub-date-item">
              <div className="sub-date-label">Trial End Date</div>
              <div className={`sub-date-val ${isExpired ? 'red' : isExpiring ? 'orange' : ''}`}>
                {trialEnd ? fmt(trialEnd) : '—'}
              </div>
            </div>
            <div className="sub-date-arrow">▶</div>
            <div className="sub-date-item">
              <div className="sub-date-label">Duration</div>
              <div className="sub-date-val">90 Days</div>
            </div>
          </div>

          {remaining !== null && (
            <div className={`sub-remaining ${isExpired ? 'red' : isExpiring ? 'orange' : 'green'}`}>
              {isExpired
                ? `Trial expired ${Math.abs(remaining)} day${Math.abs(remaining) !== 1 ? 's' : ''} ago`
                : remaining === 0
                  ? 'Trial expires today!'
                  : `${remaining} day${remaining !== 1 ? 's' : ''} remaining`
              }
            </div>
          )}

          {profile && (
            <div className="sub-progress-wrap">
              <div className="sub-progress-track">
                <div
                  className="sub-progress-bar"
                  style={{
                    width: `${pct}%`,
                    background: isExpired ? '#c62828' : isExpiring ? '#ff6f00' : '#2e7d32',
                  }}
                />
              </div>
              <div className="sub-progress-labels">
                <span>{fmt(createdAt)}</span>
                <span>{fmt(trialEnd)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Features ── */}
        <div className="sub-card">
          <div className="sub-card-title">What's Included in Trial</div>
          <div className="sub-features">
            {FEATURES.map((f, i) => (
              <div key={i} className="sub-feature-item">
                <span className="sub-check">✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Upgrade ── */}
        <div className="sub-card sub-upgrade-card">
          <div className="sub-card-title">Upgrade to Premium</div>
          <div className="sub-upgrade-text">
            Contact us to continue uninterrupted access after your trial ends. We'll activate your account manually.
          </div>
          <div className="sub-upgrade-actions">
            <a className="sub-btn sub-btn-primary" href="mailto:simplifyoptionchain@gmail.com">
              📧 Email Us
            </a>
            <a className="sub-btn sub-btn-outline" href="https://t.me/soc.ai.in" target="_blank" rel="noreferrer">
              ✈️ Telegram
            </a>
            <a className="sub-btn sub-btn-outline" href="https://instagram.com/soc.ai.in" target="_blank" rel="noreferrer">
              📸 Instagram
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
