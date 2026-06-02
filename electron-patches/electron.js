const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs   = require('fs');
const isDev = !app.isPackaged;

// Remove the webdriver flag so Cloudflare / anti-bot systems treat hidden
// BrowserWindows (used by the skip tracer) as a regular Chrome visit.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Prevent Windows DWM from treating the frameless window as "exclusive fullscreen",
// which causes other-monitor windows to minimize. DirectComposition's fullscreen
// optimization is the trigger — disabling it keeps the window as a normal layered window.
app.commandLine.appendSwitch('disable-direct-composition');

const { startGmailAuth, getAuthClient, getInbox, getThread, sendReply, loadTokens, clearTokens,
        startGmailAuth2, getAuthClient2, loadTokens2, clearTokens2 } = require('./gmail');

const { runBot1 } = require('./bots/bot1');
const { runBot2 } = require('./bots/bot2');
const { runBot3 } = require('./bots/bot3');
const { runBot4 } = require('./bots/bot4');
const { runBot5 } = require('./bots/bot5');
const { runBot6 } = require('./bots/bot6');
const { runBot7 } = require('./bots/bot7');
const { runSkipTracer, testSingleAddress } = require('./bots/skipTracer');
const { runAuctionMonitor, runSinglePlatform } = require('./bots/auctionMonitor');
const { runLeadsScanner, runLeadsPlatform } = require('./bots/bot8');
const { runCourtScraper } = require('./bots/courtScraper');
const { runCountyRecordsScan, runSingleCountyScan, testCountyUrl, DEFAULT_COUNTIES, destroyCountyWindows } = require('./bots/countyRecords');

// ── New services ──────────────────────────────────────────────────────────────
const { initTwilio, alertNOSFound, scheduleDailyBriefing, startInboundWebhook } = require('./bots/twilioService');
const { initRetell, callLead, startWebhook: startRetellWebhook } = require('./bots/retellService');
const { initChatbot } = require('./bots/chatbotService');
const { startMemoryMonitor } = require('./bots/performanceUtils');

// ── Bot-1 bridge: runs the county records scanner and mirrors events to
//    bot:update so the Bot Terminal console and progress bar stay live ─────────
function makeBotBridge(realWin, botNum) {
  let totalQueued    = 0;
  let totalProcessed = 0;
  return {
    isDestroyed: () => realWin.isDestroyed(),
    webContents: {
      send(channel, data) {
        if (realWin.isDestroyed()) return;
        realWin.webContents.send(channel, data); // always forward original

        if (channel !== 'county:update') return;

        // Map county events → bot:update for Bot Terminal
        switch (data.type) {
          case 'status':
            if (data.status === 'running') {
              realWin.webContents.send('bot:update', { botNum, status: 'running', log: '[County Scanner] Scan started.' });
            } else if (data.status === 'complete') {
              realWin.webContents.send('bot:update', { botNum, status: 'complete', processed: totalProcessed, queued: 0, log: '[County Scanner] All counties complete.' });
            }
            break;
          case 'log':
            realWin.webContents.send('bot:update', { botNum, status: 'running', log: data.message });
            break;
          case 'total':
            totalQueued += (data.total || 0);
            realWin.webContents.send('bot:update', { botNum, status: 'running', queued: Math.max(0, totalQueued - totalProcessed) });
            break;
          case 'batch': {
            const n = (data.hotLeads?.length || 0) + (data.surplusLeads?.length || 0);
            totalProcessed += n;
            // SMS alert for every new hot lead found
            (data.hotLeads || []).forEach(lead => { try { alertNOSFound(lead); } catch {} });
            realWin.webContents.send('bot:update', { botNum, status: 'running', processed: totalProcessed, queued: Math.max(0, totalQueued - totalProcessed) });
            break;
          }
          case 'county-done':
            realWin.webContents.send('bot:update', {
              botNum, status: 'running', processed: totalProcessed,
              log: `[${data.countyName}] Done — ${data.openCount} future leads, ${data.closedCount} current leads`,
            });
            break;
          case 'county-error':
            realWin.webContents.send('bot:update', { botNum, status: 'running', log: `[${data.countyId}] ERROR: ${data.error}` });
            break;
          default: break;
        }
      }
    }
  };
}

