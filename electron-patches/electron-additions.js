/**
 * ELECTRON.JS PATCH — Summit Claims Advisors
 * ============================================
 * These are the EXACT additions to make in your electron.js file.
 * Sections are labeled with WHERE to insert each block.
 *
 * Do NOT paste this whole file into electron.js.
 * Read each section header and insert it at the right spot.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ADD THESE REQUIRE STATEMENTS AT THE TOP OF electron.js
//             (after your existing requires)
// ═══════════════════════════════════════════════════════════════════════════════

const {
  initTwilio,
  alertNOSFound,
  scheduleDailyBriefing,
  startInboundWebhook
} = require('./bots/twilioService');

const {
  initRetell,
  callLead,
  startWebhook: startRetellWebhook
} = require('./bots/retellService');

const { initChatbot } = require('./bots/chatbotService');

const {
  BrowserPool,
  smartUpsert,
  filterNewCases,
  startMemoryMonitor
} = require('./bots/performanceUtils');

// Global browser pool — replace any direct puppeteer.launch() calls with this
const browserPool = new BrowserPool(2);


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — AFTER SETTINGS ARE LOADED (in your loadSettings / app.whenReady block)
//             Look for where you read twilioSid, twilioToken etc. from settings
//             and add this block RIGHT AFTER:
// ═══════════════════════════════════════════════════════════════════════════════

function initServicesFromSettings(settings) {
  // Twilio
  if (settings.twilioSid && settings.twilioToken) {
    initTwilio(
      settings.twilioSid,
      settings.twilioToken,
      settings.twilioFrom || '+19046898998',
      settings.myPhone
    );

    // Start inbound SMS webhook
    startInboundWebhook(3001, {
      getStatus: async () => {
        const pool = browserPool.stats();
        return `Bot running. Browsers: ${pool.inUse}/${pool.total} active.`;
      },
      getLeadCount: async () => {
        // Replace with your actual Supabase lead count call
        return 'Check app';
      },
      triggerScan: () => {
        // Replace with your actual scan trigger
        mainWindow?.webContents.send('trigger-scan', {});
      }
    });

    // Daily briefing at 8am
    scheduleDailyBriefing(async () => {
      // Replace with your actual Supabase queries
      return {
        hot_leads: '?',
        surplus_confirmed: '?',
        scanned_today: '?',
        outreach_sent: '?'
      };
    });
  }

  // Retell AI
  if (settings.retellApiKey && settings.retellAgentId) {
    initRetell(
      settings.retellApiKey,
      settings.retellAgentId,
      settings.retellPhoneNumberId
    );

    startRetellWebhook(3002, (event) => {
      // Forward Retell call events to the renderer
      mainWindow?.webContents.send('retell-call-event', event);

      // On call ended — update lead status
      if (event.event === 'call_ended' && event.data?.metadata?.case_number) {
        // updateLeadStatus(event.data.metadata.case_number, { call_status: event.data.call_status });
      }
    });
  }

  // Chatbot / Claude Agent
  initChatbot(settings, {
    getBotStatus: async (county) => {
      // Return your actual bot status here
      return { status: 'running', county: county || 'all' };
    },
    triggerScan: async (counties, priority) => {
      mainWindow?.webContents.send('trigger-scan', { counties, priority });
      return { queued: counties };
    }
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — CALL initServicesFromSettings IN app.whenReady
//             Find your app.whenReady() or app.on('ready') block.
//             After you load settings, add:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  app.whenReady().then(() => {
    const settings = loadSettings();   // your existing settings load

    initServicesFromSettings(settings); // <-- ADD THIS LINE

    createWindow();                    // your existing window creation
    startMemoryMonitor(400, 700);      // <-- ADD THIS LINE (auto clears cache if memory spikes)
  });
*/


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — ALERT ON EVERY LEAD SAVED TO SUPABASE
//             Find every place you insert a lead into Supabase and add
//             alertNOSFound(record) right after the insert succeeds:
// ═══════════════════════════════════════════════════════════════════════════════

/*
  // Example — your existing insert likely looks something like:
  const { data, error } = await supabase.from('hot_leads').insert(leadRecord).select().single();

  if (!error && data) {
    alertNOSFound(data);   // <-- ADD THIS LINE after every successful insert
  }
*/


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — IPC HANDLER: CALL A LEAD VIA RETELL
//             Add this IPC handler alongside your other ipcMain handlers:
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('retell:call-lead', async (event, { phone, leadData }) => {
  try {
    const result = await callLead(phone, leadData);
    return { success: true, call_id: result.call_id };
  } catch (err) {
    console.error('[Retell] Call failed:', err.message);
    return { success: false, error: err.message };
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — IPC HANDLER: RE-INIT SERVICES WHEN SETTINGS CHANGE
//             Add this alongside your existing settings IPC handlers:
// ═══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('settings:apply', async (event, newSettings) => {
  try {
    initServicesFromSettings(newSettings);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — PERFORMANCE: REPLACE puppeteer.launch() WITH browserPool
//             Anywhere in your bot files you have:
//               const browser = await puppeteer.launch({ ... });
//             Replace with:
//               const browser = await browserPool.acquire(puppeteer);
//             And after you're done with the browser:
//               browserPool.release(browser);
//             Or use the helper:
//               await browserPool.withBrowser(puppeteer, async (browser) => { ... });
//
//             Also wrap Supabase multi-record inserts with:
//               await smartUpsert(supabase, 'hot_leads', records, 'case_number');
//             This auto-skips duplicates and batches inserts efficiently.
// ═══════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — CLEAN UP ON QUIT
//             In your app.on('before-quit') or app.on('will-quit'):
// ═══════════════════════════════════════════════════════════════════════════════

/*
  app.on('before-quit', async () => {
    await browserPool.closeAll();
  });
*/
