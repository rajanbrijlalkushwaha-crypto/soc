// emailService/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sendVerificationEmail, sendOTPEmail, sendPasswordResetEmail } = require('./emailService');
const { User, PendingUser } = require('../db/models/User');
const sesCache = require('../sessionCache');
const subCache = require('../subscriptionCache');

// Directory paths — only for non-user data still stored on disk
const { PATHS } = require('../config/paths');
const PHOTO_DIR   = path.join(PATHS.USERS, 'photo');
const UI_DIR      = path.join(PATHS.USERS, 'UI');
const JOURNAL_DIR = path.join(PATHS.USERS, 'Tradingjournal');

[PHOTO_DIR, UI_DIR, JOURNAL_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function generateOTP() {
    return Math.floor(10000 + Math.random() * 90000).toString();
}

// ================================
// CHECK SESSION
// ================================
router.get('/check-session', (req, res) => {
    if (req.session && req.session.userId && req.session.userVerified) {
        res.json({
            authenticated: true,
            user: {
                id:    req.session.userId,
                name:  req.session.userName,
                email: req.session.userEmail,
                role:  req.session.userRole || 'user',
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

// ================================
// LOGOUT
// ================================
router.post('/logout', (req, res) => {
    const uid = req.session?.userId;
    req.session.destroy(err => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        if (uid) subCache.del(uid);
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

// ================================
// SIGN UP
// ================================
router.post('/signup', async (req, res) => {
    try {
        const { name, firstName, lastName, mobile, city, email, password, verificationType } = req.body;

        if (!email || !password || !verificationType) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!['otp', 'link'].includes(verificationType)) {
            return res.status(400).json({ error: 'Invalid verification type' });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId    = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
        const emailHash = userId; // same md5 of lowercase email
        const fullName  = name || `${firstName || ''} ${lastName || ''}`.trim() || email.split('@')[0];

        const pendingData = {
            email: email.toLowerCase(),
            emailHash,
            name: fullName,
            firstName: firstName || '',
            lastName:  lastName  || '',
            mobile:    mobile    || '',
            city:      city      || '',
            password: hashedPassword,
            userId,
            verificationType,
        };

        if (verificationType === 'otp') {
            const otp = generateOTP();
            pendingData.otp       = otp;
            pendingData.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

            await PendingUser.findOneAndUpdate(
                { email: email.toLowerCase() },
                { $set: pendingData },
                { upsert: true, new: true }
            );

            await sendOTPEmail(req, email, otp);

            return res.json({
                success: true,
                message: 'OTP sent to your email. Please verify within 10 minutes.',
                verificationType: 'otp'
            });
        } else {
            const verificationToken  = crypto.randomBytes(32).toString('hex');
            pendingData.verificationToken = verificationToken;
            pendingData.tokenExpiry       = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await PendingUser.findOneAndUpdate(
                { email: email.toLowerCase() },
                { $set: pendingData },
                { upsert: true, new: true }
            );

            await sendVerificationEmail(req, email, verificationToken);

            return res.json({
                success: true,
                message: 'Verification link sent to your email. Please verify within 24 hours.',
                verificationType: 'link'
            });
        }
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Failed to create account. Please try again.' });
    }
});

// ================================
// VERIFY OTP
// ================================
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required' });
        }

        const pendingUser = await PendingUser.findOne({ email: email.toLowerCase() });
        if (!pendingUser) {
            return res.status(400).json({ error: 'No pending verification found' });
        }

        if (pendingUser.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        if (new Date() > new Date(pendingUser.otpExpiry)) {
            return res.status(400).json({ error: 'OTP expired. Please sign up again.' });
        }

        const userData = {
            userId:     pendingUser.userId,
            name:       pendingUser.name,
            firstName:  pendingUser.firstName || '',
            lastName:   pendingUser.lastName  || '',
            mobile:     pendingUser.mobile    || '',
            city:       pendingUser.city      || '',
            email:      pendingUser.email,
            password:   pendingUser.password,
            role:       'user',
            suspended:  false,
            verified:   true,
            verifiedAt: new Date(),
            createdAt:  pendingUser.createdAt,
            activeSessionId: req.sessionID,
            preferences: {
                ltpDisplay: true, volumeDisplay: true, oiDisplay: true,
                greeksDisplay: false, mmiDisplay: false, theme: 'white'
            },
        };

        await User.findOneAndUpdate(
            { userId: pendingUser.userId },
            { $set: userData },
            { upsert: true, new: true }
        );
        await PendingUser.deleteOne({ email: email.toLowerCase() });

        req.session.userId      = userData.userId;
        req.session.userEmail   = userData.email;
        req.session.userName    = userData.name;
        req.session.userRole    = 'user';
        req.session.userVerified = true;
        req.session.lastActive  = Date.now();

        res.json({
            success: true,
            message: 'Email verified successfully!',
            user: { id: userData.userId, name: userData.name, email: userData.email, role: 'user' }
        });
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ error: 'Verification failed. Please try again.' });
    }
});

// ================================
// VERIFY EMAIL (LINK)
// ================================
router.get('/verify-email', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) return res.redirect('/auth.html?reason=invalid_link');

        const pendingUser = await PendingUser.findOne({ verificationToken: token });
        if (!pendingUser) return res.redirect('/auth.html?reason=invalid_link');

        if (new Date() > new Date(pendingUser.tokenExpiry)) {
            return res.redirect('/auth.html?reason=expired_link');
        }

        const userData = {
            userId:     pendingUser.userId,
            name:       pendingUser.name,
            firstName:  pendingUser.firstName || '',
            lastName:   pendingUser.lastName  || '',
            mobile:     pendingUser.mobile    || '',
            city:       pendingUser.city      || '',
            email:      pendingUser.email,
            password:   pendingUser.password,
            role:       'user',
            suspended:  false,
            verified:   true,
            verifiedAt: new Date(),
            createdAt:  pendingUser.createdAt,
            activeSessionId: req.sessionID,
            preferences: {
                ltpDisplay: true, volumeDisplay: true, oiDisplay: true,
                greeksDisplay: false, mmiDisplay: false, theme: 'white'
            },
        };

        await User.findOneAndUpdate(
            { userId: pendingUser.userId },
            { $set: userData },
            { upsert: true, new: true }
        );
        await PendingUser.deleteOne({ _id: pendingUser._id });

        req.session.userId      = userData.userId;
        req.session.userEmail   = userData.email;
        req.session.userName    = userData.name;
        req.session.userRole    = 'user';
        req.session.userVerified = true;
        req.session.lastActive  = Date.now();

        res.redirect('/optionchain.html');
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).send('Verification failed');
    }
});

// ================================
// SIGN IN
// ================================
router.post('/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        if (!user.verified) {
            return res.status(400).json({
                error: 'Email not verified. Please verify your email first.',
                needsVerification: true
            });
        }

        if (user.suspended) {
            return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // Kick old session immediately, then fire-and-forget the audit write
        sesCache.del(user.userId);
        User.findOneAndUpdate(
            { userId: user.userId },
            {
                $set: { lastLogin: new Date(), activeSessionId: req.sessionID },
                $push: {
                    sessions: {
                        sessionId:  req.sessionID,
                        createdAt:  new Date(),
                        lastActive: new Date(),
                        userAgent:  req.headers['user-agent'] || '',
                    }
                }
            }
        ).catch(() => {});

        const userRole = user.role || 'user';
        req.session.userId      = user.userId;
        req.session.userEmail   = user.email;
        req.session.userName    = user.name;
        req.session.userRole    = userRole;
        req.session.userVerified = true;
        req.session.lastActive  = Date.now();

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id:          user.userId,
                name:        user.name,
                email:       user.email,
                role:        userRole,
                preferences: user.preferences
            }
        });
    } catch (error) {
        console.error('Signin error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// ================================
// FORGOT PASSWORD
// ================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        await User.findOneAndUpdate(
            { userId: user.userId },
            { $set: { resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) } }
        );

        await sendPasswordResetEmail(req, email, resetToken);

        res.json({ success: true, message: 'Password reset link sent to your email.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
    }
});

