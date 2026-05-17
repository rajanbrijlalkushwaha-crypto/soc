'use strict';
/**
 * api/subscription.js
 * Razorpay-backed subscription management.
 *
 * Routes (all require auth session):
 *   GET  /api/subscription/plans          — list active plans
 *   GET  /api/subscription/status         — current user's active sub
 *   POST /api/subscription/apply-coupon   — validate coupon
 *   POST /api/subscription/create-order   — create Razorpay order
 *   POST /api/subscription/verify         — verify payment + activate sub
 *
 * Admin routes (role: admin):
 *   GET    /api/admin/subscriptions        — all subscriptions
 *   GET    /api/admin/coupons              — list coupons
 *   POST   /api/admin/coupons              — create coupon
 *   PATCH  /api/admin/coupons/:id          — toggle/update coupon
 *   DELETE /api/admin/coupons/:id          — delete coupon
 *   GET    /api/admin/plans                — list plans
 *   POST   /api/admin/plans                — create plan
 *   PATCH  /api/admin/plans/:id            — update plan
 */

const express  = require('express');
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const { SubscriptionPlan } = require('../db/models/SubscriptionPlan');
const { Coupon }           = require('../db/models/Coupon');
const { UserSubscription } = require('../db/models/UserSubscription');
const { User }             = require('../db/models/User');
const subCache             = require('../subscriptionCache');

const router = express.Router();

// Lazy-init so env vars are read after dotenv loads
function getRzp() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// ── Auth guard ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId || !req.session?.userVerified) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.userId || !req.session?.userVerified) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin only' });
  }
  next();
}

// ── Seed default plans (called once on startup) ───────────────────────────────
async function seedDefaultPlans() {
  const count = await SubscriptionPlan.countDocuments();
  if (count > 0) return;

  await SubscriptionPlan.insertMany([
    {
      name: 'Monthly',
      price: 49900,        // ₹499
      durationDays: 30,
      badge: '',
      sortOrder: 1,
      description: 'Full access for 1 month',
      features: [
        'Live Option Chain (Real-time)',
        'Historical Data Analysis',
        'Power AI Stock Signals',
        'OI Charts & Spot Charts',
        'MCTR & Strategy 4.0 Levels',
        'Shifting Levels Detection',
        'LTP Calculator',
        'Trading Journal',
      ],
    },
    {
      name: 'Quarterly',
      price: 129900,       // ₹1,299
      durationDays: 90,
      badge: 'Most Popular',
      sortOrder: 2,
      description: 'Full access for 3 months',
      features: [
        'Live Option Chain (Real-time)',
        'Historical Data Analysis',
        'Power AI Stock Signals',
        'OI Charts & Spot Charts',
        'MCTR & Strategy 4.0 Levels',
        'Shifting Levels Detection',
        'LTP Calculator',
        'Trading Journal',
        'Priority Support',
      ],
    },
    {
      name: 'Annual',
      price: 399900,       // ₹3,999
      durationDays: 365,
      badge: 'Best Value',
      sortOrder: 3,
      description: 'Full access for 1 year',
      features: [
        'Live Option Chain (Real-time)',
        'Historical Data Analysis',
        'Power AI Stock Signals',
        'OI Charts & Spot Charts',
        'MCTR & Strategy 4.0 Levels',
        'Shifting Levels Detection',
        'LTP Calculator',
        'Trading Journal',
        'Priority Support',
        '2 Months Free vs Monthly',
      ],
    },
  ]);
  console.log('[Subscription] Default plans seeded.');
}

// Run seed after 3 s to let MongoDB connect first
setTimeout(() => seedDefaultPlans().catch(() => {}), 3000);

// ── Helper: get active subscription for a userId ──────────────────────────────
async function getActiveSub(userId) {
  return UserSubscription.findOne({
    userId,
    status: 'active',
    endDate: { $gt: new Date() },
  }).sort({ endDate: -1 }).lean();
}

