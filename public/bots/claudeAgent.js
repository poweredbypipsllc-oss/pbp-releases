const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8096;
const THINKING_BUDGET = 10000;
const MAX_HISTORY = 40;
const MAX_RETRIES = 3;

let anthropic = null;
let supabase = null;
let appCallbacks = {};

// Multi-session history — keyed by sessionId
// 'app' = in-app chatbot, 'sms:<phone>' = remote SMS, 'api:<id>' = remote HTTP
const sessions = new Map();

function getSessionHistory(sessionId = 'app') {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

function trimSession(sessionId = 'app') {
  const history = getSessionHistory(sessionId);
  if (history.length > MAX_HISTORY) {
    sessions.set(sessionId, history.slice(-MAX_HISTORY));
  }
}

function clearSession(sessionId = 'app') {
  sessions.delete(sessionId);
  console.log('[ClaudeAgent] Session cleared:', sessionId);
}

function clearAllSessions() {
  sessions.clear();
  console.log('[ClaudeAgent] All sessions cleared');
}

function listSessions() {
  return Array.from(sessions.entries()).map(([id, history]) => ({
    sessionId: id,
    messageCount: history.length,
    lastActivity: history.length > 0 ? new Date().toISOString() : null
  }));
}

const SYSTEM_PROMPT = `You are the Summit Claims Advisors AI assistant — Sumeet's second-in-command and full operational partner.

You have UNRESTRICTED access to:
- The complete leads database (hot_leads + surplus_confirmed tables in Supabase)
- Real-time bot scan status for all counties
- Outreach history and email stats
- County scan trigger — you can start scans
- Lead status updates — you can update any lead record
- Email sending via SMTP

You are a business intelligence agent. When asked for data, retrieve it immediately. When asked to take action, take it.
Be direct, concise, and accurate. You run the back office for Summit Claims Advisors.
Format data cleanly — use tables or lists when showing multiple records.
Never say you "can't" access something — you have full access. Just use the right tool.`;

function initClaudeAgent(apiKey, supabaseUrl, supabaseKey, callbacks = {}) {
  anthropic = new Anthropic({ apiKey });
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  appCallbacks = callbacks;
  console.log('[ClaudeAgent] Initialized — model:', MODEL);
}

const TOOLS = [
  {
    name: 'get_leads',
    description: 'Query hot_leads or surplus_confirmed table from Supabase. Supports filters, sorting, and limits.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['hot_leads', 'surplus_confirmed'], description: 'Which table to query' },
        filters: { type: 'object', description: 'Key-value filters e.g. {"county": "Duval", "outreach_status": "pending"}' },
        limit: { type: 'number', description: 'Max records to return, default 20' },
        order_by: { type: 'string', description: 'Column to sort by, default created_at' },
        ascending: { type: 'boolean', description: 'Sort ascending (default false = newest first)' },
        search: { type: 'string', description: 'Full text search across name/address fields' }
      },
      required: ['table']
    }
  },
  {
    name: 'get_lead_detail',
    description: 'Get full details for a specific lead by case number or record ID.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['hot_leads', 'surplus_confirmed'], default: 'hot_leads' },
        case_number: { type: 'string', description: 'Case number to look up' },
        id: { type: 'string', description: 'Record UUID' }
      }
    }
  },
  {
    name: 'get_bot_status',
    description: 'Get current scan status for all counties — running, queued, completed, errored.',
    input_schema: {
      type: 'object',
      properties: {
        county: { type: 'string', description: 'Specific county name, or omit for all counties' }
      }
    }
  },
  {
    name: 'trigger_scan',
    description: 'Start a county scan for one or more counties.',
    input_schema: {
      type: 'object',
      properties: {
        counties: { type: 'array', items: { type: 'string' }, description: 'County names to scan' },
        priority: { type: 'string', enum: ['normal', 'high'], default: 'normal' }
      },
      required: ['counties']
    }
  },
  {
    name: 'update_lead_status',
    description: 'Update any field on a lead record including outreach_status, notes, contacted_at.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['hot_leads', 'surplus_confirmed'], default: 'hot_leads' },
        case_number: { type: 'string' },
        id: { type: 'string' },
        updates: {
          type: 'object',
          description: 'Fields to update e.g. {"outreach_status": "contacted", "notes": "Called 3x, left voicemail"}'
        }
      },
      required: ['updates']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email to a lead or any address via the configured SMTP account.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Email body — HTML is supported' },
        reply_to: { type: 'string', description: 'Optional reply-to address' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'get_outreach_stats',
    description: 'Get outreach statistics — emails sent, response counts, status breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: 'ISO date string e.g. 2025-01-01' },
        date_to: { type: 'string', description: 'ISO date string' }
      }
    }
  },
  {
    name: 'count_leads',
    description: 'Get a count of leads by table and optional filters.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['hot_leads', 'surplus_confirmed'], default: 'hot_leads' },
        filters: { type: 'object', description: 'Optional key-value filters' }
      },
      required: ['table']
    }
  }
];