// ================================
// RESET PASSWORD (from token in link)
// ================================
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const targetUser = await User.findOne({ resetToken: token });
        if (!targetUser) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        if (new Date() > new Date(targetUser.resetTokenExpiry)) {
            return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
        }

        await User.findOneAndUpdate(
            { userId: targetUser.userId },
            {
                $set:   { password: await bcrypt.hash(newPassword, 10) },
                $unset: { resetToken: 1, resetTokenExpiry: 1 }
            }
        );

        res.json({ success: true, message: 'Password updated successfully. Please sign in.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
});

// GET route for reset password link from email
router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (!token) return res.redirect('/auth.html');
    res.redirect(`/auth.html?reset_token=${token}`);
});

// ================================
// GET USER PREFERENCES
// ================================
router.get('/preferences', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

        const user = await User.findOne({ userId: req.session.userId }).lean();
        if (!user) return res.status(404).json({ error: 'User not found' });

        res.json({ success: true, preferences: user.preferences || {} });
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

// ================================
// UPDATE USER PREFERENCES
// ================================
router.post('/preferences', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

        const user = await User.findOne({ userId: req.session.userId }).lean();
        if (!user) return res.status(404).json({ error: 'User not found' });

        const updatedPrefs = { ...(user.preferences || {}), ...req.body };
        await User.findOneAndUpdate(
            { userId: req.session.userId },
            { $set: { preferences: updatedPrefs } }
        );

        res.json({ success: true, message: 'Preferences updated', preferences: updatedPrefs });
    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({ error: 'Failed to update preferences' });
    }
});