// ── Helper: expire stale subscriptions (run on status check) ─────────────────
async function expireStale(userId) {
  await UserSubscription.updateMany(
    { userId, status: 'active', endDate: { $lte: new Date() } },
    { $set: { status: 'expired' } }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/subscription/plans
router.get('/plans', requireAuth, async (req, res) => {
  try {

    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json({ success: true, plans });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/subscription/status
router.get('/status', requireAuth, async (req, res) => {
  try {

    const uid = req.session.userId;
    await expireStale(uid);
    const sub = await getActiveSub(uid);
    const history = await UserSubscription.find({ userId: uid })
      .sort({ createdAt: -1 }).limit(5).lean();

    res.json({
      success: true,
      active: !!sub,
      subscription: sub || null,
      history,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/subscription/apply-coupon
router.post('/apply-coupon', requireAuth, async (req, res) => {
  try {

    const { code, planId } = req.body;
    if (!code) return res.json({ success: false, error: 'Enter a coupon code' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase().trim(), isActive: true });
    if (!coupon) return res.json({ success: false, error: 'Invalid or expired coupon code' });

    if (coupon.validUntil && new Date() > new Date(coupon.validUntil))
      return res.json({ success: false, error: 'This coupon has expired' });

    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses)
      return res.json({ success: false, error: 'This coupon has reached its usage limit' });

    // Get plan price to calculate discount
    let discountAmount = 0;
    if (planId) {
      const plan = await SubscriptionPlan.findById(planId).lean();
      if (plan) {
        discountAmount = coupon.type === 'percent'
          ? Math.round(plan.price * coupon.value / 100)
          : Math.min(coupon.value, plan.price);  // flat discount in paise
      }
    }

    res.json({
      success: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        description: coupon.description,
      },
      discountAmount,
      message: coupon.type === 'percent'
        ? `${coupon.value}% discount applied!`
        : `₹${(coupon.value / 100).toFixed(0)} discount applied!`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/subscription/create-order
router.post('/create-order', requireAuth, async (req, res) => {
  try {

    const uid    = req.session.userId;
    const email  = req.session.userEmail || '';
    const { planId, couponCode } = req.body;

    const userDoc = await User.findOne({ userId: uid }, 'name mobile').lean();
    const userName   = userDoc?.name   || req.session.userName   || '';
    const userMobile = userDoc?.mobile || '';

    const plan = await SubscriptionPlan.findById(planId).lean();
    if (!plan || !plan.isActive)
      return res.status(400).json({ success: false, error: 'Invalid plan' });

    let discountAmount = 0;
    let couponDoc      = null;

    if (couponCode) {
      couponDoc = await Coupon.findOne({ code: couponCode.toUpperCase().trim(), isActive: true });
      if (couponDoc) {
        if (couponDoc.validUntil && new Date() > new Date(couponDoc.validUntil))
          couponDoc = null;
        else if (couponDoc.maxUses > 0 && couponDoc.usedCount >= couponDoc.maxUses)
          couponDoc = null;
      }
      if (couponDoc) {
        discountAmount = couponDoc.type === 'percent'
          ? Math.round(plan.price * couponDoc.value / 100)
          : Math.min(couponDoc.value, plan.price);
      }
    }

    const finalAmount = Math.max(100, plan.price - discountAmount); // min ₹1 (100 paise)

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    if (!keyId) return res.status(500).json({ success: false, error: 'Razorpay key not configured on server' });

    console.log('[Subscription] Creating order for uid:', uid, 'plan:', plan.name, 'amount:', finalAmount);
    const order = await getRzp().orders.create({
      amount:   finalAmount,
      currency: 'INR',
      receipt:  `sub_${uid}_${Date.now()}`.slice(0, 40),
      notes: {
        userId:     (uid || '').slice(0, 50),
        planId:     plan._id.toString().slice(0, 50),
        planName:   plan.name.slice(0, 50),
        couponCode: (couponCode || '').slice(0, 50),
      },
    });
    console.log('[Subscription] Razorpay order created:', order.id);

    // Best-effort pending record — don't let DB failure block the payment flow
    try {
      await UserSubscription.create({
        userId:         uid,
        userName,
        userEmail:      email,
        userMobile,
        planId:         plan._id,
        planName:       plan.name,
        durationDays:   plan.durationDays,
        startDate:      new Date(),
        endDate:        new Date(Date.now() + plan.durationDays * 86400000),
        status:         'pending',
        razorpayOrderId: order.id,
        originalAmount: plan.price,
        discountAmount,
        amountPaid:     finalAmount,
        couponCode:     couponDoc ? couponDoc.code : '',
        currency:       'INR',
      });
    } catch (dbErr) {
      console.error('[Subscription] DB pending record failed (non-fatal):', dbErr.message);
    }

    res.json({
      success:  true,
      orderId:  order.id,
      amount:   finalAmount,
      currency: 'INR',
      planName: plan.name,
      keyId:    keyId,
    });
  } catch (e) {
    const detail = e.error?.description || e.error?.reason || e.message || 'Unknown error';
    console.error('[Subscription] create-order error:', detail, e.statusCode || '', e.stack || '');
    res.status(500).json({ success: false, error: detail });
  }
});

// POST /api/subscription/verify
router.post('/verify', requireAuth, async (req, res) => {
  try {

    const uid = req.session.userId;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ success: false, error: 'Missing payment details' });

    // Verify HMAC signature
    const body      = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected  = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature)
      return res.status(400).json({ success: false, error: 'Payment verification failed' });

    // Activate the pending subscription (or create if pending record was missed)
    let sub = await UserSubscription.findOneAndUpdate(
      { userId: uid, razorpayOrderId: razorpay_order_id },
      {
        $set: {
          status:            'active',
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
        },
      },
      { returnDocument: 'after' }
    );

    if (!sub) {
      // Pending record was not saved — fetch order details from Razorpay to reconstruct
      try {
        const rzpOrder  = await getRzp().orders.fetch(razorpay_order_id);
        const planId    = rzpOrder.notes?.planId;
        const plan      = planId ? await SubscriptionPlan.findById(planId).lean() : null;
        const email     = req.session.userEmail || '';
        const fallbackUser = await User.findOne({ userId: uid }, 'name mobile').lean().catch(() => null);
        sub = await UserSubscription.create({
          userId:            uid,
          userName:          fallbackUser?.name   || req.session.userName || '',
          userEmail:         email,
          userMobile:        fallbackUser?.mobile || '',
          planId:            plan?._id,
          planName:          plan?.name || rzpOrder.notes?.planName || 'Unknown',
          durationDays:      plan?.durationDays || 30,
          startDate:         new Date(),
          endDate:           new Date(Date.now() + (plan?.durationDays || 30) * 86400000),
          status:            'active',
          razorpayOrderId:   razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          originalAmount:    rzpOrder.amount,
          amountPaid:        rzpOrder.amount_paid || rzpOrder.amount,
          currency:          'INR',
        });
      } catch (recErr) {
        console.error('[Subscription] verify reconstruct error:', recErr.message);
        return res.status(400).json({ success: false, error: 'Could not activate subscription. Contact support.' });
      }
    }

    // Increment coupon usage
    if (sub.couponCode) {
      await Coupon.updateOne({ code: sub.couponCode }, { $inc: { usedCount: 1 } });
    }

    // Invalidate sub cache so next bootstrap reflects the new subscription immediately
    subCache.del(uid);

    res.json({
      success: true,
      message: 'Subscription activated!',
      subscription: {
        planName:  sub.planName,
        startDate: sub.startDate,
        endDate:   sub.endDate,
        status:    sub.status,
      },
    });
  } catch (e) {
    console.error('[Subscription] verify error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/admin/subscriptions
router.get('/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = status && status !== 'all' ? { status } : {};
    const subs = await UserSubscription.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await UserSubscription.countDocuments(filter);

    // Fill name/mobile for older records that were saved before these fields existed
    const missingIds = subs.filter(s => !s.userName).map(s => s.userId);
    let userMap = {};
    if (missingIds.length) {
      const users = await User.find({ userId: { $in: missingIds } }, 'userId name mobile email').lean();
      userMap = Object.fromEntries(users.map(u => [u.userId, u]));
    }
    const enriched = subs.map(s => {
      const u = userMap[s.userId];
      return {
        ...s,
        userName:   s.userName   || u?.name   || '',
        userEmail:  s.userEmail  || u?.email  || '',
        userMobile: s.userMobile || u?.mobile || '',
      };
    });

    res.json({ success: true, subscriptions: enriched, total });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/coupons
router.get('/admin/coupons', requireAdmin, async (req, res) => {
  try {

    const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, coupons });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/coupons
router.post('/admin/coupons', requireAdmin, async (req, res) => {
  try {

    const { code, type, value, maxUses, validUntil, description } = req.body;
    if (!code || !type || !value)
      return res.status(400).json({ success: false, error: 'code, type, value required' });

    const coupon = await Coupon.create({
      code:       code.toUpperCase().trim(),
      type,
      value:      Number(type === 'flat' ? value * 100 : value), // flat stored in paise
      maxUses:    Number(maxUses) || 0,
      validUntil: validUntil ? new Date(validUntil) : null,
      description: description || '',
      createdBy:  req.session.userEmail,
    });
    res.json({ success: true, coupon });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, error: 'Coupon code already exists' });
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/admin/coupons/:id
router.patch('/admin/coupons/:id', requireAdmin, async (req, res) => {
  try {

    const { isActive, maxUses, validUntil, description } = req.body;
    const update = {};
    if (isActive !== undefined) update.isActive = isActive;
    if (maxUses  !== undefined) update.maxUses  = Number(maxUses);
    if (validUntil !== undefined) update.validUntil = validUntil ? new Date(validUntil) : null;
    if (description !== undefined) update.description = description;
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after' });
    res.json({ success: true, coupon });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/coupons/:id
router.delete('/admin/coupons/:id', requireAdmin, async (req, res) => {
  try {

    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/plans
router.get('/admin/plans', requireAdmin, async (req, res) => {
  try {

    const plans = await SubscriptionPlan.find().sort({ sortOrder: 1 }).lean();
    res.json({ success: true, plans });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/plans
router.post('/admin/plans', requireAdmin, async (req, res) => {
  try {

    const { name, price, durationDays, description, features, badge, sortOrder, category, communityPrice } = req.body;
    const plan = await SubscriptionPlan.create({
      name, price: Math.round(price * 100), durationDays,
      description, features, badge, sortOrder,
      category: category || 'Regular',
      ...(communityPrice != null && communityPrice !== '' ? { communityPrice: Math.round(communityPrice * 100) } : {}),
    });
    res.json({ success: true, plan });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/admin/plans/:id
router.patch('/admin/plans/:id', requireAdmin, async (req, res) => {
  try {

    const body = { ...req.body };
    if (body.price != null) body.price = Math.round(body.price * 100);
    if (body.communityPrice != null && body.communityPrice !== '') body.communityPrice = Math.round(body.communityPrice * 100);
    else if (body.communityPrice === '' || body.communityPrice === null) body.communityPrice = null;
    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id, { $set: body }, { returnDocument: 'after' }
    );
    res.json({ success: true, plan });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

// Export helper for use in bootstrap
module.exports.getActiveSub  = getActiveSub;
module.exports.expireStale   = expireStale;
