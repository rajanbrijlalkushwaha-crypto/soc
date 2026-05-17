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

const API_BASE = process.env.REACT_APP_API_URL || '';
const RZP_KEY  = process.env.REACT_APP_RAZORPAY_KEY_ID || '';

function loadRazorpay() {
  return new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function fmtPrice(paise) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function daysLeft(endDate) {
  return Math.max(0, Math.ceil((new Date(endDate) - Date.now()) / 86400000));
}

function totalDays(startDate, endDate) {
  return Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000));
}

function progressPct(startDate, endDate) {
  const total = totalDays(startDate, endDate);
  const left  = daysLeft(endDate);
  return Math.round((left / total) * 100);
}

const DEFAULT_FEATURES = [
  'Live Option Chain (Real-time NSE/BSE)',
  'Historical Data Analysis',
  'Power AI Stock Signals',
  'OI Charts & Spot Price Charts',
  'MCTR & Strategy 4.0 S/R Levels',
  'Shifting Levels Detection',
  'LTP Calculator',
  'Trading Journal',
];

const CATEGORIES = ['Regular', 'Advance', 'Courses'];
const CAT_LABELS = { Regular: 'Regular Plans', Advance: 'Advance Plans', Courses: 'Courses' };

function PlanCard({ plan, isSelected, onSelect }) {
  const perDay      = Math.round(plan.price / plan.durationDays);
  const commPerDay  = plan.communityPrice ? Math.round(plan.communityPrice / plan.durationDays) : null;
  const savings     = plan.communityPrice ? (plan.price - plan.communityPrice) : null;
  const features    = plan.features?.length > 0 ? plan.features : DEFAULT_FEATURES;

  return (
    <div
      className={`sp-plan-card${isSelected ? ' selected' : ''}${plan.badge ? ' has-badge' : ''}`}
      onClick={() => onSelect(plan._id)}
    >
      {plan.badge && <div className="sp-plan-badge">{plan.badge}</div>}

      <div className="sp-plan-name">{plan.name}</div>
      <div className="sp-plan-subtitle">
        Starting from {fmtPrice(perDay)}/day · {plan.durationDays} days
        {commPerDay ? ' (Non-Community)' : ''}
      </div>

      <table className="sp-pricing-table">
        <thead>
          <tr>
            <th>Plan Type</th>
            <th>Per Day</th>
            <th>Total Price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Non-Community</td>
            <td>{fmtPrice(perDay)}</td>
            <td className="sp-price-total">{fmtPrice(plan.price)}</td>
          </tr>
          {plan.communityPrice && commPerDay && (
            <tr className="sp-community-row">
              <td>Community</td>
              <td>{fmtPrice(commPerDay)}</td>
              <td className="sp-price-total community">{fmtPrice(plan.communityPrice)}</td>
            </tr>
          )}
          {savings && (
            <tr className="sp-savings-row">
              <td>You Save</td>
              <td>—</td>
              <td className="sp-savings-amt">{fmtPrice(savings)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <ul className="sp-features">
        {features.map((f, i) => (
          <li key={i}>
            <span className="sp-feat-check">✓</span>
            {f}
          </li>
        ))}
      </ul>

      <button
        className={`sp-select-btn${isSelected ? ' selected' : ''}`}
        onClick={e => { e.stopPropagation(); onSelect(plan._id); }}
        type="button"
      >
        {isSelected ? '✓ Selected' : 'Select Plan'}
      </button>
    </div>
  );
}

export default function SubscriptionPage() {
  useBodyScroll();
  const { state, dispatch } = useApp();

  const [plans,         setPlans]         = useState([]);
  const [status,        setStatus]        = useState(null);
  const [selected,      setSelected]      = useState(null);
  const [activeTab,     setActiveTab]     = useState('Regular');
  const [coupon,        setCoupon]        = useState('');
  const [couponData,    setCouponData]    = useState(null);
  const [couponErr,     setCouponErr]     = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [paying,        setPaying]        = useState(false);
  const [msg,           setMsg]           = useState('');
  const [msgType,       setMsgType]       = useState('');
  const [termsOpen,     setTermsOpen]     = useState(false);

  const userRole = state.user?.role || 'user';
  const isAdminOrMember = userRole === 'admin' || userRole === 'member';

  useEffect(() => {
    fetch(`${API_BASE}/api/subscription/plans`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setPlans(d.plans);
          const popular = d.plans.find(p => p.badge === 'Most Popular');
          setSelected((popular || d.plans[0])?._id || null);
        }
      }).catch(() => {});

    fetch(`${API_BASE}/api/subscription/status`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setStatus(d); })
      .catch(() => {});
  }, []);

  const handleRemoveCoupon = () => { setCoupon(''); setCouponData(null); setCouponErr(''); };

  const handleSelectPlan = (planId) => {
    setSelected(planId);
    handleRemoveCoupon();
  };

  const handleTabChange = (cat) => {
    setActiveTab(cat);
    setSelected(null);
    handleRemoveCoupon();
  };

  const tabPlans     = plans.filter(p => (p.category || 'Regular') === activeTab);
  const selectedPlan = plans.find(p => p._id === selected);

  const handleApplyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponLoading(true); setCouponErr(''); setCouponData(null);
    try {
      const r = await fetch(`${API_BASE}/api/subscription/apply-coupon`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: coupon.trim(), planId: selected }),
      });
      const d = await r.json();
      if (d.success) { setCouponData(d); }
      else { setCouponErr(d.error || 'Invalid coupon'); }
    } catch { setCouponErr('Network error'); }
    setCouponLoading(false);
  };

  const finalAmount = selectedPlan
    ? Math.max(100, selectedPlan.price - (couponData?.discountAmount || 0))
    : 0;

  const handleSubscribe = async () => {
    if (!selected) return setMsg('Please select a plan.');
    const ok = await loadRazorpay();
    if (!ok) return setMsg('Could not load payment gateway. Please check your internet.');
    setPaying(true); setMsg(''); setMsgType('');

    try {
      const r = await fetch(`${API_BASE}/api/subscription/create-order`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: selected, couponCode: couponData?.coupon?.code || '' }),
      });
      const orderData = await r.json();
      if (!orderData.success) {
        setMsg(orderData.error || 'Failed to create order.');
        setMsgType('error'); setPaying(false); return;
      }

      const options = {
        key:         orderData.keyId || RZP_KEY,
        amount:      orderData.amount,
        currency:    orderData.currency,
        name:        'Simplify Option Chain',
        description: `${orderData.planName} Subscription`,
        order_id:    orderData.orderId,
        prefill: {
          name:  state.user?.name  || '',
          email: state.user?.email || '',
        },
        theme: { color: '#ff6f00' },
        handler: async (response) => {
          try {
            const vr = await fetch(`${API_BASE}/api/subscription/verify`, {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              }),
            });
            const vd = await vr.json();
            if (vd.success) {
              setMsg('Subscription activated! Enjoy full access.');
              setMsgType('success');
              const sr = await fetch(`${API_BASE}/api/subscription/status`, { credentials: 'include' });
              const sd = await sr.json();
              if (sd.success) {
                setStatus(sd);
                if (sd.subscription) {
                  const dl = daysLeft(sd.subscription.endDate);
                  dispatch({ type: 'SET_SUBSCRIPTION', payload: {
                    active: true, planName: sd.subscription.planName,
                    endDate: sd.subscription.endDate, daysLeft: dl,
                  }});
                }
              }
              handleRemoveCoupon();
            } else {
              setMsg(vd.error || 'Payment verification failed. Contact support.');
              setMsgType('error');
            }
          } catch { setMsg('Verification error. Contact support.'); setMsgType('error'); }
          setPaying(false);
        },
        modal: { ondismiss: () => setPaying(false) },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (e) {
      setMsg('Payment error: ' + e.message);
      setMsgType('error');
      setPaying(false);
    }
  };

  const activeSub   = status?.subscription;
  const dl          = activeSub ? daysLeft(activeSub.endDate) : 0;
  const pct         = activeSub ? progressPct(activeSub.startDate, activeSub.endDate) : 0;
  const subExpiring = activeSub && dl <= 10;
  const barColor    = pct > 30 ? '#2e7d32' : pct > 10 ? '#e65100' : '#b71c1c';

  return (
    <div className="sub-page">

      {/* ── Header ── */}
      <div className="sub-header">
        <span className="sub-header-icon">💎</span>
        <div>
          <div className="sub-header-title">Subscription</div>
          <div className="sub-header-sub">Plans &amp; Billing — Simplify Option Chain</div>
        </div>
        {state.user?.name && <div className="sub-header-user">{state.user.name}</div>}
      </div>

      <div className="sub-body">

        {/* ── Admin / Member banner ── */}
        {isAdminOrMember && (
          <div className="sub-active-banner admin">
            <span className="sub-banner-icon">⭐</span>
            <div>
              <div className="sub-banner-title">Full Access — {userRole === 'admin' ? 'Admin' : 'Member'}</div>
              <div className="sub-banner-sub">Your role grants unrestricted access to all features.</div>
            </div>
          </div>
        )}

        {/* ── Active Subscription Detail Card ── */}
        {activeSub && !isAdminOrMember && (
          <div className={`sub-sub-card${subExpiring ? ' expiring' : ''}`}>
            <div className="sub-sub-card-toprow">
              <div className="sub-sub-plan-name">{activeSub.planName}</div>
              <span className={`sub-sub-badge${subExpiring ? ' expiring' : ''}`}>
                {subExpiring ? '⚠️ Expiring Soon' : '✅ Active'}
              </span>
            </div>
            <div className="sub-sub-dates-row">
              <div className="sub-sub-date-col">
                <div className="sub-sub-date-label">Start Date</div>
                <div className="sub-sub-date-value">{fmtDate(activeSub.startDate)}</div>
              </div>
              <div className="sub-sub-date-arrow">→</div>
              <div className="sub-sub-date-col">
                <div className="sub-sub-date-label">End Date</div>
                <div className="sub-sub-date-value">{fmtDate(activeSub.endDate)}</div>
              </div>
              <div className="sub-sub-days-pill" style={{ background: subExpiring ? '#fff3e0' : '#e8f5e9', borderColor: subExpiring ? '#ffcc80' : '#a5d6a7' }}>
                <div className="sub-sub-days-number" style={{ color: barColor }}>{dl}</div>
                <div className="sub-sub-days-label">days left</div>
              </div>
            </div>
            <div className="sub-sub-progress-track">
              <div className="sub-sub-progress-fill" style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <div className="sub-sub-progress-labels">
              <span>Used</span>
              <span>{pct}% remaining</span>
            </div>
          </div>
        )}

        {/* ── Alert ── */}
        {msg && <div className={`sub-msg ${msgType}`}>{msg}</div>}

        {/* ── Plans Section ── */}
        <div className="sub-card">

          {/* Category Tabs */}
          <div className="sp-tabs">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`sp-tab-btn${activeTab === cat ? ' active' : ''}`}
                onClick={() => handleTabChange(cat)}
                type="button"
              >
                {CAT_LABELS[cat]}
              </button>
            ))}
          </div>

          {/* Plan Cards */}
          {tabPlans.length === 0 ? (
            <div className="sp-no-plans">No plans available in this category.</div>
          ) : (
            <div className="sp-plans-grid">
              {tabPlans.map(plan => (
                <PlanCard
                  key={plan._id}
                  plan={plan}
                  isSelected={selected === plan._id}
                  onSelect={handleSelectPlan}
                />
              ))}
            </div>
          )}

          {/* Footer links */}
          <div className="sp-footer-links">
            <span>Shipping &amp; Delivery: <button className="sp-link-btn" onClick={() => setTermsOpen(true)}>View Details</button></span>
            <span>|</span>
            <span>Cancellation &amp; Refund: <button className="sp-link-btn" onClick={() => setTermsOpen(true)}>View Details</button></span>
          </div>
        </div>

        {/* ── Coupon ── */}
        {selectedPlan && (
          <div className="sub-card">
            <div className="sub-card-title">Have a Coupon Code?</div>
            {couponData ? (
              <div className="sub-coupon-applied">
                <span className="sub-coupon-tag">🏷️ {couponData.coupon.code}</span>
                <span className="sub-coupon-save">{couponData.message}</span>
                <button className="sub-coupon-remove" onClick={handleRemoveCoupon}>✕ Remove</button>
              </div>
            ) : (
              <div className="sub-coupon-row">
                <input
                  className="sub-coupon-input"
                  placeholder="Enter coupon code"
                  value={coupon}
                  onChange={e => { setCoupon(e.target.value.toUpperCase()); setCouponErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                />
                <button
                  className="sub-coupon-btn"
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !coupon.trim()}
                >
                  {couponLoading ? '...' : 'Apply'}
                </button>
              </div>
            )}
            {couponErr && <div className="sub-coupon-err">{couponErr}</div>}
          </div>
        )}

        {/* ── Order Summary + Pay ── */}
        {selectedPlan && (
          <div className="sub-card">
            <div className="sub-card-title">Order Summary</div>
            <div className="sub-summary-card">
              <div className="sub-summary-row">
                <span>Plan</span>
                <span>{selectedPlan.name} ({selectedPlan.durationDays} days)</span>
              </div>
              <div className="sub-summary-row">
                <span>Price</span>
                <span>{fmtPrice(selectedPlan.price)}</span>
              </div>
              {couponData && (
                <div className="sub-summary-row discount">
                  <span>Discount ({couponData.coupon.code})</span>
                  <span>− {fmtPrice(couponData.discountAmount)}</span>
                </div>
              )}
              <div className="sub-summary-row total">
                <span>Total</span>
                <span>{fmtPrice(finalAmount)}</span>
              </div>
            </div>
            <button className="sub-pay-btn" onClick={handleSubscribe} disabled={paying}>
              {paying ? '⏳ Processing...' : `Pay ${fmtPrice(finalAmount)} & Subscribe`}
            </button>
            <p className="sub-secure-note">🔒 Payments secured by Razorpay · UPI, Net Banking, Cards accepted</p>
          </div>
        )}

        {/* ── Payment History ── */}
        {(() => {
          const paidHistory = (status?.history || []).filter(
            h => h.amountPaid > 0 && !h.planName?.toLowerCase().includes('trial')
          );
          return paidHistory.length > 0 ? (
            <div className="sub-card" style={{ overflowX: 'auto' }}>
              <div className="sub-card-title">Recharge History</div>
              <table className="sub-history-table">
                <thead>
                  <tr><th>Plan</th><th>Amount</th><th>Start</th><th>End</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {paidHistory.map((h, i) => (
                    <tr key={i}>
                      <td>{h.planName}</td>
                      <td>{fmtPrice(h.amountPaid)}</td>
                      <td>{fmtDate(h.startDate)}</td>
                      <td>{fmtDate(h.endDate)}</td>
                      <td><span className={`sub-status-pill ${h.status}`}>{h.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null;
        })()}

        {/* ── Terms ── */}
        <div className="sub-card">
          <button className="sub-terms-toggle" onClick={() => setTermsOpen(o => !o)}>
            📋 Terms &amp; Conditions
            <span className={`sub-terms-chevron${termsOpen ? ' open' : ''}`}>▼</span>
          </button>
          {termsOpen && (
            <div className="sub-terms-body">
              <h3>Subscription Terms &amp; Conditions</h3>
              <p><strong>1. Subscription Plans:</strong> Simplify Option Chain offers various subscription plans with different durations. Access begins immediately upon successful payment.</p>
              <p><strong>2. Payment:</strong> All payments are processed securely through Razorpay. We accept UPI, Net Banking, Credit/Debit Cards, and Wallets. Prices are inclusive of applicable taxes.</p>
              <p><strong>3. Renewal:</strong> Subscriptions do not auto-renew. You must manually purchase a new plan when your current plan expires.</p>
              <p><strong>4. Refund Policy:</strong> We offer a 24-hour refund window if the service was not accessible due to technical issues on our end. No refunds are issued for change of mind or partial usage after 24 hours of activation.</p>
              <p><strong>5. Shipping &amp; Delivery:</strong> This is a digital subscription service. Access is granted instantly upon payment verification. No physical goods are shipped.</p>
              <p><strong>6. Cancellation:</strong> You may request cancellation within 24 hours of purchase if the service was not accessible. After 24 hours, no cancellations are accepted.</p>
              <p><strong>7. Coupon Codes:</strong> Coupon codes are single-use per order and cannot be combined with other offers. Coupons have validity periods and usage limits.</p>
              <p><strong>8. Access After Expiry:</strong> Upon subscription expiry, access to Live Option Chain and real-time data will be revoked. Historical data remains accessible.</p>
              <p><strong>9. Data Accuracy:</strong> Market data is sourced from NSE/BSE via Upstox APIs. Simplify Option Chain is not responsible for data delays, errors, or losses from trading decisions.</p>
              <p><strong>10. Account:</strong> Subscriptions are non-transferable and tied to your registered account. Sharing credentials may result in account suspension.</p>
              <p><strong>11. Contact:</strong> For billing support, email <a href="mailto:simplifyoptionchain@gmail.com">simplifyoptionchain@gmail.com</a> or reach us on Telegram <a href="https://t.me/simplifyoc" target="_blank" rel="noreferrer">@simplifyoc</a>.</p>
              <p className="sub-terms-last">By subscribing, you agree to these terms and our Privacy Policy. Last updated: May 2026.</p>
            </div>
          )}
        </div>

        {/* ── Contact ── */}
        <div className="sub-card" style={{ border: '2px dashed #ff6f00', background: '#fffbf5' }}>
          <div className="sub-card-title">Need Help or Have Questions?</div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.7, marginBottom: 16 }}>
            Contact us for manual activation, bulk plans, or any billing queries. We typically respond within 2 hours during market hours.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 800, textDecoration: 'none', background: '#ff6f00', color: '#fff' }} href="mailto:simplifyoptionchain@gmail.com">📧 Email Us</a>
            <a style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 800, textDecoration: 'none', background: '#fff', color: '#333', border: '1.5px solid #ccc' }} href="https://t.me/simplifyoc" target="_blank" rel="noreferrer">✈️ Telegram</a>
            <a style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 800, textDecoration: 'none', background: '#fff', color: '#333', border: '1.5px solid #ccc' }} href="https://instagram.com/soc.ai.in" target="_blank" rel="noreferrer">📸 Instagram</a>
          </div>
        </div>

      </div>
    </div>
  );
}