async function runBot1AsCountyScanner(win, config, stopFlag) {
  const { supabaseUrl, supabaseKey, tracerfyKey } = config;

  // county configs passed as JSON string from renderer localStorage
  let countyConfigs = null;
  try {
    const raw = config.countyConfigs;
    if (raw) countyConfigs = JSON.parse(raw).filter(c => c.enabled !== false);
  } catch { countyConfigs = null; }
  if (!countyConfigs?.length) countyConfigs = DEFAULT_COUNTIES.filter(c => c.enabled !== false);

  const bridgedWin = makeBotBridge(win, 1);
  return runCountyRecordsScan(bridgedWin, { supabaseUrl, supabaseKey, tracerfyKey, countyConfigs }, stopFlag);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 680,
    minWidth: 1000,
    minHeight: 600,
    frame: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'MONEY PRINTER',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const buildIndex = path.join(__dirname, '../build/index.html');
  const useDevServer = isDev && !fs.existsSync(buildIndex);
  mainWindow.loadURL(
    useDevServer
      ? 'http://localhost:3000'
      : `file://${buildIndex}`
  );

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Prevent duplicate instances — second launch focuses the existing window instead
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();

    // Initialise all new services using saved settings
    const _settings = readSettingsFile();
    initServicesFromSettings(_settings);
    startMemoryMonitor(400, 700);

    // Global shortcut: Ctrl+Shift+G starts the county scan regardless of which window has focus
    globalShortcut.register('Ctrl+Shift+G', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const raw = await mainWindow.webContents.executeJavaScript(`
          JSON.stringify({
            supabaseUrl:  localStorage.getItem('mp_supabase_url')  || '',
            supabaseKey:  localStorage.getItem('mp_supabase_key')  || '',
            tracerfyKey:  localStorage.getItem('mp_tracerfy_key')  || '',
            anthropicKey: localStorage.getItem('mp_anthropic_key') || '',
            counties:     localStorage.getItem('mp_county_registry') || 'null',
          })
        `);
        const data = JSON.parse(raw);
        const config = {
          supabaseUrl:  data.supabaseUrl,
          supabaseKey:  data.supabaseKey,
          tracerfyKey:  data.tracerfyKey,
          anthropicKey: data.anthropicKey,
        };
        let countyConfigs = [];
        try { countyConfigs = (JSON.parse(data.counties) || DEFAULT_COUNTIES).filter(c => c.enabled !== false); } catch {}
        if (!countyConfigs.length) countyConfigs = DEFAULT_COUNTIES.filter(c => c.enabled !== false);
        for (const county of countyConfigs) _startCountyBot(county, config);
      } catch (e) { console.error('Shortcut scan start failed:', e); }
    });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWindow) createWindow(); });
}

/* ── Persistent settings (survives reinstalls) ── */
const SETTINGS_FILE = path.join(app.getPath('userData'), 'mp-settings.json');

function readSettingsFile() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

