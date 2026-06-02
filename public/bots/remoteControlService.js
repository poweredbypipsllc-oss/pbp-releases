/**
 * Remote Control Service — Summit Claims Advisors
 *
 * Two channels for controlling the app from anywhere:
 *
 * 1. SMS REMOTE CONTROL
 *    Text any message to your Twilio number (+19046898998).
 *    If it's not a fixed command (STATUS/LEADS/etc.), it goes straight
 *    to Claude. Claude has full tool access and texts you back the result.
 *    Example: "show me the 5 newest leads in Duval" → Claude queries Supabase → SMS reply
 *
 * 2. HTTP REMOTE API (port 3003)
 *    POST http://localhost:3003/remote
 *    Body: { "message": "...", "session": "optional-id", "token": "your-secret" }
 *    Response: { "text": "...", "session": "...", "usage": { ... } }
 *    Expose via ngrok/Cloudflare tunnel for true remote access.
 *
 * Sessions are isolated per channel — SMS from your phone keeps its own
 * conversation context separate from the in-app chatbot.
 */

const http = require('http');
const { chatWithSession, clearSession, listSessions } = require('./claudeAgent');

const SMS_SYSTEM_PROMPT = `You are the Summit Claims Advisors AI, responding to a remote SMS command from Sumeet.
You have full access to the leads database, bot status, and can take any action.
Keep responses concise and SMS-friendly — under 1200 characters when possible.
When showing leads, show max 5 at a time with only key fields (name, address, amount, case #).
Format cleanly. No markdown — plain text only for SMS.`;

const API_SYSTEM_PROMPT = `You are the Summit Claims Advisors AI, responding to a remote API command.
You have full access to the leads database, bot status, and can take any action on Sumeet's behalf.
Be thorough. You may use markdown formatting. Caller has full authorization.`;

let cfg = {
  authToken: null,
  maxSmsLength: 1500
};

let remoteServer = null;
let lastActivity = {};
let commandCount = 0;
let mainWindowRef = null;

function initRemoteControl(options = {}) {
  cfg.authToken = options.authToken || null;
  cfg.maxSmsLength = options.maxSmsLength || 1500;
  mainWindowRef = options.mainWindow || null;
  console.log('[RemoteControl] Initialized — HTTP auth:', cfg.authToken ? 'enabled' : 'disabled');
}

// ─── SMS Remote Control ───────────────────────────────────────────────────────

const FIXED_COMMANDS = new Set(['STATUS', 'LEADS', 'STOP', 'START', 'SCAN', 'BRIEFING']);

async function handleRemoteSMS(msgBody, fromPhone) {
  const trimmed = (msgBody || '').trim();
  const upper = trimmed.toUpperCase();

  // Let fixed commands pass through to twilioService handler unchanged
  if (FIXED_COMMANDS.has(upper)) return null;

  // RESET clears this phone's session
  if (upper === 'RESET') {
    clearSession(`sms:${fromPhone}`);
    return 'Session reset. Ready for commands. Try: "show me latest leads" or "what is running right now?"';
  }

  // SESSIONS shows active remote sessions (admin command)
  if (upper === 'SESSIONS') {
    const s = listSessions();
    return `Active sessions: ${s.length}\n${s.map(x => `${x.sessionId} (${x.messageCount} msgs)`).join('\n')}`;
  }

  // Everything else → Claude
  const sessionId = `sms:${fromPhone}`;
  commandCount++;
  lastActivity[sessionId] = { timestamp: new Date().toISOString(), command: trimmed.slice(0, 80) };

  // Notify in-app UI that a remote command arrived
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('remote-control:activity', {
      channel: 'sms',
      session: sessionId,
      message: trimmed.slice(0, 80),
      timestamp: lastActivity[sessionId].timestamp
    });
  }

  try {
    console.log(`[RemoteControl] SMS command from ${fromPhone}: "${trimmed.slice(0, 60)}"`);
    const result = await chatWithSession(sessionId, trimmed, {
      systemOverride: SMS_SYSTEM_PROMPT,
      maxTokens: 1024
    });

    let reply = result.text || 'Done.';

    // Trim to SMS limit
    if (reply.length > cfg.maxSmsLength) {
      reply = reply.substring(0, cfg.maxSmsLength - 60) +
        `\n...(${reply.length - (cfg.maxSmsLength - 60)} chars cut)\nReply CONT for more.`;
    }

    // Notify UI with the response
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('remote-control:activity', {
        channel: 'sms',
        session: sessionId,
        response: reply.slice(0, 120),
        timestamp: new Date().toISOString()
      });
    }

    return reply;
  } catch (err) {
    console.error('[RemoteControl] SMS Claude error:', err.message);
    return `Error: ${err.message}. Reply RESET to start fresh.`;
  }
}

// ─── HTTP Remote API ──────────────────────────────────────────────────────────

function startRemoteAPI(port = 3003) {
  if (remoteServer) {
    console.log('[RemoteControl] HTTP API already running');
    return;
  }

  remoteServer = http.createServer((req, res) => {
    // CORS for local tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'GET' && req.url === '/remote/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        sessions: listSessions(),
        commandCount,
        lastActivity
      }));
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/remote/history/')) {
      const sessionId = decodeURIComponent(req.url.replace('/remote/history/', ''));
      if (!authenticate(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      const { getHistory } = require('./claudeAgent');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId, history: getHistory() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/remote/clear') {
      if (!authenticate(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { session = 'app' } = body ? JSON.parse(body) : {};
          clearSession(session);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ cleared: true, session }));
        } catch { res.writeHead(400); res.end(); }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/remote') {
      if (!authenticate(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }

      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
        }

        const { message, session = 'api:default', stream = false } = parsed;
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'message is required' })); return;
        }

        commandCount++;
        lastActivity[session] = { timestamp: new Date().toISOString(), command: message.slice(0, 80) };
        console.log(`[RemoteControl] HTTP command — session "${session}": "${message.slice(0, 60)}"`);

        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('remote-control:activity', {
            channel: 'http',
            session,
            message: message.slice(0, 80),
            timestamp: lastActivity[session].timestamp
          });
        }

        if (stream) {
          // Server-sent events streaming
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          try {
            const { chatStreamWithSession } = require('./claudeAgent');
            for await (const chunk of chatStreamWithSession(session, message, { systemOverride: API_SYSTEM_PROMPT })) {
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              if (chunk.type === 'done') break;
            }
          } catch (err) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
          }
          res.end();
        } else {
          try {
            const result = await chatWithSession(session, message, { systemOverride: API_SYSTEM_PROMPT });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text: result.text, session, usage: result.usage }));
          } catch (err) {
            console.error('[RemoteControl] HTTP Claude error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      });
      return;
    }

    res.writeHead(404); res.end('Not found');
  });

  remoteServer.listen(port, () =>
    console.log(`[RemoteControl] HTTP API on http://localhost:${port}/remote`)
  );
}

function authenticate(req) {
  if (!cfg.authToken) return true;
  const authHeader = req.headers['authorization'] || '';
  const queryToken = new URL(`http://x${req.url}`).searchParams.get('token');
  return authHeader === `Bearer ${cfg.authToken}` || queryToken === cfg.authToken;
}

function stopRemoteAPI() {
  if (remoteServer) { remoteServer.close(); remoteServer = null; }
}

function getStats() {
  return {
    commandCount,
    activeSessions: listSessions(),
    lastActivity,
    httpRunning: !!remoteServer
  };
}

module.exports = {
  initRemoteControl,
  handleRemoteSMS,
  startRemoteAPI,
  stopRemoteAPI,
  getStats
};
