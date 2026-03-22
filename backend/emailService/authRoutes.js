// emailService/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sendVerificationEmail, sendOTPEmail, sendPasswordResetEmail } = require('./emailService');

// Directories for user data — sourced from centralized path config
const { PATHS } = require('../config/paths');
const USERS_DIR    = PATHS.USERS;
const PENDING_DIR  = PATHS.PENDING;
const PHOTO_DIR    = path.join(PATHS.USERS, 'photo');
const UI_DIR       = path.join(PATHS.USERS, 'UI');
const JOURNAL_DIR  = path.join(PATHS.USERS, 'Tradingjournal');

// Ensure directories exist
[USERS_DIR, PENDING_DIR, PHOTO_DIR, UI_DIR, JOURNAL_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Helper: Get user file path
function getUserFilePath(userId) {
    return path.join(USERS_DIR, `${userId}.json`);
}

// Helper: Get pending user file path
function getPendingUserFilePath(email) {
    const emailHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    return path.join(PENDING_DIR, `${emailHash}.json`);
}

// Helper: Read user data
function readUser(userId) {
    try {
        const filePath = getUserFilePath(userId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return null;
    } catch (error) {
        console.error('Error reading user:', error);
        return null;
    }
}

// Helper: Save user data
function saveUser(userId, userData) {
    try {
        const filePath = getUserFilePath(userId);
        fs.writeFileSync(filePath, JSON.stringify(userData, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving user:', error);
        return false;
    }
}

// Helper: Find user by email
function findUserByEmail(email) {
    try {
        const files = fs.readdirSync(USERS_DIR);
        for (const file of files) {
            const userData = JSON.parse(fs.readFileSync(path.join(USERS_DIR, file), 'utf8'));
            if (userData.email.toLowerCase() === email.toLowerCase()) {
                return userData;
            }
        }
        return null;
    } catch (error) {
        console.error('Error finding user:', error);
        return null;
    }
}

// Helper: Generate OTP
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
                id: req.session.userId,
                name: req.session.userName,
                email: req.session.userEmail,
                role: req.session.userRole || 'user',
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
    req.session.destroy(err => {
        if (err) {
            console.error('Session destroy error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
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

        // Validation
        if (!email || !password || !verificationType) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!['otp', 'link'].includes(verificationType)) {
            return res.status(400).json({ error: 'Invalid verification type' });
        }

        // Check if user already exists
        const existingUser = findUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate user ID
        const userId = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');

        // Full name fallback
        const fullName = name || `${firstName || ''} ${lastName || ''}`.trim() || email.split('@')[0];

        // Create pending user data
        const pendingUserData = {
            userId,
            name: fullName,
            firstName: firstName || '',
            lastName: lastName || '',
            mobile: mobile || '',
            city: city || '',
            email: email.toLowerCase(),
            password: hashedPassword,
            verificationType,
            verified: false,
            createdAt: new Date().toISOString()
        };

        if (verificationType === 'otp') {
            const otp = generateOTP();
            pendingUserData.otp = otp;
            pendingUserData.otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            const pendingFilePath = getPendingUserFilePath(email);
            fs.writeFileSync(pendingFilePath, JSON.stringify(pendingUserData, null, 2));

            await sendOTPEmail(req, email, otp);

            return res.json({
                success: true,
                message: 'OTP sent to your email. Please verify within 10 minutes.',
                verificationType: 'otp'
            });
        } else {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            pendingUserData.verificationToken = verificationToken;
            pendingUserData.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

            const pendingFilePath = getPendingUserFilePath(email);
            fs.writeFileSync(pendingFilePath, JSON.stringify(pendingUserData, null, 2));

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

        const pendingFilePath = getPendingUserFilePath(email);
        if (!fs.existsSync(pendingFilePath)) {
            return res.status(400).json({ error: 'No pending verification found' });
        }

        const pendingUser = JSON.parse(fs.readFileSync(pendingFilePath, 'utf8'));

        if (pendingUser.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        if (new Date() > new Date(pendingUser.otpExpiry)) {
            return res.status(400).json({ error: 'OTP expired. Please sign up again.' });
        }

        // Create verified user
        const userData = {
            userId: pendingUser.userId,
            name: pendingUser.name,
            firstName: pendingUser.firstName || '',
            lastName: pendingUser.lastName || '',
            mobile: pendingUser.mobile || '',
            city: pendingUser.city || '',
            email: pendingUser.email,
            password: pendingUser.password,
            role: 'user',
            suspended: false,
            verified: true,
            verifiedAt: new Date().toISOString(),
            createdAt: pendingUser.createdAt,
            preferences: {
                ltpDisplay: true,
                volumeDisplay: true,
                oiDisplay: true,
                greeksDisplay: false,
                mmiDisplay: false,
                theme: 'white'
            },
            sessions: []
        };

        saveUser(pendingUser.userId, userData);
        fs.unlinkSync(pendingFilePath);

        // Create session
        req.session.userId = userData.userId;
        req.session.userEmail = userData.email;
        req.session.userName = userData.name;
        req.session.userRole = 'user';
        req.session.userVerified = true;
        req.session.lastActive = Date.now();

        res.json({
            success: true,
            message: 'Email verified successfully!',
            user: {
                id: userData.userId,
                name: userData.name,
                email: userData.email,
                role: 'user',
            }
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

        if (!token) {
            return res.redirect('/auth.html?reason=invalid_link');
        }

        const pendingFiles = fs.readdirSync(PENDING_DIR);
        let pendingUser = null;
        let pendingFilePath = null;

        for (const file of pendingFiles) {
            const filePath = path.join(PENDING_DIR, file);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.verificationToken === token) {
                pendingUser = data;
                pendingFilePath = filePath;
                break;
            }
        }

        if (!pendingUser) {
            return res.redirect('/auth.html?reason=invalid_link');
        }

        if (new Date() > new Date(pendingUser.tokenExpiry)) {
            return res.redirect('/auth.html?reason=expired_link');
        }

        // Create verified user
        const userData = {
            userId: pendingUser.userId,
            name: pendingUser.name,
            firstName: pendingUser.firstName || '',
            lastName: pendingUser.lastName || '',
            mobile: pendingUser.mobile || '',
            city: pendingUser.city || '',
            email: pendingUser.email,
            password: pendingUser.password,
            role: 'user',
            suspended: false,
            verified: true,
            verifiedAt: new Date().toISOString(),
            createdAt: pendingUser.createdAt,
            preferences: {
                ltpDisplay: true,
                volumeDisplay: true,
                oiDisplay: true,
                greeksDisplay: false,
                mmiDisplay: false,
                theme: 'white'
            },
            sessions: []
        };

        saveUser(pendingUser.userId, userData);
        fs.unlinkSync(pendingFilePath);

        // Create session
        req.session.userId = userData.userId;
        req.session.userEmail = userData.email;
        req.session.userName = userData.name;
        req.session.userRole = 'user';
        req.session.userVerified = true;
        req.session.lastActive = Date.now();

        // Redirect to optionchain
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

        const user = findUserByEmail(email);
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

        // Record session
        const sessionId = crypto.randomBytes(16).toString('hex');
        if (!user.sessions) user.sessions = [];
        user.sessions.push({
            sessionId,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            userAgent: req.headers['user-agent']
        });
        user.lastLogin = new Date().toISOString();
        saveUser(user.userId, user);

        const userRole = user.role || 'user';
        req.session.userId = user.userId;
        req.session.userEmail = user.email;
        req.session.userName = user.name;
        req.session.userRole = userRole;
        req.session.userVerified = true;
        req.session.sessionId = sessionId;
        req.session.lastActive = Date.now();

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.userId,
                name: user.name,
                email: user.email,
                role: userRole,
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
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = findUserByEmail(email);
        // Always respond success to avoid user enumeration
        if (!user) {
            return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetToken = resetToken;
        user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
        saveUser(user.userId, user);

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

        // Find user by reset token
        let targetUser = null;
        const files = fs.readdirSync(USERS_DIR);
        for (const file of files) {
            const userData = JSON.parse(fs.readFileSync(path.join(USERS_DIR, file), 'utf8'));
            if (userData.resetToken === token) {
                targetUser = userData;
                break;
            }
        }

        if (!targetUser) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        if (new Date() > new Date(targetUser.resetTokenExpiry)) {
            return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
        }

        // Update password
        targetUser.password = await bcrypt.hash(newPassword, 10);
        delete targetUser.resetToken;
        delete targetUser.resetTokenExpiry;
        saveUser(targetUser.userId, targetUser);

        res.json({ success: true, message: 'Password updated successfully. Please sign in.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
});

// GET route for reset password link from email
// Redirects to auth.html with the token as a query param
router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    if (!token) return res.redirect('/auth.html');
    res.redirect(`/auth.html?reset_token=${token}`);
});

// ================================
// GET USER PREFERENCES
// ================================
router.get('/preferences', (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = readUser(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, preferences: user.preferences || {} });
    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

// ================================
// UPDATE USER PREFERENCES
// ================================
router.post('/preferences', (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const user = readUser(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.preferences = { ...user.preferences, ...req.body };
        saveUser(req.session.userId, user);

        res.json({ success: true, message: 'Preferences updated', preferences: user.preferences });
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
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const existingUser = findUserByEmail(email);
        if (existingUser && existingUser.verified) {
            return res.status(400).json({ error: 'Email already verified. Please sign in.' });
        }

        const pendingFilePath = getPendingUserFilePath(email);
        if (!fs.existsSync(pendingFilePath)) {
            return res.status(400).json({ error: 'No pending verification found. Please sign up.' });
        }

        const pendingUser = JSON.parse(fs.readFileSync(pendingFilePath, 'utf8'));

        if (verificationType === 'otp') {
            const otp = generateOTP();
            pendingUser.otp = otp;
            pendingUser.otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            fs.writeFileSync(pendingFilePath, JSON.stringify(pendingUser, null, 2));
            await sendOTPEmail(req, email, otp);
            res.json({ success: true, message: 'New OTP sent to your email' });
        } else {
            const verificationToken = crypto.randomBytes(32).toString('hex');
            pendingUser.verificationToken = verificationToken;
            pendingUser.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            fs.writeFileSync(pendingFilePath, JSON.stringify(pendingUser, null, 2));
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
router.get('/admin/users', requireAdminOrMember, (req, res) => {
    try {
        const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
        const users = files.map(file => {
            try {
                const u = JSON.parse(fs.readFileSync(path.join(USERS_DIR, file), 'utf8'));
                const photoPath = path.join(PHOTO_DIR, `${u.userId}.jpg`);
                return {
                    userId:    u.userId,
                    name:      u.name || '',
                    email:     u.email || '',
                    mobile:    u.mobile || '',
                    city:      u.city || '',
                    role:      u.role || 'user',
                    suspended: u.suspended || false,
                    verified:  u.verified || false,
                    createdAt: u.createdAt || null,
                    lastLogin: u.lastLogin || null,
                    hasPhoto:  fs.existsSync(photoPath),
                };
            } catch { return null; }
        }).filter(Boolean);

        // Sort by createdAt desc
        users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.json({ success: true, users });
    } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ error: 'Failed to list users' });
    }
});

// Update user role (admin only)
router.patch('/admin/users/:userId/role', requireAdmin, (req, res) => {
    try {
        const { role } = req.body;
        if (!['user', 'member', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
        const user = readUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.role = role;
        saveUser(req.params.userId, user);
        res.json({ success: true, message: `Role updated to ${role}` });
    } catch (err) {
        console.error('Update role error:', err);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// Suspend / unsuspend user (admin only)
router.patch('/admin/users/:userId/suspend', requireAdmin, (req, res) => {
    try {
        const user = readUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'Cannot suspend yourself' });
        user.suspended = !user.suspended;
        saveUser(req.params.userId, user);
        res.json({ success: true, suspended: user.suspended, message: user.suspended ? 'User suspended' : 'User unsuspended' });
    } catch (err) {
        console.error('Suspend user error:', err);
        res.status(500).json({ error: 'Failed to update suspension' });
    }
});

// ================================
// TRADING JOURNAL
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

// GET all journal entries
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

// ADD journal entry
router.post('/journal', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const { date, symbol, strategy, customStrategy, description, profit, loss } = req.body;
        if (!date || !symbol) return res.status(400).json({ error: 'Date and symbol are required' });

        const journal = readJournal(req.session.userId);
        const entry = {
            id: crypto.randomBytes(8).toString('hex'),
            date,
            symbol: symbol.toUpperCase(),
            strategy: strategy || 'Other',
            customStrategy: strategy === 'Other' ? (customStrategy || '') : '',
            description: description || '',
            profit: parseFloat(profit) || 0,
            loss: parseFloat(loss) || 0,
            createdAt: new Date().toISOString(),
        };
        journal.entries.unshift(entry); // newest first
        saveJournal(req.session.userId, journal);
        res.json({ success: true, entry });
    } catch (err) {
        console.error('Add journal error:', err);
        res.status(500).json({ error: 'Failed to add entry' });
    }
});

// DELETE journal entry
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
// PHOTO UPLOAD (multer config)
// ================================
const photoStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PHOTO_DIR),
    filename: (req, _file, cb) => cb(null, `${req.session.userId}.jpg`),
});
const photoUpload = multer({
    storage: photoStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
    fileFilter: (_req, file, cb) => {
        if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only JPEG/PNG/WEBP images are allowed'));
    },
});

// ================================
// GET PROFILE
// ================================
router.get('/profile', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
        const user = readUser(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const photoPath = path.join(PHOTO_DIR, `${req.session.userId}.jpg`);
        const hasPhoto  = fs.existsSync(photoPath);
        res.json({
            success: true,
            profile: {
                userId:    user.userId,
                name:      user.name || '',
                firstName: user.firstName || '',
                lastName:  user.lastName || '',
                email:     user.email || '',
                mobile:    user.mobile || '',
                city:      user.city || '',
                verified:  user.verified || false,
                createdAt: user.createdAt || null,
                lastLogin: user.lastLogin || null,
                hasPhoto,
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

        const user = readUser(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        saveUser(req.session.userId, user);
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
    photoUpload.single('photo')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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

module.exports = router;