/* ── Service initialisation — called on startup and whenever settings are saved ── */
function initServicesFromSettings(s) {
  // Twilio SMS
  if (s.mp_twilio_sid && s.mp_twilio_token) {
    initTwilio(
      s.mp_twilio_sid,
      s.mp_twilio_token,
      s.mp_twilio_from || '+19046898998',
      s.mp_twilio_my_phone
    );
    startInboundWebhook(3001, {
      getStatus: () => `Bot running. County scanner: ${countyIsRunning ? 'active' : 'idle'}.`,
      getLeadCount: () => 'Check app for lead count.',
      triggerScan: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('trigger-scan', {});
      },
      getLeadsSummary: async () => ({
        hot_leads: '?', surplus_confirmed: '?', scanned_today: '?', outreach_sent: '?'
      })
    });
    scheduleDailyBriefing(async () => ({
      hot_leads: '?', surplus_confirmed: '?', scanned_today: '?', outreach_sent: '?'
    }));
  }

  // Retell AI voice calls
  if (s.mp_retell_api_key && s.mp_retell_agent_id) {
    initRetell(s.mp_retell_api_key, s.mp_retell_agent_id, s.mp_retell_phone_number_id || '');
    startRetellWebhook(3002, (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('retell-call-event', event);
    });
  }

  // Claude agent + support chatbot + remote control API
  initChatbot({
    claudeApiKey:        s.mp_anthropic_key,
    supabaseUrl:         s.mp_supabase_url,
    supabaseKey:         s.mp_supabase_anon_key,
    smtpUser:            s.mp_smtp_user,
    smtpPass:            s.mp_smtp_pass,
    remoteControlToken:  s.mp_remote_control_token,
    remoteControlPort:   s.mp_remote_control_port ? Number(s.mp_remote_control_port) : 3003,
  }, {
    mainWindow,
    getBotStatus: async (county) => ({
      countyRunning: countyIsRunning,
      botRunning,
      county: county || 'all'
    }),
    triggerScan: async (counties, priority) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('trigger-scan', { counties, priority });
      }
      return { queued: counties };
    }
  });
}

ipcMain.handle('settings:load', () => readSettingsFile());
ipcMain.handle('settings:save', (_, data) => {
  const existing = readSettingsFile();
  const merged = { ...existing, ...data };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  // Re-initialise services so new credentials take effect immediately
  try { initServicesFromSettings(merged); } catch (err) {
    console.error('[Settings] Service re-init failed:', err.message);
  }
  return true;
});

/* ── Window controls ── */
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win-close',    () => mainWindow?.close());

/* ── File dialog ── */
ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'xls', 'xlsx'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

/* ── Client file management ── */
function getClientDir(clientId) {
  const base = path.join(app.getPath('userData'), 'client-files', clientId);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

ipcMain.handle('files:copy', async (_, { clientId, srcPath }) => {
  const dir  = getClientDir(clientId);
  const name = path.basename(srcPath);
  const dest = path.join(dir, name);
  fs.copyFileSync(srcPath, dest);
  const stat = fs.statSync(dest);
  return { name, size: stat.size, addedAt: new Date().toISOString(), path: dest };
});

ipcMain.handle('files:list', async (_, { clientId }) => {
  const dir = getClientDir(clientId);
  return fs.readdirSync(dir).map((name) => {
    const fullPath = path.join(dir, name);
    const stat     = fs.statSync(fullPath);
    return { name, size: stat.size, addedAt: stat.birthtime.toISOString(), path: fullPath };
  });
});

ipcMain.handle('files:delete', async (_, { filePath }) => {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
});

ipcMain.on('files:open', (_, { filePath }) => {
  shell.openPath(filePath);
});

/* ── Resend email ── */
ipcMain.handle('email:send', async (_, { apiKey, from, to, subject, text }) => {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, text }),
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.message || `HTTP ${res.status}` };
    return { success: true, id: data.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/* ── Bot orchestration ── */
// Bot 1 = County Records Scanner (primary intelligence job)
// Bots 2-7 remain as downstream pipeline (skip trace, sort, email, etc.)
// Auction Monitor and Lead Scanner run ONLY from their own dedicated pages.
const botRunners = { 1: runBot1AsCountyScanner, 2: runBot2, 3: runBot3, 4: runBot4, 5: runBot5, 6: runBot6, 7: runBot7 };
const stopFlags  = { 1: { stopped: false }, 2: { stopped: false }, 3: { stopped: false }, 4: { stopped: false }, 5: { stopped: false }, 6: { stopped: false }, 7: { stopped: false } };
const botRunning = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false };