async function executeTool(name, input) {
  console.log(`[ClaudeAgent] Tool: ${name}`, JSON.stringify(input).slice(0, 120));

  try {
    switch (name) {

      case 'get_leads': {
        if (!supabase) return { error: 'Supabase not configured' };
        let q = supabase.from(input.table).select('*');
        if (input.filters) {
          Object.entries(input.filters).forEach(([k, v]) => { q = q.eq(k, v); });
        }
        if (input.search) {
          q = q.or(`owner_name.ilike.%${input.search}%,property_address.ilike.%${input.search}%`);
        }
        q = q.order(input.order_by || 'created_at', { ascending: input.ascending ?? false });
        q = q.limit(input.limit || 20);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { records: data, count: data?.length, table: input.table };
      }

      case 'get_lead_detail': {
        if (!supabase) return { error: 'Supabase not configured' };
        const table = input.table || 'hot_leads';
        let q = supabase.from(table).select('*');
        if (input.case_number) q = q.eq('case_number', input.case_number);
        else if (input.id) q = q.eq('id', input.id);
        const { data, error } = await q.maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: 'Lead not found' };
        return { record: data };
      }

      case 'get_bot_status': {
        if (appCallbacks.getBotStatus) {
          return await appCallbacks.getBotStatus(input.county);
        }
        return { status: 'Bot status callback not registered' };
      }

      case 'trigger_scan': {
        if (appCallbacks.triggerScan) {
          const result = await appCallbacks.triggerScan(input.counties, input.priority || 'normal');
          return { triggered: true, counties: input.counties, result };
        }
        return { error: 'Scan trigger callback not registered' };
      }

      case 'update_lead_status': {
        if (!supabase) return { error: 'Supabase not configured' };
        const table = input.table || 'hot_leads';
        let q = supabase.from(table).update({
          ...input.updates,
          updated_at: new Date().toISOString()
        });
        if (input.case_number) q = q.eq('case_number', input.case_number);
        else if (input.id) q = q.eq('id', input.id);
        const { data, error } = await q.select();
        if (error) return { error: error.message };
        return { updated: true, records: data };
      }

      case 'send_email': {
        if (appCallbacks.sendEmail) {
          return await appCallbacks.sendEmail(input.to, input.subject, input.body, input.reply_to);
        }
        return { error: 'Email callback not registered' };
      }

      case 'get_outreach_stats': {
        if (!supabase) return { error: 'Supabase not configured' };
        let q = supabase.from('hot_leads').select('outreach_status, created_at');
        if (input.date_from) q = q.gte('created_at', input.date_from);
        if (input.date_to) q = q.lte('created_at', input.date_to);
        const { data, error } = await q;
        if (error) return { error: error.message };
        const stats = (data || []).reduce((acc, r) => {
          const key = r.outreach_status || 'pending';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        return { stats, total: (data || []).length };
      }

      case 'count_leads': {
        if (!supabase) return { error: 'Supabase not configured' };
        let q = supabase.from(input.table).select('*', { count: 'exact', head: true });
        if (input.filters) {
          Object.entries(input.filters).forEach(([k, v]) => { q = q.eq(k, v); });
        }
        const { count, error } = await q;
        if (error) return { error: error.message };
        return { count, table: input.table };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[ClaudeAgent] Tool error (${name}):`, err.message);
    return { error: err.message };
  }
}

// Legacy single-session aliases (used by in-app chatbot)
function trimHistory() { trimSession('app'); }
function clearHistory() { clearSession('app'); }
function getHistory() { return getSessionHistory('app'); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function chat(userMessage, options = {}) {
  return chatWithSession('app', userMessage, options);
}

async function chatWithSession(sessionId = 'app', userMessage, options = {}) {
  if (!anthropic) throw new Error('[ClaudeAgent] Not initialized — call initClaudeAgent() first');

  const { imageData = null, useThinking = false, systemOverride = null, maxTokens = MAX_TOKENS } = options;

  const userContent = imageData ? [
    { type: 'image', source: { type: 'base64', media_type: imageData.mimeType, data: imageData.base64 } },
    { type: 'text', text: userMessage }
  ] : userMessage;

  const history = getSessionHistory(sessionId);
  history.push({ role: 'user', content: userContent });
  trimSession(sessionId);

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const params = {
        model: MODEL,
        max_tokens: maxTokens,
        system: systemOverride || SYSTEM_PROMPT,
        messages: getSessionHistory(sessionId),
        tools: TOOLS,
        tool_choice: { type: 'auto' }
      };

      if (useThinking) {
        params.thinking = { type: 'enabled', budget_tokens: THINKING_BUDGET };
      }

      let response = await anthropic.messages.create(params);

      while (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(b => b.type === 'tool_use');
        getSessionHistory(sessionId).push({ role: 'assistant', content: response.content });

        const toolResults = await Promise.all(
          toolBlocks.map(async (t) => ({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify(await executeTool(t.name, t.input))
          }))
        );

        getSessionHistory(sessionId).push({ role: 'user', content: toolResults });
        trimSession(sessionId);

        response = await anthropic.messages.create({ ...params, messages: getSessionHistory(sessionId) });
      }

      const textBlock = response.content.find(b => b.type === 'text');
      const text = textBlock?.text || '';
      getSessionHistory(sessionId).push({ role: 'assistant', content: response.content });
      trimSession(sessionId);

      return { text, usage: response.usage, stop_reason: response.stop_reason, sessionId };

    } catch (err) {
      if (err.status === 429 && attempt < MAX_RETRIES) {
        attempt++;
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`[ClaudeAgent] Rate limit — retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

async function* chatStream(userMessage, options = {}) {
  yield* chatStreamWithSession('app', userMessage, options);
}

async function* chatStreamWithSession(sessionId = 'app', userMessage, options = {}) {
  if (!anthropic) throw new Error('[ClaudeAgent] Not initialized');

  const { imageData = null, systemOverride = null, maxTokens = MAX_TOKENS } = options;

  const userContent = imageData ? [
    { type: 'image', source: { type: 'base64', media_type: imageData.mimeType, data: imageData.base64 } },
    { type: 'text', text: userMessage }
  ] : userMessage;

  getSessionHistory(sessionId).push({ role: 'user', content: userContent });
  trimSession(sessionId);

  const baseParams = {
    model: MODEL,
    max_tokens: maxTokens,
    system: systemOverride || SYSTEM_PROMPT,
    tools: TOOLS,
    tool_choice: { type: 'auto' }
  };

  let continueLoop = true;

  while (continueLoop) {
    const stream = anthropic.messages.stream({ ...baseParams, messages: [...getSessionHistory(sessionId)] });

    let accContent = [];
    let curTool = null;
    let toolJson = '';
    let hasToolUse = false;

    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'text') {
          accContent.push({ type: 'text', text: '' });
        } else if (ev.content_block.type === 'tool_use') {
          hasToolUse = true;
          curTool = { type: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, input: {} };
          toolJson = '';
          accContent.push(curTool);
          yield { type: 'tool_start', tool: curTool.name };
        }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          const last = accContent.find(b => b.type === 'text');
          if (last) last.text += ev.delta.text;
          yield { type: 'text', delta: ev.delta.text };
        } else if (ev.delta.type === 'input_json_delta') {
          toolJson += ev.delta.partial_json;
        }
      } else if (ev.type === 'content_block_stop' && curTool) {
        try { curTool.input = JSON.parse(toolJson); } catch {}
        curTool = null;
        toolJson = '';
      }
    }

    if (hasToolUse) {
      getSessionHistory(sessionId).push({ role: 'assistant', content: accContent });
      const toolUseBlocks = accContent.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (t) => ({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(await executeTool(t.name, t.input))
        }))
      );
      getSessionHistory(sessionId).push({ role: 'user', content: toolResults });
      trimSession(sessionId);
      yield { type: 'tool_done' };
    } else {
      getSessionHistory(sessionId).push({ role: 'assistant', content: accContent });
      trimSession(sessionId);
      continueLoop = false;
      yield { type: 'done' };
    }
  }
}

module.exports = {
  initClaudeAgent,
  chat,
  chatStream,
  chatWithSession,
  chatStreamWithSession,
  clearHistory,
  clearSession,
  clearAllSessions,
  getHistory,
  listSessions,
  executeTool,
  TOOLS,
  SYSTEM_PROMPT
};
