/**
 * Summit Claims Advisors — Full Agent Chatbot Service
 *
 * Drop-in replacement for the existing limited chatbot.
 * Runs in Electron main process. Exposes IPC handlers.
 * Uses claudeAgent.js for all AI operations.
 */

const { ipcMain } = require('electron');
const {
  initClaudeAgent,
  chat,
  chatStream,
  clearHistory,
  getHistory
} = require('./claudeAgent');
const { initSMTP, sendSingle } = require('./smtpService');

let initialized = false;

/**
 * Call this from electron.js after loading settings.
 * settings = { claudeApiKey, supabaseUrl, supabaseKey, smtpUser, smtpPass, ... }
 */
function initChatbot(settings, appCallbacks = {}) {
  if (!settings.claudeApiKey) {
    console.warn('[Chatbot] No Claude API key — chatbot will not function');
    return;
  }

  initClaudeAgent(
    settings.claudeApiKey,
    settings.supabaseUrl,
    settings.supabaseKey,
    {
      getBotStatus: appCallbacks.getBotStatus,
      triggerScan: appCallbacks.triggerScan,
      sendEmail: async (to, subject, body, replyTo) => {
        if (!initialized) return { error: 'SMTP not ready' };
        return sendSingle(to, subject, body, replyTo);
      },
      ...appCallbacks
    }
  );

  if (settings.smtpUser && settings.smtpPass) {
    initSMTP(settings.smtpUser, settings.smtpPass);
  }

  registerIPCHandlers();
  initialized = true;
  console.log('[Chatbot] Full agent chatbot initialized');
}

function registerIPCHandlers() {
  // ── Non-streaming chat ─────────────────────────────────────────────────────
  ipcMain.handle('chatbot:send', async (event, payload) => {
    const { message, imageData, useThinking } = payload;
    try {
      const result = await chat(message, { imageData, useThinking });
      return { success: true, text: result.text, usage: result.usage };
    } catch (err) {
      console.error('[Chatbot] chat error:', err.message);
      return {
        success: false,
        error: getUserFacingError(err),
        text: `Sorry, I ran into an error: ${getUserFacingError(err)}`
      };
    }
  });

  // ── Streaming chat ─────────────────────────────────────────────────────────
  ipcMain.on('chatbot:stream', async (event, payload) => {
    const { message, imageData } = payload;
    const sender = event.sender;

    try {
      for await (const chunk of chatStream(message, { imageData })) {
        if (!sender.isDestroyed()) {
          sender.send('chatbot:stream:chunk', chunk);
        } else {
          break;
        }
      }
    } catch (err) {
      console.error('[Chatbot] stream error:', err.message);
      if (!sender.isDestroyed()) {
        sender.send('chatbot:stream:chunk', {
          type: 'error',
          error: getUserFacingError(err)
        });
      }
    }
  });

  // ── Clear history ──────────────────────────────────────────────────────────
  ipcMain.handle('chatbot:clear', () => {
    clearHistory();
    return { success: true };
  });

  // ── Get history ────────────────────────────────────────────────────────────
  ipcMain.handle('chatbot:history', () => {
    return { history: getHistory() };
  });

  // ── Status ─────────────────────────────────────────────────────────────────
  ipcMain.handle('chatbot:status', () => {
    return { initialized, model: 'claude-sonnet-4-6', historyLength: getHistory().length };
  });

  console.log('[Chatbot] IPC handlers registered');
}

function getUserFacingError(err) {
  if (err.status === 429) return 'Rate limit reached — please wait a moment and try again.';
  if (err.status === 401) return 'API key invalid — check your Claude API key in Settings.';
  if (err.status === 500) return 'Claude API error — please try again.';
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') return 'Network error — check your internet connection.';
  return err.message || 'Unknown error';
}

module.exports = { initChatbot };