ipcMain.handle('bot:start', async (_, { botNum, config }) => {
  if (botRunning[botNum]) return { ok: false, error: 'Already running' };

  stopFlags[botNum]  = { stopped: false };
  botRunning[botNum] = true;

  // Run async — don't await so IPC returns immediately
  const runner = botRunners[botNum];
  if (!runner) return { ok: false, error: `No runner for bot ${botNum}` };

  runner(mainWindow, config || {}, stopFlags[botNum])
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bot:update', {
          botNum, status: 'error', log: `[Bot ${botNum}] Unhandled error: ${err.message}`,
        });
      }
    })
    .finally(() => {
      botRunning[botNum] = false;
    });

  return { ok: true };
});

ipcMain.handle('bot:stop', async (_, { botNum }) => {
  stopFlags[botNum].stopped = true;
  botRunning[botNum] = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:update', { botNum, status: 'idle', log: `[Bot ${botNum}] Stopped.` });
  }
  return { ok: true };
});

/* ── Skip Tracer ── */
let skipStopFlag  = { stopped: false };
let skipIsRunning = false;

ipcMain.handle('skip-tracer:start', async (_, { config }) => {
  if (skipIsRunning) return { ok: false, error: 'Already running' };
  skipStopFlag  = { stopped: false };
  skipIsRunning = true;

  runSkipTracer(mainWindow, config || {}, skipStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skip-tracer:update', {
          workerId: 0, status: 'error', message: `Skip Tracer error: ${err.message}`,
        });
      }
    })
    .finally(() => {
      skipIsRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skip-tracer:stopped');
      }
    });

  return { ok: true };
});

ipcMain.handle('skip-tracer:stop', async () => {
  skipStopFlag.stopped = true;
  return { ok: true };
});

let testStopFlag = { stopped: false };

ipcMain.handle('skip-tracer:test', async (_, { address, city, state, zip, tracerfyKey }) => {
  testStopFlag = { stopped: false };
  testSingleAddress(mainWindow, { address, city, state, zip, tracerfyKey }, testStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('skip-tracer:test-result', { error: err.message });
      }
    });
  return { ok: true };
});

ipcMain.handle('skip-tracer:test-stop', async () => {
  testStopFlag.stopped = true;
  return { ok: true };
});

/* ── Auction Monitor ── */
let auctionStopFlag  = { stopped: false };
let auctionIsRunning = false;
const platformStopFlags  = {};
const platformRunning    = {};

ipcMain.handle('auction:start', async (_, { config }) => {
  if (auctionIsRunning) return { ok: false, error: 'Already running' };
  auctionStopFlag  = { stopped: false };
  auctionIsRunning = true;

  runAuctionMonitor(mainWindow, config || {}, auctionStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auction:platform-update', {
          platform: 'all', status: 'error', log: `Auction Monitor error: ${err.message}`,
        });
      }
    })
    .finally(() => {
      auctionIsRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auction:stopped');
      }
    });

  return { ok: true };
});

ipcMain.handle('auction:stop', async () => {
  auctionStopFlag.stopped = true;
  return { ok: true };
});

ipcMain.handle('auction:platform-start', async (_, { platformId, config }) => {
  if (platformRunning[platformId]) return { ok: false, error: 'Already running' };
  platformStopFlags[platformId] = { stopped: false };
  platformRunning[platformId]   = true;

  runSinglePlatform(platformId, mainWindow, config || {}, platformStopFlags[platformId])
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auction:platform-update', {
          platform: platformId, status: 'error', log: `Error: ${err.message}`,
        });
      }
    })
    .finally(() => {
      platformRunning[platformId] = false;
    });

  return { ok: true };
});

ipcMain.handle('auction:platform-stop', async (_, { platformId }) => {
  if (platformStopFlags[platformId]) {
    platformStopFlags[platformId].stopped = true;
  }
  platformRunning[platformId] = false;
  return { ok: true };
});

