// emailService/emailService.js
const nodemailer = require("nodemailer");

// Email configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "simplifyoptionchain@gmail.com",
        pass: "othahwvhporvufci"  // Gmail App Password
    }
});

/**
 * Returns the public base URL for email links.
 * Uses the browser's Origin header so the link always matches
 * whichever domain the user signed up from (soc.ai.in, simplifyoptionchain.in, etc.)
 */
function getBaseUrl(req) {
    // 1. Origin header — browser always sends this; works for all domains incl. localhost
    if (req.headers.origin) {
        return req.headers.origin.replace(/\/$/, '');
    }
    // 2. Referer — present on same-origin requests where Origin is omitted
    if (req.headers.referer) {
        try {
            const u = new URL(req.headers.referer);
            return `${u.protocol}//${u.host}`;
        } catch (_) {}
    }
    // 3. Reverse-proxy headers set by nginx (X-Forwarded-Proto / X-Forwarded-Host)
    const fwdProto = req.headers['x-forwarded-proto'];
    const fwdHost  = req.headers['x-forwarded-host'];
    if (fwdHost) {
        return `${fwdProto || 'https'}://${fwdHost}`;
    }
    // 4. Raw Host header + forwarded proto
    const host = req.headers.host;
    if (host) {
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        return `${proto}://${host}`;
    }
    // 5. Last resort: env variable
    return process.env.APP_URL || 'https://soc.ai.in';
}

/**
 * Send OTP verification email
 */
