const nodemailer = require('nodemailer');

let transporter = null;
let cfg = {};
const RATE_LIMIT_MS = 1500;

function initSMTP(user, pass) {
  cfg = { user, pass };
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    rateLimit: 14
  });
  console.log('[SMTP] Initialized —', user);
}

async function verifyConnection() {
  if (!transporter) throw new Error('[SMTP] Not initialized');
  return transporter.verify();
}

async function sendSingle(to, subject, html, replyTo = null) {
  if (!transporter) throw new Error('[SMTP] Not initialized');
  const mail = {
    from: `"Summit Claims Advisors" <${cfg.user}>`,
    to,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  };
  if (replyTo) mail.replyTo = replyTo;
  const result = await transporter.sendMail(mail);
  console.log('[SMTP] Sent to:', to, '— Message-ID:', result.messageId);
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendMassOutreach(recipients, subject, buildHtml, onProgress) {
  if (!transporter) throw new Error('[SMTP] Not initialized');
  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];

    if (!r.email || !r.email.includes('@')) {
      results.skipped++;
      if (onProgress) onProgress({ index: i, total: recipients.length, email: r.email, status: 'skipped', ...results });
      continue;
    }

    try {
      const html = typeof buildHtml === 'function' ? buildHtml(r) : buildHtml;
      const subj = typeof subject === 'function' ? subject(r) : subject;
      await transporter.sendMail({
        from: `"Summit Claims Advisors" <${cfg.user}>`,
        to: r.email,
        replyTo: 'support@summitclaimsadvisors.com',
        subject: subj,
        html,
        text: html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      });
      results.sent++;
      if (onProgress) onProgress({ index: i, total: recipients.length, email: r.email, status: 'sent', ...results });
    } catch (err) {
      results.failed++;
      results.errors.push({ email: r.email, error: err.message });
      console.error('[SMTP] Failed to send to', r.email, ':', err.message);
      if (onProgress) onProgress({ index: i, total: recipients.length, email: r.email, status: 'failed', error: err.message, ...results });
    }

    if (i < recipients.length - 1) await sleep(RATE_LIMIT_MS);
  }

  console.log(`[SMTP] Mass outreach complete — sent:${results.sent} failed:${results.failed} skipped:${results.skipped}`);
  return results;
}

function buildNOSEmail(lead) {
  const name = lead.owner_name || lead.name || 'Property Owner';
  const address = lead.property_address || lead.address || '';
  const county = lead.county || '';
  const amount = Number(lead.surplus_amount || lead.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;color:#222}
  .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .hdr{background:#1a3c5e;padding:28px 32px;text-align:center}
  .hdr h1{color:#fff;font-size:22px;font-weight:700;letter-spacing:.5px}
  .hdr p{color:#a8c4e0;font-size:13px;margin-top:4px}
  .body{padding:32px}
  .amount{font-size:36px;font-weight:800;color:#1a3c5e;margin:20px 0}
  .prop{background:#f0f5fa;border-left:4px solid #1a3c5e;padding:14px 18px;border-radius:0 6px 6px 0;margin:18px 0;font-size:14px;line-height:1.7}
  .cta{display:inline-block;background:#1a3c5e;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;margin-top:20px}
  .steps{margin:24px 0}
  .steps li{padding:6px 0;font-size:14px;line-height:1.6;list-style:none;padding-left:24px;position:relative}
  .steps li:before{content:"✓";position:absolute;left:0;color:#1a3c5e;font-weight:700}
  .footer{background:#f5f5f5;padding:16px 32px;font-size:11px;color:#999;text-align:center;border-top:1px solid #eee}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Summit Claims Advisors</h1>
    <p>Unclaimed Surplus Fund Recovery</p>
  </div>
  <div class="body">
    <p>Dear ${name},</p>
    <p style="margin-top:14px;line-height:1.7">Our records show that <strong>unclaimed surplus funds</strong> from a foreclosure proceeding may be owed to you for the property at:</p>
    <div class="prop">
      <strong>${address}</strong><br>
      ${county} County
    </div>
    <p>Estimated recoverable amount:</p>
    <div class="amount">${amount}</div>
    <p style="line-height:1.7">These funds are held by the court and will be forfeited if not claimed. Our firm recovers these funds with:</p>
    <ul class="steps">
      <li>No upfront cost — we only collect a fee upon successful recovery</li>
      <li>Full legal representation and case filing on your behalf</li>
      <li>Most cases resolved within 60–90 days</li>
    </ul>
    <p style="margin-top:20px">Reply to this email or click below to begin the claim process:</p>
    <a href="mailto:support@summitclaimsadvisors.com?subject=Claim%20Inquiry%20%E2%80%94%20${encodeURIComponent(address)}" class="cta">Claim My Funds Now</a>
  </div>
  <div class="footer">
    Summit Claims Advisors &nbsp;|&nbsp; info@summitclaimsadvisors.com<br>
    To unsubscribe from future notices, reply with UNSUBSCRIBE.
  </div>
</div>
</body>
</html>`;
}

function buildFollowUpEmail(lead, followUpNum = 2) {
  const name = lead.owner_name || lead.name || 'Property Owner';
  const address = lead.property_address || lead.address || '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#222;line-height:1.7}
  .sig{margin-top:32px;border-top:1px solid #eee;padding-top:16px;font-size:13px;color:#555}
</style></head>
<body>
  <p>Hi ${name},</p>
  <p>I wanted to follow up regarding the unclaimed surplus funds associated with your property at <strong>${address}</strong>.</p>
  <p>These funds are still available for recovery, but there are deadlines that could result in permanent forfeiture. I'd hate for you to lose what's rightfully yours.</p>
  <p>If you have any questions or would like to get started, simply reply to this email. It takes less than 10 minutes to initiate a claim.</p>
  <div class="sig">
    Sumeet<br>
    Summit Claims Advisors<br>
    support@summitclaimsadvisors.com
  </div>
</body>
</html>`;
}

module.exports = {
  initSMTP,
  verifyConnection,
  sendSingle,
  sendMassOutreach,
  buildNOSEmail,
  buildFollowUpEmail
};