/* ── Lead Scanner (Bot 8) ── */
let leadsStopFlag  = { stopped: false };
let leadsIsRunning = false;
const leadsPlatformStopFlags = {};
const leadsPlatformRunning   = {};
let   leadsSchedulerTimer    = null;
let   leadsSchedulerConfig   = {};

function runLeadsSchedulerTick() {
  if (leadsIsRunning) return;
  leadsStopFlag  = { stopped: false };
  leadsIsRunning = true;
  runLeadsScanner(mainWindow, leadsSchedulerConfig, leadsStopFlag)
    .catch(() => {})
    .finally(() => { leadsIsRunning = false; });
}

ipcMain.handle('leads:start', async (_, { config }) => {
  if (leadsIsRunning) return { ok: false, error: 'Already running' };
  leadsStopFlag  = { stopped: false };
  leadsIsRunning = true;
  runLeadsScanner(mainWindow, config || {}, leadsStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('leads:update', { platformId: 'all', status: 'error', log: `Error: ${err.message}` });
      }
    })
    .finally(() => {
      leadsIsRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('leads:done', {});
    });
  return { ok: true };
});

ipcMain.handle('leads:stop', async () => {
  leadsStopFlag.stopped = true;
  leadsIsRunning = false;
  return { ok: true };
});

ipcMain.handle('leads:platform-start', async (_, { platformId, config }) => {
  if (leadsPlatformRunning[platformId]) return { ok: false, error: 'Already running' };
  leadsPlatformStopFlags[platformId] = { stopped: false };
  leadsPlatformRunning[platformId]   = true;
  runLeadsPlatform(platformId, mainWindow, config || {}, leadsPlatformStopFlags[platformId])
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('leads:update', { platformId, status: 'error', log: `Error: ${err.message}` });
      }
    })
    .finally(() => {
      leadsPlatformRunning[platformId] = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('leads:update', {
          platformId, lastScanned: new Date().toISOString(),
        });
      }
    });
  return { ok: true };
});

ipcMain.handle('leads:platform-stop', async (_, { platformId }) => {
  if (leadsPlatformStopFlags[platformId]) leadsPlatformStopFlags[platformId].stopped = true;
  leadsPlatformRunning[platformId] = false;
  return { ok: true };
});

/* ── County Records (main lead engine) ── */
let countyStopFlag  = { stopped: false };
let countyIsRunning = false;
let countySchedulerTimer   = null;
let countySchedulerConfig  = {};

function runCountyTick() {
  if (countyIsRunning) return;
  countyStopFlag  = { stopped: false };
  countyIsRunning = true;
  runCountyRecordsScan(mainWindow, countySchedulerConfig, countyStopFlag)
    .catch(() => {}).finally(() => { countyIsRunning = false; });
}

ipcMain.handle('county:start', async (_, { config }) => {
  if (countyIsRunning) return { ok: false, error: 'Already running' };
  countyStopFlag  = { stopped: false };
  countyIsRunning = true;
  runCountyRecordsScan(mainWindow, config || {}, countyStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('county:update', { type: 'log', message: `[CountyRecords] Fatal: ${err.message}` });
        mainWindow.webContents.send('county:update', { type: 'status', status: 'error' });
      }
    })
    .finally(() => {
      countyIsRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('county:done', {});
    });
  return { ok: true };
});

ipcMain.handle('county:stop', async () => {
  countyStopFlag.stopped = true;
  countyIsRunning = false;
  return { ok: true };
});

ipcMain.on('county:captcha-done', (_, { countyId } = {}) => {
  // Handled directly by countyRecords.js listener
});

ipcMain.handle('county:schedule-set', async (_, { intervalDays, config }) => {
  if (countySchedulerTimer) { clearInterval(countySchedulerTimer); countySchedulerTimer = null; }
  if (intervalDays > 0) {
    countySchedulerConfig = config || {};
    countySchedulerTimer  = setInterval(runCountyTick, intervalDays * 24 * 60 * 60 * 1000);
    runCountyTick();
  }
  return { ok: true };
});