async function sendOTPEmail(req, email, otp) {
    try {
        const html = `
            <div style="background:#f3f5ff;padding:40px;font-family:Arial,sans-serif;border-radius:10px;">
                <div style="max-width:520px;margin:auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.1);">
                    
                    <h2 style="text-align:center;color:#ff6f00;font-size:24px;margin-bottom:25px;">
                        Verify Your Email
                    </h2>

                    <p style="font-size:16px;color:#444;line-height:1.6;">
                        Hi,<br><br>
                        Thank you for registering with <strong style="color:#ff6f00;">Simplify Option Chain</strong>.<br>
                        Use the OTP below to verify your email address:
                    </p>

                    <div style="text-align:center;margin:30px 0;">
                        <div style="background:#f8f9fa;border:2px dashed #ff6f00;padding:20px;border-radius:10px;display:inline-block;">
                            <div style="font-size:14px;color:#666;margin-bottom:10px;">Your OTP</div>
                            <div style="font-size:36px;font-weight:bold;color:#ff6f00;letter-spacing:8px;font-family:monospace;">
                                ${otp}
                            </div>
                        </div>
                    </div>

                    <p style="font-size:14px;color:#666;margin-top:25px;text-align:center;">
                        <strong style="color:#f44336;">⏰ This OTP will expire in 10 minutes</strong>
                    </p>

                    <p style="font-size:13px;color:#777;text-align:center;">
                        If you didn't create an account with us, please ignore this email.
                    </p>

                    <hr style="margin-top:30px;margin-bottom:20px;border:none;border-top:1px solid #eee;">

                    <div style="text-align:center;font-size:12px;color:#999;">
                        <p>
                            <strong>SOC Team</strong><br>
                            For any help, contact us:<br>
                            📱 Instagram: <a href="https://instagram.com/simplifyoptionchain.in" style="color:#ff6f00;">@simplifyoptionchain.in</a><br>
                            ✉️ Email: <a href="mailto:simplifyoptionchain@gmail.com" style="color:#ff6f00;">simplifyoptionchain@gmail.com</a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: `"Simplify Option Chain" <simplifyoptionchain@gmail.com>`,
            to: email,
            subject: "Your OTP – Verify Email – Simplify Option Chain",
            html: html
        });

        console.log(`✅ OTP email sent to ${email}`);
        return true;
    } catch (error) {
        console.error("❌ Error sending OTP email:", error);
        throw error;
    }
}

/**
 * Send verification link email
 */
async function sendVerificationEmail(req, email, token) {
    try {
        const baseUrl = getBaseUrl(req);
        const verifyLink = `${baseUrl}/api/auth/verify-email?token=${token}`;

        const html = `
            <div style="background:#f3f5ff;padding:40px;font-family:Arial,sans-serif;border-radius:10px;">
                <div style="max-width:520px;margin:auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.1);">
                    
                    <h2 style="text-align:center;color:#ff6f00;font-size:24px;margin-bottom:25px;">
                        Verify Your Email
                    </h2>

                    <p style="font-size:16px;color:#444;line-height:1.6;">
                        Hi,<br><br>
                        Thank you for registering with <strong style="color:#ff6f00;">Simplify Option Chain</strong>.<br>
                        To activate your account and access our advanced option chain tools, please click the button below:
                    </p>

                    <div style="text-align:center;margin:30px 0;">
                        <a href="${verifyLink}"
                           style="background:#ff6f00;color:white;padding:15px 35px;
                                  text-decoration:none;font-size:18px;border-radius:8px;
                                  font-weight:bold;display:inline-block;">
                            Verify Email Address
                        </a>
                    </div>

                    <p style="font-size:14px;color:#666;margin-top:25px;">
                        If the button above does not work, copy and paste the link below into your browser:
                    </p>

                    <div style="background:#f8f9fa;padding:12px;border-radius:6px;margin:15px 0;
                                border:1px solid #e9ecef;word-break:break-all;">
                        <a href="${verifyLink}" style="color:#ff6f00;text-decoration:none;">
                            ${verifyLink}
                        </a>
                    </div>

                    <p style="font-size:13px;color:#777;">
                        This link will expire in 24 hours. If you didn't create an account with us, please ignore this email.
                    </p>

                    <hr style="margin-top:30px;margin-bottom:20px;border:none;border-top:1px solid #eee;">

                    <div style="text-align:center;font-size:12px;color:#999;">
                        <p>
                            <strong>SOC Team</strong><br>
                            For any help, contact us:<br>
                            📱 Instagram: <a href="https://instagram.com/simplifyoptionchain.in" style="color:#ff6f00;">@simplifyoptionchain.in</a><br>
                            ✉️ Email: <a href="mailto:simplifyoptionchain@gmail.com" style="color:#ff6f00;">simplifyoptionchain@gmail.com</a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: `"Simplify Option Chain" <simplifyoptionchain@gmail.com>`,
            to: email,
            subject: "Verify Your Email – Simplify Option Chain",
            html: html
        });

        console.log(`✅ Verification email sent to ${email}`);
        return true;
    } catch (error) {
        console.error("❌ Error sending verification email:", error);
        throw error;
    }
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(req, email, token) {
    try {
        const baseUrl = getBaseUrl(req);
        const resetLink = `${baseUrl}/auth.html?reset_token=${token}`;

        const html = `
            <div style="background:#f3f5ff;padding:40px;font-family:Arial,sans-serif;border-radius:10px;">
                <div style="max-width:520px;margin:auto;background:white;padding:30px;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.1);">
                    
                    <h2 style="text-align:center;color:#ff6f00;font-size:24px;margin-bottom:25px;">
                        Reset Your Password
                    </h2>

                    <p style="font-size:16px;color:#444;line-height:1.6;">
                        Hi,<br><br>
                        We received a request to reset your password for your <strong style="color:#ff6f00;">Simplify Option Chain</strong> account.<br>
                        Click the button below to reset your password:
                    </p>

                    <div style="text-align:center;margin:30px 0;">
                        <a href="${resetLink}"
                           style="background:#ff6f00;color:white;padding:15px 35px;
                                  text-decoration:none;font-size:18px;border-radius:8px;
                                  font-weight:bold;display:inline-block;">
                            Reset Password
                        </a>
                    </div>

                    <p style="font-size:14px;color:#666;margin-top:25px;">
                        If the button above does not work, copy and paste the link below into your browser:
                    </p>

                    <div style="background:#f8f9fa;padding:12px;border-radius:6px;margin:15px 0;
                                border:1px solid #e9ecef;word-break:break-all;">
                        <a href="${resetLink}" style="color:#ff6f00;text-decoration:none;">
                            ${resetLink}
                        </a>
                    </div>

                    <p style="font-size:13px;color:#777;">
                        <strong>Important:</strong> This password reset link will expire in 1 hour.<br>
                        If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
                    </p>

                    <hr style="margin-top:30px;margin-bottom:20px;border:none;border-top:1px solid #eee;">

                    <div style="text-align:center;font-size:12px;color:#999;">
                        <p>
                            <strong>SOC Team</strong><br>
                            For any help, contact us:<br>
                            📱 Instagram: <a href="https://instagram.com/simplifyoptionchain.in" style="color:#ff6f00;">@simplifyoptionchain.in</a><br>
                            ✉️ Email: <a href="mailto:simplifyoptionchain@gmail.com" style="color:#ff6f00;">simplifyoptionchain@gmail.com</a>
                        </p>
                    </div>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: `"Simplify Option Chain" <simplifyoptionchain@gmail.com>`,
            to: email,
            subject: "Reset Your Password – Simplify Option Chain",
            html: html
        });

        console.log(`✅ Password reset email sent to ${email}`);
        return true;
    } catch (error) {
        console.error("❌ Error sending password reset email:", error);
        throw error;
    }
}

/**
 * Send Upstox OAuth authorization link to admin email
 */
async function sendUpstoxAuthEmail(adminEmail, authUrl, appName = 'Upstox App') {
    try {
        const mailOptions = {
            from: '"Simplify Option Chain" <simplifyoptionchain@gmail.com>',
            to: adminEmail,
            subject: `🔑 Upstox Token — ${appName} — Action Required`,
            html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10)">
        <tr><td style="background:#ff6f00;padding:28px 32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:0.5px">Simplify Option Chain</h1>
          <p style="margin:6px 0 0;color:#ffe0b2;font-size:13px">Admin Token Generation</p>
        </td></tr>
        <tr><td style="padding:32px">
          <h2 style="color:#333;font-size:18px;margin:0 0 14px">🔑 New Token Required — <span style="color:#ff6f00">${appName}</span></h2>
          <p style="color:#555;font-size:14px;line-height:1.6;margin:0 0 24px">
            A new Upstox access token needs to be generated for <b>${appName}</b>.<br>
            Click the button below to log in to Upstox and authorize the application.<br>
            The token will be <strong>automatically saved</strong> and activated immediately.
          </p>
          <div style="text-align:center;margin:28px 0">
            <a href="${authUrl}" style="display:inline-block;background:#ff6f00;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.3px">
              ✅ Approve &amp; Generate Token
            </a>
          </div>
          <p style="color:#888;font-size:12px;text-align:center;margin:0 0 8px">
            Or copy this link into your browser:
          </p>
          <p style="word-break:break-all;font-size:11px;color:#1565c0;text-align:center;margin:0 0 24px;background:#f0f4ff;padding:10px;border-radius:6px">
            ${authUrl}
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
          <p style="color:#aaa;font-size:11px;text-align:center;margin:0">
            This is an automated message from Simplify Option Chain server.<br>
            Do not share this link. It is valid for a single use.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
        };
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error("❌ Error sending Upstox auth email:", error);
        throw error;
    }
}

/**
 * Send one consolidated email with a SINGLE "Authorize All" button.
 * Clicking it chains through all apps one by one automatically.
 * @param {string} adminEmail
 * @param {Array<{slot:number, name:string, url:string}>} slots  (used only for app list display)
 * @param {string} startAllUrl  e.g. http://localhost:3000/api/admin/upstox-auth/start-all
 */
async function sendConsolidatedAuthEmail(adminEmail, slots, startAllUrl) {
    const appList = slots.map(({ name }) =>
        `<li style="margin:4px 0;color:#555;font-size:14px">${name}</li>`
    ).join('');

    const mailOptions = {
        from: '"Simplify Option Chain" <simplifyoptionchain@gmail.com>',
        to: adminEmail,
        subject: `🔑 Upstox Daily Token Renewal — ${slots.length} Apps`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10)">
        <tr><td style="background:#ff6f00;padding:24px 32px;text-align:center">
          <h1 style="margin:0;color:#fff;font-size:20px">Simplify Option Chain</h1>
          <p style="margin:6px 0 0;color:#ffe0b2;font-size:13px">Daily Upstox Token Renewal</p>
        </td></tr>
        <tr><td style="padding:32px">
          <h2 style="color:#333;font-size:17px;margin:0 0 12px">🔑 ${slots.length} App${slots.length > 1 ? 's' : ''} Need Authorization</h2>
          <p style="color:#555;font-size:14px;margin:0 0 16px;line-height:1.6">
            Click the button below once — it will walk you through each app automatically.<br>
            Each token is <strong>saved instantly</strong> after you approve on Upstox.
          </p>
          <ul style="margin:0 0 24px;padding-left:20px">${appList}</ul>
          <div style="text-align:center;margin:28px 0">
            <a href="${startAllUrl}" style="display:inline-block;background:#ff6f00;color:#fff;text-decoration:none;padding:15px 40px;border-radius:8px;font-size:17px;font-weight:700;letter-spacing:0.3px">
              🚀 Authorize All Apps
            </a>
          </div>
          <p style="color:#888;font-size:12px;text-align:center;margin:0 0 8px">
            Or copy this link into your browser:
          </p>
          <p style="word-break:break-all;font-size:11px;color:#1565c0;text-align:center;margin:0 0 24px;background:#f0f4ff;padding:10px;border-radius:6px">
            ${startAllUrl}
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
          <p style="color:#aaa;font-size:11px;text-align:center;margin:0">
            This is an automated daily email from Simplify Option Chain server.<br>
            Do not share this link.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    };
    await transporter.sendMail(mailOptions);
    return true;
}

module.exports = {
    sendOTPEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendUpstoxAuthEmail,
    sendConsolidatedAuthEmail,
};