// ================================
// RESEND VERIFICATION
// ================================
router.post('/resend-verification', async (req, res) => {
    try {
        const { email, verificationType } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser && existingUser.verified) {
            return res.status(400).json({ error: 'Email already verified. Please sign in.' });
        }

        const pendingUser = await PendingUser.findOne({ email: email.toLowerCase() });
        if (!pendingUser) {
            return res.status(400).json({ error: 'No pending verification found. Please sign up.' });
        }

        if (verificationType === 'otp') {
            const otp = generateOTP();
            await PendingUser.findOneAndUpdate(
                { email: email.toLowerCase() },
                { $set: { otp, otpExpiry: new Date(Date.now() + 10 * 60 * 1000) } }
            );
            await sendOTPEmail(req, email, otp);
            res.json({ success: true, message: 'New OTP sent to your email' });
        } else {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            await PendingUser.findOneAndUpdate(
                { email: email.toLowerCase() },
                { $set: { verificationToken, tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000) } }
            );
            await sendVerificationEmail(req, email, verificationToken);
            res.json({ success: true, message: 'New verification link sent to your email' });
        }
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification' });
    }
});

// ================================
// ADMIN USER MANAGEMENT
// ================================

function requireAdminOrMember(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    const role = req.session.userRole || 'user';
    if (role !== 'admin' && role !== 'member') return res.status(403).json({ error: 'Access denied' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    if ((req.session.userRole || 'user') !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

// List all users
router.get('/admin/users', requireAdminOrMember, async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 }).lean();
        res.json({
            success: true,
            users: users.map(u => ({
                userId:    u.userId,
                name:      u.name      || '',
                email:     u.email     || '',
                mobile:    u.mobile    || '',
                city:      u.city      || '',
                role:      u.role      || 'user',
                suspended: u.suspended || false,
                verified:  u.verified  || false,
                createdAt: u.createdAt || null,
                lastLogin: u.lastLogin || null,
                hasPhoto:  u.hasPhoto  || false,
            }))
        });
    } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ error: 'Failed to list users' });
    }
});