ipcMain.handle('county:test', async (_, { county }) => {
  testCountyUrl(mainWindow, county).catch(() => {});
  return { ok: true };
});

/* ── Per-county bot system (1 bot per county, scales to 50+) ─────────────────
 * Each county runs its own isolated scan with its own stop flag.
 * Auction Monitor and Lead Scanner are NOT triggered here — they live only
 * on their own dedicated pages.
 * ─────────────────────────────────────────────────────────────────────────── */
const countyBotRunning   = {};   // { countyId: boolean }
const countyBotStopFlags = {};   // { countyId: { stopped: boolean } }

function _startCountyBot(county, config) {
  const id = county?.id;
  if (!id || countyBotRunning[id]) return false;
  countyBotRunning[id]   = true;
  countyBotStopFlags[id] = { stopped: false };
  runSingleCountyScan(county, mainWindow, config || {}, countyBotStopFlags[id])
    .catch(err => {
      const suppressed = /destroyed/i.test(err.message) || countyBotStopFlags[id]?.stopped;
      if (!suppressed && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('county:update', { type: 'county-error', countyId: id, error: err.message });
      }
    })
    .finally(() => { countyBotRunning[id] = false; });
  return true;
}

ipcMain.handle('county-bot:start', async (_, { county, config }) => {
  const started = _startCountyBot(county, config);
  return started ? { ok: true } : { ok: false, error: `${county?.id} already running` };
});

ipcMain.handle('county-bot:stop', async (_, { countyId }) => {
  if (countyBotStopFlags[countyId]) countyBotStopFlags[countyId].stopped = true;
  countyBotRunning[countyId] = false;
  destroyCountyWindows(countyId);
  // Nuclear fallback: kill any county bot window that slipped through the registry
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== mainWindow && w._countyBotWin && !w.isDestroyed()) {
      try { w.destroy(); } catch {}
    }
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('county:update', {
      type: 'county-idle', countyId,
    });
  }
  return { ok: true };
});

ipcMain.handle('county-bot:start-all', async (_, { counties, config }) => {
  if (!Array.isArray(counties)) return { ok: false, error: 'counties must be an array' };
  let started = 0;
  for (const county of counties) {
    if (_startCountyBot(county, config)) started++;
  }
  return { ok: true, started };
});

ipcMain.handle('county-bot:stop-all', async () => {
  for (const id of Object.keys(countyBotStopFlags)) {
    countyBotStopFlags[id].stopped = true;
    countyBotRunning[id] = false;
    destroyCountyWindows(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('county:update', { type: 'county-idle', countyId: id });
    }
  }
  // Nuclear fallback: kill any county bot window that slipped through the registry
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== mainWindow && w._countyBotWin && !w.isDestroyed()) {
      try { w.destroy(); } catch {}
    }
  });
  return { ok: true };
});

/* ── Court Records Scraper ── */
let courtStopFlag  = { stopped: false };
let courtIsRunning = false;

ipcMain.handle('court:start', async (_, { config }) => {
  if (courtIsRunning) return { ok: false, error: 'Already running' };
  courtStopFlag  = { stopped: false };
  courtIsRunning = true;

  runCourtScraper(mainWindow, config || {}, courtStopFlag)
    .catch((err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('court:update', {
          type: 'log', message: `[Court] Fatal error: ${err.message}`,
        });
        mainWindow.webContents.send('court:update', { type: 'status', status: 'error' });
      }
    })
    .finally(() => {
      courtIsRunning = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('court:done', {});
      }
    });

  return { ok: true };
});

ipcMain.handle('court:stop', async () => {
  courtStopFlag.stopped = true;
  courtIsRunning = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('court:update', { type: 'status', status: 'idle' });
  }
  return { ok: true };
});

