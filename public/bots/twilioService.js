const twilio = require('twilio');
const http = require('http');

let client = null;
let cfg = {};
let alertsPaused = false;
let inboundServer = null;

function initTwilio(sid, token, from, myPhone) {
  cfg = { sid, token, from: from || '+19046898998', myPhone };
  client = twilio(sid, token);
  console.log('[Twilio] Initialized — from:', cfg.from, '→ to:', cfg.myPhone);
}

async function alertNOSFound(record) {
  if (!client) return console.warn('[Twilio] Not initialized — skipping NOS alert');
  if (alertsPaused) return;

  const body = [
    '🚨 NOS LEAD FOUND',
    `Name: ${record.owner_name || record.name || 'N/A'}`,
    `Address: ${record.property_address || record.address || 'N/A'}`,
    `County: ${record.county || 'N/A'}`,
    `Amount: $${record.surplus_amount || record.amount || 'N/A'}`,
    `Case #: ${record.case_number || 'N/A'}`,
    new Date().toLocaleString()
  ].join('\n');

  try {
    const msg = await client.messages.create({ body, from: cfg.from, to: cfg.myPhone });
    console.log('[Twilio] NOS alert sent — SID:', msg.sid);
    return msg;
  } catch (err) {
    console.error('[Twilio] NOS alert failed:', err.message);
  }
}

async function scheduleDailyBriefing(getLeadsSummary) {
  const fire = async () => {
    if (!client) return;
    try {
      const summary = getLeadsSummary ? await getLeadsSummary() : {};
      const body = [
        '📊 SUMMIT CLAIMS — DAILY BRIEFING',
        `Hot Leads: ${summary.hot_leads ?? '?'}`,
        `Surplus Confirmed: ${summary.surplus_confirmed ?? '?'}`,
        `Scanned Today: ${summary.scanned_today ?? '?'}`,
        `Outreach Sent: ${summary.outreach_sent ?? '?'}`,
        new Date().toLocaleDateString()
      ].join('\n');
      await client.messages.create({ body, from: cfg.from, to: cfg.myPhone });
      console.log('[Twilio] Daily briefing sent');
    } catch (err) {
      console.error('[Twilio] Daily briefing failed:', err.message);
    }
  };

  const schedule = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(8, 0, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    const delay = next - now;
    console.log(`[Twilio] Daily briefing scheduled in ${Math.round(delay / 60000)} min`);
    setTimeout(async () => { await fire(); setInterval(fire, 24 * 60 * 60 * 1000); }, delay);
  };

  schedule();
}

async function handleInboundSMS(msgBody, from, appCallbacks = {}) {
  const cmd = (msgBody || '').trim().toUpperCase();
  console.log(`[Twilio] Inbound SMS from ${from}: "${cmd}"`);

  if (cmd === 'STATUS') {
    const s = appCallbacks.getStatus ? await appCallbacks.getStatus() : 'Bot running.';
    return typeof s === 'string' ? s : JSON.stringify(s);
  }
  if (cmd === 'LEADS') {
    const n = appCallbacks.getLeadCount ? await appCallbacks.getLeadCount() : '?';
    return `Total hot leads: ${n}. Check app for details.`;
  }
  if (cmd === 'STOP') { alertsPaused = true; return 'Alerts paused. Reply START to resume.'; }
  if (cmd === 'START') { alertsPaused = false; return 'Alerts resumed.'; }
  if (cmd === 'SCAN') {
    if (appCallbacks.triggerScan) { appCallbacks.triggerScan(); return 'County scan triggered.'; }
    return 'Scan trigger not available.';
  }
  if (cmd === 'BRIEFING') {
    if (appCallbacks.getLeadsSummary) {
      const summary = await appCallbacks.getLeadsSummary();
      return `Leads: ${summary.hot_leads} hot, ${summary.surplus_confirmed} confirmed, ${summary.scanned_today} scanned today.`;
    }
    return 'Briefing data unavailable.';
  }
  return 'Commands: STATUS | LEADS | STOP | START | SCAN | BRIEFING';
}

function startInboundWebhook(port = 3001, appCallbacks = {}) {
  if (inboundServer) return console.log('[Twilio] Inbound webhook already running');

  inboundServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/sms') {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', async () => {
      try {
        const params = new URLSearchParams(raw);
        const msgBody = params.get('Body') || '';
        const from = params.get('From') || '';
        const reply = await handleInboundSMS(msgBody, from, appCallbacks);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml);
      } catch (err) {
        console.error('[Twilio] Webhook error:', err.message);
        res.writeHead(500); res.end();
      }
    });
  });

  inboundServer.listen(port, () =>
    console.log(`[Twilio] Inbound SMS webhook on http://localhost:${port}/sms`)
  );
}

function stopInboundWebhook() {
  if (inboundServer) { inboundServer.close(); inboundServer = null; }
}

module.exports = {
  initTwilio,
  alertNOSFound,
  scheduleDailyBriefing,
  handleInboundSMS,
  startInboundWebhook,
  stopInboundWebhook
};