// Update user role (admin only)
router.patch('/admin/users/:userId/role', requireAdmin, async (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'member', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
        const user = await User.findOneAndUpdate(
            { userId: req.params.userId },
            { $set: { role } },
            { returnDocument: 'after' }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: `Role updated to ${role}` });
    } catch (err) {
        console.error('Update role error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// Suspend / unsuspend user (admin only)
router.patch('/admin/users/:userId/suspend', requireAdmin, async (req, res) => {
    try {
        if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'Cannot suspend yourself' });
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const suspended = !user.suspended;
        await User.findOneAndUpdate({ userId: req.params.userId }, { $set: { suspended } });
        res.json({ success: true, suspended, message: suspended ? 'User suspended' : 'User unsuspended' });
    } catch (err) {
        console.error('Suspend user error:', err);
        res.status(500).json({ error: 'Failed to update suspension' });
    }
});

// ================================
// TRADING JOURNAL (file-based)
// ================================

function getJournalPath(userId) {
    return path.join(JOURNAL_DIR, `${userId}tradingjournal.json`);
}

function readJournal(userId) {
    const p = getJournalPath(userId);
    if (!fs.existsSync(p)) return { entries: [] };
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { entries: [] }; }
}

function saveJournal(userId, data) {
    fs.writeFileSync(getJournalPath(userId), JSON.stringify(data, null, 2));
}

router.get('/journal', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const journal = readJournal(req.session.userId);
        res.json({ success: true, entries: journal.entries || [] });
    } catch (err) {
        console.error('Get journal error:', err);
        res.status(500).json({ error: 'Failed to get journal' });
    }
});

router.post('/journal', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const { date, symbol, strategy, customStrategy, description, profit, loss } = req.body;
        if (!date || !symbol) return res.status(400).json({ error: 'Date and symbol are required' });

        const journal = readJournal(req.session.userId);
        const entry = {
            id:             crypto.randomBytes(8).toString('hex'),
            date,
            symbol:         symbol.toUpperCase(),
            strategy:       strategy || 'Other',
            customStrategy: strategy === 'Other' ? (customStrategy || '') : '',
            description:    description || '',
            profit:         parseFloat(profit) || 0,
            loss:           parseFloat(loss)   || 0,
            createdAt:      new Date().toISOString(),
        };
        journal.entries.unshift(entry);
        saveJournal(req.session.userId, journal);
        res.json({ success: true, entry });
    } catch (err) {
        console.error('Add journal error:', err);
        res.status(500).json({ error: 'Failed to add entry' });
    }
});

router.delete('/journal/:id', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const journal = readJournal(req.session.userId);
        journal.entries = journal.entries.filter(e => e.id !== req.params.id);
        saveJournal(req.session.userId, journal);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete journal error:', err);
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

// ================================
// PHOTO UPLOAD
// ================================
const photoStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
    filename:    (req,  _file, cb) => cb(null, `${req.session.userId}.jpg`),
});
const photoUpload = multer({
    storage: photoStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG/PNG/WEBP images are allowed'));
    },
});

// ================================
// GET PROFILE
// ================================
router.get('/profile', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const user = await User.findOne({ userId: req.session.userId }).lean();
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            success: true,
            profile: {
                userId:    user.userId,
                name:      user.name      || '',
                firstName: user.firstName || '',
                lastName:  user.lastName  || '',
                email:     user.email     || '',
                mobile:    user.mobile    || '',
                city:      user.city      || '',
                verified:  user.verified  || false,
                createdAt: user.createdAt || null,
                lastLogin: user.lastLogin || null,
                hasPhoto:  user.hasPhoto  || false,
            },
        });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// ================================
// CHANGE PASSWORD
// ================================
router.post('/change-password', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

        const user = await User.findOne({ userId: req.session.userId });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

        await User.findOneAndUpdate(
            { userId: req.session.userId },
            { $set: { password: await bcrypt.hash(newPassword, 10) } }
        );
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// ================================
// UPLOAD PHOTO
// ================================
router.post('/upload-photo', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    photoUpload.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        await User.findOneAndUpdate({ userId: req.session.userId }, { $set: { hasPhoto: true } });
        res.json({ success: true, photoUrl: `/api/auth/photo/${req.session.userId}?t=${Date.now()}` });
    });
});

