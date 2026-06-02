const axios = require('axios');
const http = require('http');
const crypto = require('crypto');

let cfg = {};
let webhookServer = null;
const BASE = 'https://api.retellai.com/v2';

function initRetell(apiKey, agentId, phoneNumberId) {
  cfg = { apiKey, agentId, phoneNumberId };
  console.log('[Retell] Initialized — agent:', agentId, '| number:', phoneNumberId);
}

function headers() {
  return { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
}

async function callLead(toPhone, leadData = {}, overrideAgentId = null) {
  if (!cfg.apiKey) throw new Error('[Retell] Not initialized — call initRetell() first');

  const payload = {
    from_number: cfg.phoneNumberId,
    to_number: toPhone,
    override_agent_id: overrideAgentId || cfg.agentId,
    retell_llm_dynamic_variables: {
      lead_name: leadData.owner_name || leadData.name || 'Property Owner',
      property_address: leadData.property_address || leadData.address || '',
      surplus_amount: String(leadData.surplus_amount || leadData.amount || ''),
      case_number: leadData.case_number || '',
      county: leadData.county || ''
    },
    metadata: leadData
  };

  const resp = await axios.post(`${BASE}/create-phone-call`, payload, { headers: headers() });
  console.log('[Retell] Call created — call_id:', resp.data.call_id, '| to:', toPhone);
  return resp.data;
}

async function getCallDetails(callId) {
  const resp = await axios.get(`${BASE}/get-call/${callId}`, { headers: headers() });
  return resp.data;
}

async function listCalls(limit = 50) {
  const resp = await axios.get(`${BASE}/list-calls?limit=${limit}`, { headers: headers() });
  return resp.data;
}

async function listPhoneNumbers() {
  const resp = await axios.get(`${BASE}/list-phone-numbers`, { headers: headers() });
  return resp.data;
}

async function createAgent(options = {}) {
  const payload = {
    agent_name: options.name || 'Summit Claims AI Agent',
    voice_id: options.voiceId || '11labs-Adrian',
    language: 'en-US',
    response_engine: options.responseEngine || { type: 'retell-llm', llm_id: options.llmId },
    begin_message: options.beginMessage ||
      "Hi, this is Summit Claims Advisors calling about unclaimed surplus funds that may belong to you. Do you have a moment?",
    general_prompt: options.systemPrompt ||
      `You are a friendly representative from Summit Claims Advisors.
You are calling about unclaimed surplus funds from a foreclosure.
The property owner may not know these funds exist.
Your goal: explain the situation, answer questions, and schedule a callback or get their email.
Lead info: {{lead_name}}, {{property_address}}, ${{surplus_amount}}, Case {{case_number}}.`,
    ...options.extra
  };
  const resp = await axios.post(`${BASE}/create-agent`, payload, { headers: headers() });
  console.log('[Retell] Agent created — agent_id:', resp.data.agent_id);
  return resp.data;
}

async function createLLM(options = {}) {
  const payload = {
    model: options.model || 'claude-3-5-sonnet',
    general_prompt: options.systemPrompt || 'You are Summit Claims Advisors AI calling about surplus funds.',
    general_tools: options.tools || [],
    ...options.extra
  };
  const resp = await axios.post(`${BASE}/create-retell-llm`, payload, { headers: headers() });
  return resp.data;
}

function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return signatureHeader === expected;
}

function startWebhook(port = 3002, onCallEvent, webhookSecret = null) {
  if (webhookServer) return console.log('[Retell] Webhook already running');

  webhookServer = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (webhookSecret) {
        const sig = req.headers['x-retell-signature'] || '';
        if (!verifyWebhookSignature(body, sig, webhookSecret)) {
          console.warn('[Retell] Invalid webhook signature');
          res.writeHead(401); res.end(); return;
        }
      }
      try {
        const event = JSON.parse(body);
        console.log('[Retell] Webhook:', event.event, '— call_id:', event.data?.call_id);
        if (onCallEvent) onCallEvent(event);
        res.writeHead(200); res.end('OK');
      } catch (err) {
        console.error('[Retell] Webhook parse error:', err.message);
        res.writeHead(400); res.end();
      }
    });
  });

  webhookServer.listen(port, () =>
    console.log(`[Retell] Call webhook on http://localhost:${port}`)
  );
}

module.exports = {
  initRetell,
  callLead,
  getCallDetails,
  listCalls,
  listPhoneNumbers,
  createAgent,
  createLLM,
  startWebhook
};