// Fired when user has solved the CAPTCHA and clicks Resume
ipcMain.on('court:captcha-done', (_, { countyId } = {}) => {
  // The courtScraper listens to this directly via ipcMain.on — nothing extra needed here
});

/* ── Gmail Inbox ── */
ipcMain.handle('gmail:auth-start', async (_, { clientId, clientSecret }) => {
  try {
    await startGmailAuth(clientId, clientSecret, mainWindow);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail:disconnect', async () => {
  clearTokens();
  return { success: true };
});

ipcMain.handle('gmail:status', async (_, { clientId, clientSecret }) => {
  const saved = loadTokens();
  return { connected: !!(saved?.tokens?.access_token || saved?.tokens?.refresh_token) };
});

ipcMain.handle('gmail:get-inbox', async (_, { clientId, clientSecret }) => {
  try {
    const auth = await getAuthClient(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated. Connect Gmail in Settings.' };
    const threads = await getInbox(auth);
    return { success: true, threads };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail:get-thread', async (_, { clientId, clientSecret, threadId }) => {
  try {
    const auth = await getAuthClient(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated.' };
    const messages = await getThread(auth, threadId);
    return { success: true, messages };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail:send-reply', async (_, { clientId, clientSecret, to, subject, body, threadId, inReplyTo, references }) => {
  try {
    const auth = await getAuthClient(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated.' };
    await sendReply(auth, { to, subject, body, threadId, inReplyTo, references });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/* ── Gmail — info@summitclaimsadvisors.com (second account) ── */
ipcMain.handle('gmail2:auth-start', async (_, { clientId, clientSecret }) => {
  try {
    await startGmailAuth2(clientId, clientSecret, mainWindow);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail2:disconnect', async () => {
  clearTokens2();
  return { success: true };
});

ipcMain.handle('gmail2:status', async () => {
  const saved = loadTokens2();
  return { connected: !!(saved?.tokens?.access_token || saved?.tokens?.refresh_token) };
});

ipcMain.handle('gmail2:get-inbox', async (_, { clientId, clientSecret }) => {
  try {
    const auth = await getAuthClient2(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated. Connect info@ Gmail in Settings.' };
    const threads = await getInbox(auth);
    return { success: true, threads };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail2:get-thread', async (_, { clientId, clientSecret, threadId }) => {
  try {
    const auth = await getAuthClient2(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated.' };
    const messages = await getThread(auth, threadId);
    return { success: true, messages };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('gmail2:send-reply', async (_, { clientId, clientSecret, to, subject, body, threadId, inReplyTo, references }) => {
  try {
    const auth = await getAuthClient2(clientId, clientSecret);
    if (!auth) return { success: false, error: 'Not authenticated.' };
    await sendReply(auth, { to, subject, body, threadId, inReplyTo, references });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/* ── Enable or disable the auto-scanner. intervalHours=0 means disable. Default interval = 6h. ── */
ipcMain.handle('leads:schedule-set', async (_, { intervalHours, config }) => {
  if (leadsSchedulerTimer) {
    clearInterval(leadsSchedulerTimer);
    leadsSchedulerTimer = null;
  }
  const hrs = (intervalHours && intervalHours > 0) ? intervalHours : 0;
  if (hrs > 0) {
    leadsSchedulerConfig = config || {};
    leadsSchedulerTimer  = setInterval(runLeadsSchedulerTick, hrs * 60 * 60 * 1000);
    // Fire one scan immediately when first enabled
    runLeadsSchedulerTick();
  }
  return { ok: true };
});

/* ── Retell AI — call a lead directly from the app ── */
ipcMain.handle('retell:call-lead', async (_, { phone, leadData }) => {
  try {
    const result = await callLead(phone, leadData);
    return { success: true, call_id: result.call_id };
  } catch (err) {
    console.error('[Retell] Call failed:', err.message);
    return { success: false, error: err.message };
  }
});