// ================================
// SERVE PHOTO
// ================================
router.get('/photo/:userId', (req, res) => {
    const photoPath = path.join(PHOTO_DIR, `${req.params.userId}.jpg`);
    if (!fs.existsSync(photoPath)) return res.status(404).json({ error: 'No photo' });
    res.sendFile(photoPath);
});

// ================================
// GET UI SETTINGS
// ================================
router.get('/ui-settings', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const filePath = path.join(UI_DIR, `${req.session.userId}UI.json`);
        if (!fs.existsSync(filePath)) return res.json({ success: true, settings: {} });
        const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({ success: true, settings });
    } catch (err) {
        console.error('Get UI settings error:', err);
        res.status(500).json({ error: 'Failed to get UI settings' });
    }
});

// ================================
// SAVE UI SETTINGS
// ================================
router.post('/ui-settings', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const filePath = path.join(UI_DIR, `${req.session.userId}UI.json`);
        const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
        const updated  = { ...existing, ...req.body };
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
        res.json({ success: true, settings: updated });
    } catch (err) {
        console.error('Save UI settings error:', err);
        res.status(500).json({ error: 'Failed to save UI settings' });
    }
});

// ================================
// BOOTSTRAP — single call returns everything needed on page load
// ================================
router.get('/bootstrap', async (req, res) => {
    try {
        if (!req.session.userId || !req.session.userVerified) {
            return res.json({ authenticated: false });
        }

        const uid  = req.session.userId;
        const user = {
            id:    uid,
            email: req.session.userEmail,
            name:  req.session.userName,
            role:  req.session.userRole || 'user',
        };

        // Run all three independent lookups in parallel — was sequential (3 round-trips)
        const [settings, notifResult, subResult] = await Promise.all([
            // 1. UI settings from disk
            (async () => {
                try {
                    const uiFile = path.join(UI_DIR, `${uid}UI.json`);
                    if (fs.existsSync(uiFile)) return JSON.parse(fs.readFileSync(uiFile, 'utf8'));
                } catch {}
                return {};
            })(),

            // 2. Notifications
            (async () => {
                try {
                    const { Notification } = require('../db/models/Notification');
                    return await Notification.find({}).sort({ createdAt: -1 }).lean();
                } catch { return []; }
            })(),

            // 3. Subscription — served from RAM cache (5-min TTL), Atlas only on miss
            (async () => {
                try {
                    const { getActiveSub, expireStale } = require('../api/subscription');
                    const cached = subCache.get(uid);
                    if (cached.found) return cached.sub;
                    // Cache miss — hit Atlas once, then cache result
                    expireStale(uid).catch(() => {}); // fire-and-forget, no need to wait
                    const sub = await getActiveSub(uid);
                    subCache.set(uid, sub);
                    return sub;
                } catch { return null; }
            })(),
        ]);

        const notifications = notifResult.map(n => ({
            id: n.id, title: n.title, message: n.message,
            hasFile: n.hasFile, fileType: n.fileType, fileName: n.fileName,
            createdAt: n.createdAt, seen: n.seenBy.includes(uid),
        }));
        const popup  = notifResult.filter(n => !n.seenBy.includes(uid)).map(n => ({
            id: n.id, title: n.title, message: n.message, hasFile: n.hasFile, createdAt: n.createdAt,
        }));
        const unread = notifications.filter(n => !n.seen).length;

        let subscription = { active: false };
        if (subResult) {
            const daysLeft = Math.ceil((new Date(subResult.endDate) - new Date()) / 86400000);
            subscription = {
                active: true, planName: subResult.planName,
                startDate: subResult.startDate, endDate: subResult.endDate, daysLeft,
            };
        }

        res.json({ authenticated: true, user, settings, notifications, popup, unread, subscription });
    } catch (err) {
        console.error('Bootstrap error:', err);
        res.status(500).json({ error: 'Bootstrap failed' });
    }
});

module.exports = router;
