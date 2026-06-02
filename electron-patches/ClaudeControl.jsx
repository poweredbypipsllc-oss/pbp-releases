import React, { useState, useRef, useEffect, useCallback } from 'react';
import useCountyRecordsStore from '../store/countyRecordsStore';

// ─── Models ────────────────────────────────────────────────────────────────────
const MODELS = [
  { id: 'claude-sonnet-4-6',        label: 'Sonnet 4.6',  badge: 'FAST'  },
  { id: 'claude-opus-4-8',          label: 'Opus 4.8',    badge: 'SMART' },
  { id: 'claude-haiku-4-5-20251001',label: 'Haiku 4.5',   badge: 'QUICK' },
];

// ─── App tools ─────────────────────────────────────────────────────────────────
const APP_TOOLS = [
  { name:'get_app_status',    description:'Get live bot status, lead counts, and county configurations.', input_schema:{type:'object',properties:{},required:[]} },
  { name:'get_scan_logs',     description:'Get recent bot scan log lines.',                               input_schema:{type:'object',properties:{limit:{type:'integer'}},required:[]} },
  { name:'start_county_scan', description:'Start a county bot scan.',                                     input_schema:{type:'object',properties:{county_id:{type:'string'}},required:['county_id']} },
  { name:'stop_county_scan',  description:'Stop a running county scan.',                                  input_schema:{type:'object',properties:{county_id:{type:'string'}},required:['county_id']} },
  { name:'start_all_scans',   description:'Start all enabled county bots.',                               input_schema:{type:'object',properties:{},required:[]} },
  { name:'stop_all_scans',    description:'Stop all running bots.',                                       input_schema:{type:'object',properties:{},required:[]} },
  { name:'get_leads', description:'Query hot or surplus leads with filters.',
    input_schema:{type:'object',properties:{
      type:{type:'string',enum:['hot','surplus']},
      county:{type:'string'},status:{type:'string',enum:['new','contacted','not-interested','in-progress','signed','paid']},
      min_amount:{type:'number'},limit:{type:'integer'}
    },required:['type']} },
  { name:'update_lead_status', description:'Update outreach status on leads.',
    input_schema:{type:'object',properties:{case_numbers:{type:'array',items:{type:'string'}},lead_type:{type:'string',enum:['hot','surplus']},status:{type:'string',enum:['new','contacted','not-interested','in-progress','signed','paid']}},required:['case_numbers','lead_type','status']} },
  { name:'send_docusign', description:'Send a DocuSign recovery agreement to a property owner.',
    input_schema:{type:'object',properties:{recipient_name:{type:'string'},recipient_email:{type:'string'},amount:{type:'number'},address:{type:'string'},fee_pct:{type:'number'}},required:['recipient_name','recipient_email']} },
  { name:'send_email', description:'Send outreach email via Resend.',
    input_schema:{type:'object',properties:{to:{type:'array',items:{type:'string'}},subject:{type:'string'},text:{type:'string'},case_numbers:{type:'array',items:{type:'string'}},lead_type:{type:'string',enum:['hot','surplus']}},required:['to','subject','text']} },
  { name:'send_sms', description:'Send SMS via Twilio.',
    input_schema:{type:'object',properties:{to:{type:'string'},message:{type:'string'}},required:['to','message']} },
  { name:'make_voicemail', description:'Drop a ringless voicemail via Bland.ai.',
    input_schema:{type:'object',properties:{phone:{type:'string'},name:{type:'string'},amount:{type:'number'},address:{type:'string'}},required:['phone']} },
  { name:'get_clients',       description:'Query confirmed signed clients.',                              input_schema:{type:'object',properties:{limit:{type:'integer'},search:{type:'string'}},required:[]} },
  { name:'get_profit_summary',description:'Get revenue and fee summary.',                                 input_schema:{type:'object',properties:{},required:[]} },
  { name:'create_artifact',   description:'Create a renderable HTML artifact — calculator, dashboard, chart, form, or interactive tool. The content must be a complete, self-contained HTML document.',
    input_schema:{type:'object',properties:{title:{type:'string'},html:{type:'string',description:'Complete self-contained HTML with inline CSS and JS'},description:{type:'string'}},required:['title','html']} },

  // ── Bot training & configuration ─────────────────────────────────────────────
  { name:'get_bot_config',
    description:'Get the full county scanner configuration: enabled counties, lookback settings, timing parameters, Claude Vision settings, and Tracerfy status.',
    input_schema:{type:'object',properties:{},required:[]} },

  { name:'update_county_settings',
    description:'Enable or disable a county, change its lookback period (how many months back to search), or update its name.',
    input_schema:{type:'object',properties:{
      county_id:{type:'string',description:'County ID e.g. "duval"'},
      enabled:{type:'boolean',description:'Enable or disable this county'},
      lookback_months:{type:'integer',description:'How many months back to search (default 12)'},
    },required:['county_id']} },

  { name:'reset_scan_date',
    description:'Reset the last-scan date for a county so the next run performs a full historical scan instead of a delta (new filings only). Use "all" to reset every county.',
    input_schema:{type:'object',properties:{
      county_id:{type:'string',description:'County ID or "all"'},
    },required:['county_id']} },

  { name:'update_scan_timing',
    description:'Tune the scanner timing parameters to improve reliability or speed. All values in milliseconds.',
    input_schema:{type:'object',properties:{
      tab_close_delay_ms:    {type:'integer',description:'Wait after closing a tab (default 200)'},
      page_advance_delay_ms: {type:'integer',description:'Wait after advancing to next page (default 800)'},
      case_settle_delay_ms:  {type:'integer',description:'Wait for case tab content to load (default 3000)'},
      doc_read_delay_ms:     {type:'integer',description:'Wait between reading documents (default 600)'},
    },required:[]} },

  { name:'get_filtered_logs',
    description:'Get bot logs filtered by county, keyword, or type. Better than get_scan_logs for debugging specific issues.',
    input_schema:{type:'object',properties:{
      county_id:{type:'string',description:'Filter to a specific county (optional)'},
      filter:   {type:'string',description:'Keyword filter e.g. "error", "OCR", "tab close", "amount", "skip"'},
      limit:    {type:'integer',description:'Max lines to return (default 100)'},
    },required:[]} },
];

const WEB_SEARCH_TOOL = { type:'web_search_20250305', name:'web_search', max_uses:5 };

// ─── System prompt ──────────────────────────────────────────────────────────────
function buildSystemPrompt(counties, hotLeads, surplusConfirmed, logs) {
  const countyLines = counties.map(c=>`  - ${c.name} (${c.id}) — ${c.system||'portal'}, ${c.enabled?'enabled':'disabled'}, status: ${c.scanStatus||'idle'}`).join('\n')||'  (none configured)';
  const logLines = logs?.length ? logs.slice(-20).map(l=>`  [${l.ts?new Date(l.ts).toLocaleTimeString():'?'}] ${l.msg}`).join('\n') : '  (no logs yet)';

  return `You are the AI operator for MONEY PRINTER — a surplus funds recovery platform for Summit Claims Advisors (Sumeet). You have FULL authority and FULL capabilities.

BUSINESS: Surplus funds = leftover money after a foreclosure sale. When a home sells for more than the debt, the excess belongs to the original owner. We locate those owners, get them to sign a recovery contract (earning a % fee), then file claims on their behalf.

FULL CAPABILITY SET ACTIVE:
• Write, edit, analyze any text — emails, contracts, SOPs, legal summaries, outreach scripts
• Code — debug, build, explain anything (Python, JS, SQL, React, etc.)
• Research — web search active, can look up Florida surplus funds law, county portals, property records
• Math & analysis — financial projections, ROI calc, fee modeling, lead prioritization
• Data — analyze leads, find patterns, generate reports
• Artifacts — create HTML calculators, dashboards, charts, and interactive tools that render LIVE in-app
• Files — generate downloadable CSV, JSON, HTML, code files
• Strategy — business planning, pricing, outreach sequences, playbooks
• Diagrams — Mermaid flowcharts, ERDs, process flows rendered live
• Drafting — contracts, engagement letters, follow-up sequences, voicemail scripts

APP TOOLS AVAILABLE:
• Bot control: get_app_status, start_county_scan, stop_county_scan, start_all_scans, stop_all_scans
• Bot training: get_bot_config, update_county_settings, reset_scan_date, update_scan_timing, get_filtered_logs, get_scan_logs
• Leads: get_leads, update_lead_status
• Outreach: send_docusign, send_email, send_sms, make_voicemail
• Business: get_clients, get_profit_summary
• Creation: create_artifact (renders live HTML in app panel)
• Research: web_search (if enabled)

BOT TRAINING — you have FULL control over the scanner:
- "Enable/disable Duval County" → use update_county_settings
- "Change Duval to scan 24 months back" → update_county_settings with lookback_months
- "Force a full rescan of Duval" → reset_scan_date then start_county_scan
- "The bot keeps failing on tab close — increase delay to 500ms" → update_scan_timing
- "Show me all OCR errors from today" → get_filtered_logs with filter "OCR"
- "What's the current configuration?" → get_bot_config

ARTIFACTS: When creating calculators, dashboards, visualizations, or any interactive tool — use the create_artifact tool with complete self-contained HTML. These render live in the app panel. Examples: fee calculator, lead ROI dashboard, email preview, auction date tracker.

CURRENT STATE:
Counties: ${countyLines}
Hot leads (open foreclosures): ${hotLeads.length.toLocaleString()} total, ${hotLeads.filter(l=>l.outreach_status==='new').length} uncontacted
Surplus confirmed (funds available): ${surplusConfirmed.length.toLocaleString()} total, ${surplusConfirmed.filter(l=>l.outreach_status==='new').length} uncontacted

Recent bot activity:
${logLines}

STYLE: Direct, action-oriented. Confirm before mass emails (>5). Show math when relevant. Use artifacts proactively for anything visual or interactive.`;
}

// ─── SSE stream ────────────────────────────────────────────────────────────────
async function* parseSSE(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (!d || d === '[DONE]') continue;
        try { yield JSON.parse(d); } catch {}
      }
    }
  } finally { reader.releaseLock(); }
}

// ─── Tool executor ──────────────────────────────────────────────────────────────
async function executeTool(name, input, snap) {
  const { counties, hotLeads, surplusConfirmed, logs, updateLeadStatus, updateSurplusStatus } = snap;

  switch (name) {
    case 'get_app_status':
      return { ok:true, counties:counties.map(c=>({id:c.id,name:c.name,enabled:c.enabled,status:c.scanStatus||'idle'})),
        hot:{total:hotLeads.length,uncontacted:hotLeads.filter(l=>l.outreach_status==='new').length},
        surplus:{total:surplusConfirmed.length,uncontacted:surplusConfirmed.filter(l=>l.outreach_status==='new').length} };

    case 'get_scan_logs': {
      const limit = Math.min(input.limit||50,200);
      const r = (logs||[]).slice(-limit);
      return { ok:true, showing:r.length, logs:r.map(l=>`[${l.ts?new Date(l.ts).toLocaleTimeString():'?'}] ${l.msg}`) };
    }

    case 'start_county_scan': {
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      const c = counties.find(c=>c.id===input.county_id||c.name.toLowerCase().startsWith(input.county_id.toLowerCase()));
      if (!c) return { ok:false, error:`County "${input.county_id}" not found. Available: ${counties.map(c=>c.id).join(', ')}` };
      const _botCfg = {supabaseUrl:localStorage.getItem('mp_supabase_url')||'',supabaseKey:localStorage.getItem('mp_supabase_anon_key')||'',tracerfyKey:localStorage.getItem('mp_tracerfy_key')||'',anthropicKey:localStorage.getItem('mp_anthropic_key')||''};
      try { const _t=localStorage.getItem('mp_scan_timing'); if(_t)_botCfg.scanTiming=JSON.parse(_t); } catch {}
      window.electronAPI.countyBotStart(c, _botCfg);
      return { ok:true, message:`Started ${c.name} County bot` };
    }

    case 'stop_county_scan': {
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      const c = counties.find(c=>c.id===input.county_id||c.name.toLowerCase().startsWith(input.county_id.toLowerCase()));
      window.electronAPI.countyBotStop(c?.id||input.county_id);
      return { ok:true, message:`Stopped ${c?.name||input.county_id}` };
    }

    case 'start_all_scans': {
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      const active = counties.filter(c=>c.enabled);
      const _allCfg = {supabaseUrl:localStorage.getItem('mp_supabase_url')||'',supabaseKey:localStorage.getItem('mp_supabase_anon_key')||'',tracerfyKey:localStorage.getItem('mp_tracerfy_key')||'',anthropicKey:localStorage.getItem('mp_anthropic_key')||''};
      try { const _t=localStorage.getItem('mp_scan_timing'); if(_t)_allCfg.scanTiming=JSON.parse(_t); } catch {}
      window.electronAPI.countyBotStartAll(active, _allCfg);
      return { ok:true, message:`Started ${active.length} bots: ${active.map(c=>c.name).join(', ')}` };
    }

    case 'stop_all_scans':
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      window.electronAPI.countyBotStopAll();
      return { ok:true, message:'All bots stopped' };

    case 'get_leads': {
      let pool = input.type==='hot' ? hotLeads : surplusConfirmed;
      if (input.county)     pool = pool.filter(l=>l.county?.toLowerCase().includes(input.county.toLowerCase()));
      if (input.status)     pool = pool.filter(l=>l.outreach_status===input.status);
      if (input.min_amount) pool = pool.filter(l=>(input.type==='hot'?l.amount_owed:l.surplus_amount)>=input.min_amount);
      const limit = Math.min(input.limit||20,100);
      return { ok:true, type:input.type, total_matching:pool.length, showing:Math.min(pool.length,limit),
        leads:pool.slice(0,limit).map(l=>({case_number:l.case_number,name:l.owner_name||'—',address:l.address||'—',county:l.county||'—',amount:input.type==='hot'?l.amount_owed:l.surplus_amount,status:l.outreach_status||'new',phone:l.phone||null,email:l.email||null})) };
    }

    case 'update_lead_status': {
      let n=0; for (const cn of input.case_numbers) { if(input.lead_type==='surplus')updateSurplusStatus(cn,input.status); else updateLeadStatus(cn,input.status); n++; }
      return { ok:true, updated:n, message:`Marked ${n} leads as "${input.status}"` };
    }

    case 'send_docusign': {
      const token=localStorage.getItem('mp_docusign_token')||'',accountId=localStorage.getItem('mp_docusign_account')||'',templateId=localStorage.getItem('mp_docusign_template')||'',baseUrl=localStorage.getItem('mp_docusign_baseurl')||'https://na4.docusign.net';
      if (!token||!accountId||!templateId) return { ok:false, error:'DocuSign not configured in Settings' };
      const feePct=input.fee_pct||30, fmt$='$'+parseFloat(input.amount||0).toLocaleString('en-US',{minimumFractionDigits:2});
      try {
        const res=await fetch(baseUrl.replace(/\/$/,'')+'/restapi/v2.1/accounts/'+accountId+'/envelopes',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({templateId,templateRoles:[{email:input.recipient_email,name:input.recipient_name,roleName:'Client',tabs:{textTabs:[{tabLabel:'Amount',value:fmt$},{tabLabel:'Address',value:input.address||''},{tabLabel:'FeePct',value:feePct+'%'},{tabLabel:'FullName',value:input.recipient_name}]}}],status:'sent'})});
        const data=await res.json();
        if (res.ok&&data.envelopeId) return { ok:true, envelope_id:data.envelopeId, message:`Contract sent to ${input.recipient_name}` };
        return { ok:false, error:data.message||JSON.stringify(data) };
      } catch(e) { return { ok:false, error:e.message }; }
    }

    case 'send_email': {
      const apiKey=localStorage.getItem('mp_resend_key')||'',from=localStorage.getItem('mp_from_address')||'';
      if (!apiKey||!from) return { ok:false, error:'Email not configured in Settings' };
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      const result=await window.electronAPI.sendEmail({apiKey,from,to:input.to,subject:input.subject,text:input.text});
      if (result.success&&input.case_numbers?.length) for (const cn of input.case_numbers) { if(input.lead_type==='surplus')updateSurplusStatus(cn,'contacted'); else updateLeadStatus(cn,'contacted'); }
      return result.success ? { ok:true, message:`Email sent to ${input.to.join(', ')}` } : { ok:false, error:result.error };
    }

    case 'send_sms': {
      const sid=localStorage.getItem('mp_twilio_sid')||'',token=localStorage.getItem('mp_twilio_token')||'',from=localStorage.getItem('mp_twilio_from')||'';
      if (!sid||!token||!from) return { ok:false, error:'Twilio not configured in Settings' };
      try {
        const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{'Authorization':'Basic '+btoa(`${sid}:${token}`),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:from,To:input.to,Body:input.message})});
        const data=await res.json();
        return data.sid ? { ok:true, message:`SMS sent to ${input.to}` } : { ok:false, error:data.message||JSON.stringify(data) };
      } catch(e) { return { ok:false, error:e.message }; }
    }

    case 'make_voicemail': {
      const apiKey=localStorage.getItem('mp_bland_key')||'',voice=localStorage.getItem('mp_bland_voice')||'maya',cb=localStorage.getItem('mp_callback_phone')||'';
      if (!apiKey) return { ok:false, error:'Bland.ai not configured in Settings' };
      const script=`Hi ${input.name||'there'}, this is Summit Claims Advisors calling about unclaimed surplus funds${input.amount?` of $${parseFloat(input.amount).toLocaleString()}`:''}${input.address?` tied to the property at ${input.address}`:''}. These funds belong to you. We recover them at no upfront cost. Please call us back at ${cb||'our office'}.`;
      try {
        const res=await fetch('https://api.bland.ai/v1/calls',{method:'POST',headers:{'Authorization':apiKey,'Content-Type':'application/json'},body:JSON.stringify({phone_number:input.phone,voice,task:script,reduce_latency:true})});
        const data=await res.json();
        return (data.call_id||data.status==='success') ? { ok:true, message:`Voicemail queued for ${input.phone}` } : { ok:false, error:data.message||JSON.stringify(data) };
      } catch(e) { return { ok:false, error:e.message }; }
    }

    case 'get_clients': {
      const { getSupabase, isSupabaseConfigured } = await import('../lib/supabase');
      if (!isSupabaseConfigured()) return { ok:false, error:'Supabase not configured' };
      const sb=getSupabase(); let q=sb.from('clients').select('*').order('created_at',{ascending:false}).limit(input.limit||20);
      if (input.search) q=q.ilike('name',`%${input.search}%`);
      const { data, error }=await q;
      if (error) return { ok:false, error:error.message };
      return { ok:true, count:data.length, clients:data };
    }

    case 'get_profit_summary': {
      const { getSupabase, isSupabaseConfigured } = await import('../lib/supabase');
      if (!isSupabaseConfigured()) return { ok:false, error:'Supabase not configured' };
      const sb=getSupabase(); const { data }=await sb.from('profit_entries').select('*').order('date',{ascending:false});
      const entries=data||[],now=new Date();
      const allTime=entries.reduce((s,e)=>s+(parseFloat(e.fee_earned)||0),0);
      const thisMonth=entries.filter(e=>{const d=new Date(e.date);return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();}).reduce((s,e)=>s+(parseFloat(e.fee_earned)||0),0);
      return { ok:true, all_time_revenue:allTime, this_month_revenue:thisMonth, entry_count:entries.length, recent:entries.slice(0,10) };
    }

    case 'create_artifact':
      return { ok:true, rendered:true, title:input.title, html:input.html, description:input.description||'' };

    // ── Bot training tools ────────────────────────────────────────────────────
    case 'get_bot_config': {
      const raw = localStorage.getItem('mp_county_registry');
      const countyConfigs = raw ? JSON.parse(raw) : [];
      const timing = JSON.parse(localStorage.getItem('mp_scan_timing')||'{}');
      const hasAnthropicKey = !!(localStorage.getItem('mp_anthropic_key'));
      const hasTracerfy     = !!(localStorage.getItem('mp_tracerfy_key'));
      return {
        ok: true,
        counties: countyConfigs.length > 0 ? countyConfigs : counties.map(c=>({id:c.id,name:c.name,enabled:c.enabled,system:c.system})),
        timing: {
          tab_close_delay_ms:    timing.tab_close_delay_ms    || 200,
          page_advance_delay_ms: timing.page_advance_delay_ms || 800,
          case_settle_delay_ms:  timing.case_settle_delay_ms  || 3000,
          doc_read_delay_ms:     timing.doc_read_delay_ms     || 600,
        },
        claude_vision_enabled: hasAnthropicKey,
        skip_tracer_enabled:   hasTracerfy,
        supabase_connected:    !!(localStorage.getItem('mp_supabase_url')),
      };
    }

    case 'update_county_settings': {
      let configs = [];
      try { configs = JSON.parse(localStorage.getItem('mp_county_registry') || '[]'); } catch {}
      // If no saved config yet, bootstrap from current store
      if (!configs.length) configs = counties.map(c=>({id:c.id,name:c.name,enabled:c.enabled,system:c.system,url:c.url,state:c.state}));
      const idx = configs.findIndex(c => c.id === input.county_id);
      if (idx === -1) return { ok:false, error:`County "${input.county_id}" not found. Available: ${configs.map(c=>c.id).join(', ')}` };
      if (input.enabled !== undefined)        configs[idx].enabled = input.enabled;
      if (input.lookback_months !== undefined) configs[idx].lookbackMonths = input.lookback_months;
      localStorage.setItem('mp_county_registry', JSON.stringify(configs));
      return { ok:true, message:`Updated ${configs[idx].name}: ${JSON.stringify({enabled:configs[idx].enabled,lookback_months:configs[idx].lookbackMonths})}`, updated:configs[idx] };
    }

    case 'reset_scan_date': {
      if (!window.electronAPI) return { ok:false, error:'Electron unavailable' };
      const result = await window.electronAPI.resetScanDate?.(input.county_id);
      if (result === undefined) {
        // Fallback: clear via localStorage key pattern
        if (input.county_id === 'all') {
          const keys = Object.keys(localStorage).filter(k => k.startsWith('mp_scan_last_'));
          keys.forEach(k => localStorage.removeItem(k));
          return { ok:true, message:`Reset scan dates for all ${keys.length} counties — next run will be a full historical scan` };
        } else {
          localStorage.removeItem(`mp_scan_last_${input.county_id}`);
          return { ok:true, message:`Reset scan date for ${input.county_id} — next scan will be full historical` };
        }
      }
      return { ok:true, message:result };
    }

    case 'update_scan_timing': {
      const current = JSON.parse(localStorage.getItem('mp_scan_timing')||'{}');
      const updated = {
        tab_close_delay_ms:    input.tab_close_delay_ms    ?? current.tab_close_delay_ms    ?? 200,
        page_advance_delay_ms: input.page_advance_delay_ms ?? current.page_advance_delay_ms ?? 800,
        case_settle_delay_ms:  input.case_settle_delay_ms  ?? current.case_settle_delay_ms  ?? 3000,
        doc_read_delay_ms:     input.doc_read_delay_ms     ?? current.doc_read_delay_ms     ?? 600,
      };
      localStorage.setItem('mp_scan_timing', JSON.stringify(updated));
      return { ok:true, message:'Scan timing updated — takes effect on next scan start', timing: updated };
    }

    case 'get_filtered_logs': {
      const limit = Math.min(input.limit || 100, 500);
      let pool = (logs || []);
      if (input.county_id) pool = pool.filter(l => l.msg?.toLowerCase().includes(input.county_id.toLowerCase()));
      if (input.filter)    pool = pool.filter(l => l.msg?.toLowerCase().includes(input.filter.toLowerCase()));
      const recent = pool.slice(-limit);
      return {
        ok: true,
        total_matching: pool.length,
        showing: recent.length,
        logs: recent.map(l => `[${l.ts ? new Date(l.ts).toLocaleTimeString() : '?'}] ${l.msg}`),
      };
    }

    default:
      return { ok:false, error:`Unknown tool: ${name}` };
  }
}

// ─── Claude streaming loop ──────────────────────────────────────────────────────
async function runClaudeLoop({ userText, images, attachments, history, apiKey, model, thinking, webSearch, storeSnap, onEvent }) {
  let userContent;
  const textWithAttachments = attachments?.length
    ? userText + '\n\n' + attachments.map(a=>`<attachment name="${a.name}">\n${a.content.slice(0,30000)}\n</attachment>`).join('\n\n')
    : userText;

  if (images?.length) {
    userContent = [...images.map(img=>({type:'image',source:{type:'base64',media_type:img.mediaType,data:img.data}})), {type:'text',text:textWithAttachments}];
  } else {
    userContent = textWithAttachments;
  }

  const system = buildSystemPrompt(storeSnap.counties, storeSnap.hotLeads, storeSnap.surplusConfirmed, storeSnap.logs);
  let messages = [...history, { role:'user', content:userContent }];

  const betas = ['prompt-caching-2024-07-31'];
  if (thinking)  betas.push('interleaved-thinking-2025-05-14');
  if (webSearch) betas.push('web-search-2025-03-05');

  const tools = [...APP_TOOLS];
  if (webSearch) tools.push(WEB_SEARCH_TOOL);

  while (true) {
    const body = { model, max_tokens:16000, stream:true,
      system:[{type:'text',text:system,cache_control:{type:'ephemeral'}}],
      tools, messages };
    if (thinking) body.thinking = { type:'enabled', budget_tokens:10000 };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-beta':betas.join(',')},
      body:JSON.stringify(body),
    });

    if (!res.ok) { const err=await res.json().catch(()=>({})); throw new Error(err.error?.message||`Claude API error ${res.status}`); }

    const blocks = {}; let stopReason='end_turn';
    for await (const ev of parseSSE(res)) {
      switch (ev.type) {
        case 'content_block_start': {
          const b={...ev.content_block}; blocks[ev.index]=b;
          if (b.type==='thinking')  { b.text='';         onEvent({type:'thinking_start',idx:ev.index}); }
          else if (b.type==='text') { b.text='';         onEvent({type:'text_start',idx:ev.index}); }
          else if (b.type==='tool_use') { b.input_json=''; onEvent({type:'tool_start',idx:ev.index,name:b.name,id:b.id}); }
          break;
        }
        case 'content_block_delta': {
          const b=blocks[ev.index]; if (!b) break;
          if (ev.delta.type==='text_delta')       { b.text+=ev.delta.text;             onEvent({type:'text_delta',idx:ev.index,text:ev.delta.text}); }
          if (ev.delta.type==='thinking_delta')   { b.text+=ev.delta.thinking;          onEvent({type:'thinking_delta',idx:ev.index,text:ev.delta.thinking}); }
          if (ev.delta.type==='input_json_delta') { b.input_json+=ev.delta.partial_json; }
          break;
        }
        case 'content_block_stop': {
          const b=blocks[ev.index]; if (!b) break;
          if (b.type==='tool_use') { try{b.input=JSON.parse(b.input_json||'{}')}catch{b.input={}} onEvent({type:'tool_ready',idx:ev.index,name:b.name,id:b.id,input:b.input}); }
          else if (b.type==='thinking') onEvent({type:'thinking_done',idx:ev.index});
          else if (b.type==='text')     onEvent({type:'text_done',idx:ev.index});
          break;
        }
        case 'message_delta': if(ev.delta?.stop_reason) stopReason=ev.delta.stop_reason; break;
      }
    }

    const assistantContent = Object.entries(blocks).sort(([a],[b])=>+a-+b).map(([,b])=>{
      if (b.type==='text')     return {type:'text',text:b.text||''};
      if (b.type==='thinking') return {type:'thinking',thinking:b.text||''};
      if (b.type==='tool_use') return {type:'tool_use',id:b.id,name:b.name,input:b.input||{}};
      return b;
    });

    messages=[...messages,{role:'assistant',content:assistantContent}];
    onEvent({type:'turn_end',stopReason});
    if (stopReason!=='tool_use') break;

    const toolResults=[];
    for (const block of assistantContent) {
      if (block.type!=='tool_use') continue;
      onEvent({type:'tool_executing',name:block.name,id:block.id});
      const result=await executeTool(block.name,block.input,storeSnap);
      onEvent({type:'tool_result',name:block.name,id:block.id,result});
      toolResults.push({type:'tool_result',tool_use_id:block.id,content:JSON.stringify(result)});
    }
    messages=[...messages,{role:'user',content:toolResults}];
  }
  return messages;
}

// ─── Artifact viewer ────────────────────────────────────────────────────────────
function ArtifactPanel({ artifact, onClose }) {
  if (!artifact) return null;
  return (
    <div className="flex flex-col h-full" style={{ background:'#080808', borderLeft:'1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor:'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-brand-500" style={{ boxShadow:'0 0 6px rgba(34,197,94,0.6)' }} />
          <span className="text-[11px] font-bold text-white/80 truncate max-w-[200px]">{artifact.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const b=new Blob([artifact.html],{type:'text/html'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`${artifact.title.replace(/\s+/g,'-')}.html`; a.click(); URL.revokeObjectURL(u); }}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-white/5"
          >Download</button>
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-white transition-colors rounded hover:bg-white/5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <iframe
        srcDoc={artifact.html}
        sandbox="allow-scripts allow-forms allow-popups"
        className="flex-1 w-full border-0"
        style={{ background:'#fff' }}
        title={artifact.title}
      />
    </div>
  );
}

// ─── Markdown renderer ──────────────────────────────────────────────────────────
function CodeBlock({ lang, code, onArtifact }) {
  const [copied, setCopied] = useState(false);
  const isArtifactType = ['html','svg'].includes(lang?.toLowerCase());
  const isMermaid = lang?.toLowerCase()==='mermaid';

  function copy() { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(()=>setCopied(false),2000); }
  function download() { const b=new Blob([code],{type:'text/plain'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`code.${lang||'txt'}`; a.click(); URL.revokeObjectURL(u); }
  function render() {
    if (isMermaid) {
      const html=`<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script></head><body style="background:#1a1a1a;padding:20px"><div class="mermaid">${code}</div><script>mermaid.initialize({startOnLoad:true,theme:'dark'})</script></body></html>`;
      onArtifact({ title:`${lang} Diagram`, html });
    } else if (lang?.toLowerCase()==='svg') {
      const html=`<!DOCTYPE html><html><body style="background:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">${code}</body></html>`;
      onArtifact({ title:'SVG Graphic', html });
    } else {
      onArtifact({ title:'HTML Preview', html:code });
    }
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden" style={{ border:'1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background:'rgba(0,0,0,0.5)' }}>
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">{lang||'code'}</span>
        <div className="flex items-center gap-1.5">
          {(isArtifactType||isMermaid) && (
            <button onClick={render} className="text-[10px] text-brand-400 hover:text-brand-300 font-semibold px-2 py-0.5 rounded transition-colors" style={{ background:'rgba(34,197,94,0.1)' }}>
              Render
            </button>
          )}
          <button onClick={download} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded transition-colors hover:bg-white/5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          </button>
          <button onClick={copy} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded transition-colors hover:bg-white/5">
            {copied ? <svg className="w-3 h-3 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto text-[11px] font-mono leading-relaxed px-4 py-3" style={{ background:'rgba(0,0,0,0.3)', color:'#a8ff7f', maxHeight:'320px' }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownText({ text, onArtifact }) {
  const lines = (text||'').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      out.push(<CodeBlock key={i} lang={lang} code={codeLines.join('\n')} onArtifact={onArtifact} />);
      i++; continue;
    }
    if (line.startsWith('### ')) { out.push(<p key={i} className="text-[13px] font-bold text-white mt-3 mb-1">{fmtInline(line.slice(4))}</p>); i++; continue; }
    if (line.startsWith('## '))  { out.push(<p key={i} className="text-[14px] font-bold text-white/90 mt-3 mb-1">{fmtInline(line.slice(3))}</p>); i++; continue; }
    if (line.startsWith('# '))   { out.push(<p key={i} className="text-[15px] font-bold text-white mt-3 mb-1">{fmtInline(line.slice(2))}</p>); i++; continue; }
    if (/^[-*•] /.test(line)) {
      const items=[]; while(i<lines.length&&/^[-*•] /.test(lines[i])){ items.push(<li key={i} className="ml-3 text-[13px] text-gray-200 leading-relaxed">{fmtInline(lines[i].replace(/^[-*•] /,''))}</li>); i++; }
      out.push(<ul key={`ul${i}`} className="my-1 space-y-0.5 list-disc list-inside">{items}</ul>); continue;
    }
    if (/^\d+\. /.test(line)) {
      const items=[]; while(i<lines.length&&/^\d+\. /.test(lines[i])){ items.push(<li key={i} className="ml-3 text-[13px] text-gray-200 leading-relaxed">{fmtInline(lines[i].replace(/^\d+\. /,''))}</li>); i++; }
      out.push(<ol key={`ol${i}`} className="my-1 space-y-0.5 list-decimal list-inside">{items}</ol>); continue;
    }
    if (/^---+$/.test(line.trim())) { out.push(<hr key={i} className="my-2 border-white/10"/>); i++; continue; }
    if (!line.trim()) { out.push(<div key={i} className="h-1.5"/>); i++; continue; }
    out.push(<p key={i} className="text-[13px] text-gray-200 leading-relaxed">{fmtInline(line)}</p>);
    i++;
  }
  return <div className="space-y-0.5">{out}</div>;
}

function fmtInline(text) {
  const parts=[]; let rem=text, k=0;
  while (rem.length>0) {
    const cm=rem.match(/^(.*?)`([^`]+)`(.*)/s);
    const bm=rem.match(/^(.*?)\*\*([^*]+)\*\*(.*)/s);
    const im=rem.match(/^(.*?)\*([^*]+)\*(.*)/s);
    const cands=[cm&&{idx:cm[1].length,m:cm,t:'code'},bm&&{idx:bm[1].length,m:bm,t:'bold'},im&&{idx:im[1].length,m:im,t:'ital'}].filter(Boolean).sort((a,b)=>a.idx-b.idx);
    if (!cands.length) { parts.push(<span key={k++}>{rem}</span>); break; }
    const {m,t}=cands[0];
    if (m[1]) parts.push(<span key={k++}>{m[1]}</span>);
    if (t==='code') parts.push(<code key={k++} className="text-[11px] font-mono px-1 py-0.5 rounded" style={{color:'#a8ff7f',background:'rgba(0,0,0,0.3)'}}>{m[2]}</code>);
    if (t==='bold') parts.push(<strong key={k++} className="text-white font-semibold">{m[2]}</strong>);
    if (t==='ital') parts.push(<em key={k++} className="text-gray-300">{m[2]}</em>);
    rem=m[3];
  }
  return parts;
}

// ─── Message components ─────────────────────────────────────────────────────────
const TOOL_LABELS = {
  get_app_status:'Checking status',       get_scan_logs:'Reading logs',
  start_county_scan:'Starting scan',      stop_county_scan:'Stopping scan',
  start_all_scans:'Starting all scans',   stop_all_scans:'Stopping bots',
  get_leads:'Querying leads',             update_lead_status:'Updating leads',
  send_docusign:'Sending contract',       send_email:'Sending email',
  send_sms:'Sending SMS',                 make_voicemail:'Dropping voicemail',
  get_clients:'Loading clients',          get_profit_summary:'Loading revenue',
  create_artifact:'Building artifact',    web_search:'Searching web',
  get_bot_config:'Reading bot config',    update_county_settings:'Updating county',
  reset_scan_date:'Resetting scan date',  update_scan_timing:'Updating timing',
  get_filtered_logs:'Filtering logs',
};

const UserMsg = React.memo(function UserMsg({ msg }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[78%]">
        {msg.images?.length>0&&<div className="flex gap-1.5 mb-1.5 justify-end flex-wrap">{msg.images.map((img,i)=><img key={i} src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} className="h-14 w-auto rounded-lg border border-white/10 object-cover"/>)}</div>}
        {msg.attachments?.length>0&&<div className="flex gap-1.5 mb-1.5 justify-end flex-wrap">{msg.attachments.map((a,i)=><span key={i} className="text-[10px] text-gray-400 bg-surface-600 border border-white/10 rounded-lg px-2 py-1">{a.name}</span>)}</div>}
        <div className="rounded-2xl rounded-tr-sm px-4 py-2.5" style={{background:'rgba(34,197,94,0.12)',border:'1px solid rgba(34,197,94,0.2)'}}>
          <p className="text-[13px] text-white/90 leading-relaxed whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    </div>
  );
});

const ThinkingMsg = React.memo(function ThinkingMsg({ msg }) {
  const [open,setOpen]=useState(false);
  return (
    <div className="mb-2 ml-8">
      <button onClick={()=>setOpen(v=>!v)} className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors" style={{color:'rgba(192,132,252,0.5)'}}>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open?'M19 9l-7 7-7-7':'M9 5l7 7-7 7'}/></svg>
        {msg.done?'Thinking':'Thinking...'}{!msg.done&&<span className="w-1 h-1 rounded-full animate-pulse" style={{background:'rgba(192,132,252,0.7)'}}/>}
      </button>
      {open&&<div className="mt-1.5 text-[11px] font-mono leading-relaxed rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap" style={{color:'rgba(192,132,252,0.5)',background:'rgba(192,132,252,0.05)',border:'1px solid rgba(192,132,252,0.1)'}}>{msg.text}</div>}
    </div>
  );
});

const AssistantMsg = React.memo(function AssistantMsg({ msg, onArtifact }) {
  if (!msg.text) return null;
  return (
    <div className="flex justify-start mb-3">
      <div className="flex gap-2.5 max-w-[90%]">
        <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5" style={{background:'linear-gradient(135deg,#22c55e,#16a34a)',boxShadow:'0 0 8px rgba(34,197,94,0.3)'}}>
          <span className="text-[8px] font-black text-white">AI</span>
        </div>
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 min-w-0" style={{background:'#111',border:'1px solid rgba(255,255,255,0.07)'}}>
          {msg.done
            ? <MarkdownText text={msg.text} onArtifact={onArtifact}/>
            : <p className="text-[13px] text-gray-200 leading-relaxed whitespace-pre-wrap">{msg.text}<span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm align-middle" style={{background:'#22c55e'}}/></p>
          }
        </div>
      </div>
    </div>
  );
});

const ToolMsg = React.memo(function ToolMsg({ msg }) {
  const [open,setOpen]=useState(false);
  const isErr=msg.result&&!msg.result.ok;
  const isArtifact=msg.name==='create_artifact'&&msg.result?.ok;
  return (
    <div className="flex items-start gap-2 mb-1.5 ml-8">
      <div className="mt-0.5 flex-shrink-0">
        {!msg.done ? <div className="w-3.5 h-3.5 border border-t-brand-400 rounded-full animate-spin" style={{borderColor:'rgba(34,197,94,0.3)',borderTopColor:'rgba(74,222,128,1)'}}/> :
         isErr     ? <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg> :
                     <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>}
      </div>
      <div className="flex-1 min-w-0">
        <button onClick={()=>msg.done&&setOpen(v=>!v)} className={`text-[11px] font-mono flex items-center gap-1.5 transition-colors ${msg.done?'text-gray-500 hover:text-gray-300 cursor-pointer':'text-gray-600 cursor-default'}`}>
          <span className={isErr?'text-red-500/70':'text-brand-500/70'}>›</span>
          <span>{TOOL_LABELS[msg.name]||msg.name}</span>
          {isArtifact&&<span className="text-brand-400 text-[10px]">— artifact ready</span>}
          {msg.done&&!isArtifact&&<span className="text-gray-700">— {open?'hide':'details'}</span>}
        </button>
        {open&&msg.result&&<pre className="mt-1.5 text-[10px] text-gray-500 font-mono rounded-lg p-2.5 overflow-x-auto max-h-40" style={{background:'rgba(0,0,0,0.3)'}}>{JSON.stringify(msg.result,null,2)}</pre>}
      </div>
    </div>
  );
});

// ─── Conversation persistence ────────────────────────────────────────────────────
const CONV_KEY = 'mp_claude_conversations';
function loadConversations() { try { return JSON.parse(localStorage.getItem(CONV_KEY)||'[]'); } catch { return []; } }
function saveConversation(id, title, messages, history) {
  const all = loadConversations();
  const idx = all.findIndex(c=>c.id===id);
  const entry = { id, title, savedAt:new Date().toISOString(), messages, history };
  if (idx>=0) all[idx]=entry; else all.unshift(entry);
  localStorage.setItem(CONV_KEY, JSON.stringify(all.slice(0,20))); // keep last 20
}

// ─── Main component ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "What's the current bot configuration?",
  "Show me all OCR errors from the last scan",
  "Increase tab close delay to 400ms for reliability",
  "Reset Duval County for a full rescan",
  "Show my top surplus leads by amount",
  "Build a fee calculator artifact",
  "Draft outreach email for a $50k surplus fund",
  "Get this month's revenue summary",
];
let _uid=0; const uid=()=>++_uid;

export default function ClaudeControl() {
  const [msgs,        setMsgs]        = useState([]);
  const [input,       setInput]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [thinking,    setThinking]    = useState(false);
  const [webSearch,   setWebSearch]   = useState(false);
  const [images,      setImages]      = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [model,       setModel]       = useState(MODELS[0].id);
  const [artifact,    setArtifact]    = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState(loadConversations);
  const [convId,      setConvId]      = useState(()=>Date.now().toString());

  const historyRef    = useRef([]);
  const bottomRef     = useRef(null);
  const inputRef      = useRef(null);
  const blockIds      = useRef({});
  const streamBuf     = useRef({});   // { msgId: accumulatedText } — flushed at 60fps
  const rafRef        = useRef(null);

  const store = useCountyRecordsStore();
  const logs  = useCountyRecordsStore(s=>s.logs);
  const apiKey= localStorage.getItem('mp_anthropic_key')||'';

  // Auto-scroll only when near bottom
  const prevMsgCount = useRef(0);
  useEffect(()=>{
    if (msgs.length !== prevMsgCount.current) {
      prevMsgCount.current = msgs.length;
      bottomRef.current?.scrollIntoView({behavior:'smooth'});
    }
  },[msgs.length]);

  // RAF loop: flush streamed text to React state at 60fps instead of per-token
  useEffect(()=>{
    const flush = () => {
      const buf = streamBuf.current;
      const ids = Object.keys(buf);
      if (ids.length > 0) {
        setMsgs(prev => prev.map(m => {
          if (buf[m.id] !== undefined) {
            const next = { ...m, text: (m.text || '') + buf[m.id] };
            delete buf[m.id];
            return next;
          }
          return m;
        }));
      }
      rafRef.current = requestAnimationFrame(flush);
    };
    rafRef.current = requestAnimationFrame(flush);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const addMsg  = useCallback((m)=>{ const id=uid(); setMsgs(p=>[...p,{id,...m}]); return id; },[]);
  const updMsg  = useCallback((id,u)=>setMsgs(p=>p.map(m=>m.id===id?{...m,...u}:m)),[]);
  // Write to buffer — RAF loop drains it, never directly triggers re-render per token
  const bufText = useCallback((id,t)=>{ streamBuf.current[id]=(streamBuf.current[id]||'')+t; },[]);

  const handleArtifact = useCallback((a)=>setArtifact(a),[]);

  async function handleSend() {
    const text=input.trim(); if (!text||loading) return;
    if (!apiKey) { setError('Set your Anthropic API key in Settings'); return; }
    setInput(''); setError('');
    const si=[...images], sa=[...attachments];
    setImages([]); setAttachments([]);
    addMsg({type:'user',text,images:si,attachments:sa});
    setLoading(true);
    blockIds.current={};

    const storeSnap={counties:store.counties,hotLeads:store.hotLeads,surplusConfirmed:store.surplusConfirmed,logs,updateLeadStatus:store.updateLeadStatus,updateSurplusStatus:store.updateSurplusStatus};

    try {
      const finalMsgs=await runClaudeLoop({
        userText:text, images:si, attachments:sa, history:historyRef.current,
        apiKey, model, thinking, webSearch, storeSnap,
        onEvent:(ev)=>{
          switch(ev.type){
            case 'thinking_start': { const id=addMsg({type:'thinking',text:'',done:false}); blockIds.current[`th${ev.idx}`]=id; break; }
            case 'thinking_delta': { const id=blockIds.current[`th${ev.idx}`]; if(id)bufText(id,ev.text); break; }
            case 'thinking_done':  { const id=blockIds.current[`th${ev.idx}`]; if(id)updMsg(id,{done:true}); break; }
            case 'text_start':     { const id=addMsg({type:'assistant',text:'',done:false}); blockIds.current[`tx${ev.idx}`]=id; break; }
            case 'text_delta':     { const id=blockIds.current[`tx${ev.idx}`]; if(id)bufText(id,ev.text); break; }
            case 'text_done':      { const id=blockIds.current[`tx${ev.idx}`]; if(id)updMsg(id,{done:true}); break; }
            case 'tool_start':     { const id=addMsg({type:'tool',name:ev.name,done:false}); blockIds.current[`tool${ev.id}`]=id; break; }
            case 'tool_result':    {
              const id=blockIds.current[`tool${ev.id}`];
              if(id) updMsg(id,{done:true,result:ev.result});
              if(ev.name==='create_artifact'&&ev.result?.ok&&ev.result?.html) {
                setArtifact({title:ev.result.title,html:ev.result.html});
              }
              break;
            }
          }
        },
      });
      historyRef.current=finalMsgs.slice(-40);
      // Auto-save conversation
      const title=text.slice(0,50)+(text.length>50?'…':'');
      saveConversation(convId, title, [], historyRef.current);
      setConversations(loadConversations());
    } catch(e) { setError(e.message); }

    setLoading(false);
    inputRef.current?.focus();
  }

  function handleKey(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();} }

  async function handleFilePaste(e) {
    const items=e.clipboardData?.items; if(!items)return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      e.preventDefault();
      const file=item.getAsFile(); const reader=new FileReader();
      reader.onload=(re)=>{ const[,meta,data]=(re.target.result.match(/^data:([^;]+);base64,(.+)$/)||[]); if(data)setImages(p=>[...p,{name:file.name||'image.png',mediaType:meta,data}]); };
      reader.readAsDataURL(file);
    }
  }

  async function handleFileInput(e) {
    for (const file of e.target.files) {
      if (file.type.startsWith('image/')) {
        const reader=new FileReader();
        reader.onload=(re)=>{ const[,meta,data]=(re.target.result.match(/^data:([^;]+);base64,(.+)$/)||[]); if(data)setImages(p=>[...p,{name:file.name,mediaType:meta,data}]); };
        reader.readAsDataURL(file);
      } else {
        const reader=new FileReader();
        reader.onload=(re)=>setAttachments(p=>[...p,{name:file.name,content:re.target.result||''}]);
        reader.readAsText(file);
      }
    }
    e.target.value='';
  }

  function newConversation() { setMsgs([]); historyRef.current=[]; setError(''); setImages([]); setAttachments([]); setArtifact(null); setConvId(Date.now().toString()); setShowHistory(false); }
  function loadConv(conv) { historyRef.current=conv.history||[]; setMsgs([]); setConvId(conv.id); setShowHistory(false); addMsg({type:'assistant',text:`Loaded conversation: "${conv.title}" — continue where you left off.`,done:true}); }

  const Toggle=({label,value,onChange,color='green'})=>(
    <button onClick={()=>onChange(!value)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all" style={{
      background:value?(color==='purple'?'rgba(192,132,252,0.12)':'rgba(34,197,94,0.1)'):'rgba(255,255,255,0.04)',
      border:`1px solid ${value?(color==='purple'?'rgba(192,132,252,0.3)':'rgba(34,197,94,0.25)'):'rgba(255,255,255,0.07)'}`,
      color:value?(color==='purple'?'rgba(192,132,252,0.9)':'rgba(74,222,128,0.9)'):'rgba(156,163,175,0.6)'}}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background:value?(color==='purple'?'rgba(192,132,252,0.8)':'rgba(74,222,128,0.8)'):'rgba(75,85,99,0.8)'}}/>
      {label}
    </button>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* History sidebar */}
      {showHistory&&(
        <div className="w-56 flex-shrink-0 flex flex-col border-r" style={{background:'#080808',borderColor:'rgba(255,255,255,0.05)'}}>
          <div className="px-3 py-2.5 border-b flex items-center justify-between" style={{borderColor:'rgba(255,255,255,0.05)'}}>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">History</span>
            <button onClick={newConversation} className="text-[10px] text-brand-400 hover:text-brand-300 font-semibold transition-colors">+ New</button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {conversations.length===0&&<p className="text-[11px] text-gray-700 text-center py-4">No saved conversations</p>}
            {conversations.map(c=>(
              <button key={c.id} onClick={()=>loadConv(c)} className="w-full text-left px-3 py-2 hover:bg-white/[0.03] transition-colors group">
                <p className="text-[11px] text-gray-400 group-hover:text-gray-200 truncate transition-colors">{c.title}</p>
                <p className="text-[9px] text-gray-700 mt-0.5">{new Date(c.savedAt).toLocaleDateString()}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-2.5 border-b flex items-center justify-between" style={{borderColor:'rgba(255,255,255,0.05)'}}>
          <div className="flex items-center gap-3">
            <button onClick={()=>setShowHistory(v=>!v)} className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-white/5" style={{color:showHistory?'rgba(74,222,128,0.8)':'rgba(107,114,128,0.8)'}}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </button>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{background:'linear-gradient(135deg,rgba(34,197,94,0.25),rgba(34,197,94,0.08))',border:'1px solid rgba(34,197,94,0.2)'}}>
              <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            </div>
            <div>
              <h1 className="text-[12px] font-bold text-white tracking-tight">AI Control</h1>
              <p className="text-[9px] text-gray-600">Full capabilities — streaming · thinking · vision · artifacts · web</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Model selector */}
            <select value={model} onChange={e=>setModel(e.target.value)}
              className="text-[10px] font-bold text-gray-400 rounded-lg px-2 py-1 border transition-colors focus:outline-none cursor-pointer"
              style={{background:'rgba(255,255,255,0.04)',borderColor:'rgba(255,255,255,0.07)',color:'rgba(156,163,175,0.9)'}}>
              {MODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <Toggle label="Think" value={thinking} onChange={setThinking} color="purple"/>
            <Toggle label="Web"   value={webSearch} onChange={setWebSearch} color="green"/>
            {!apiKey&&<span className="text-[9px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-2 py-1">Set API key in Settings</span>}
            <span className="text-[9px] text-gray-600 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2 py-1 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-brand-500/70"/>
              Remote :{localStorage.getItem('mp_remote_control_port')||'3003'}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {msgs.length===0&&(
            <div className="flex flex-col items-center justify-center h-full gap-5 select-none">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{background:'linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.04))',border:'1px solid rgba(34,197,94,0.15)'}}>
                <svg className="w-6 h-6 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.4} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-gray-400 mb-0.5">Full capabilities active</p>
                <p className="text-[10px] text-gray-700">Sonnet 4.6 · Artifacts · Vision · Web · Tools · Thinking</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                {SUGGESTIONS.map(s=>(
                  <button key={s} onClick={()=>{setInput(s);inputRef.current?.focus();}}
                    className="text-left text-[11px] text-gray-600 hover:text-gray-300 rounded-xl px-3 py-2 transition-all leading-snug"
                    style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.05)'}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map(msg=>{
            if (msg.type==='user')      return <UserMsg      key={msg.id} msg={msg}/>;
            if (msg.type==='thinking')  return <ThinkingMsg  key={msg.id} msg={msg}/>;
            if (msg.type==='assistant') return <AssistantMsg key={msg.id} msg={msg} onArtifact={handleArtifact}/>;
            if (msg.type==='tool')      return <ToolMsg      key={msg.id} msg={msg}/>;
            return null;
          })}

          {loading&&msgs.length>0&&msgs[msgs.length-1]?.type!=='assistant'&&(
            <div className="flex items-center gap-2 ml-8 mb-3">
              {[0,150,300].map(d=><span key={d} className="w-1.5 h-1.5 rounded-full bg-brand-500/50 animate-bounce" style={{animationDelay:`${d}ms`}}/>)}
            </div>
          )}

          {error&&<div className="rounded-xl px-4 py-3 text-[12px] text-red-400 mb-3 ml-8" style={{background:'rgba(239,68,68,0.07)',border:'1px solid rgba(239,68,68,0.15)'}}>{error}</div>}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-4 pb-4 pt-2.5 border-t" style={{borderColor:'rgba(255,255,255,0.04)'}}>
          {(images.length>0||attachments.length>0)&&(
            <div className="flex gap-2 mb-2 flex-wrap">
              {images.map((img,i)=>(
                <div key={`i${i}`} className="relative group">
                  <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} className="h-11 w-auto rounded-lg border border-white/10 object-cover"/>
                  <button onClick={()=>setImages(p=>p.filter((_,j)=>j!==i))} className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                </div>
              ))}
              {attachments.map((a,i)=>(
                <div key={`a${i}`} className="relative group flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/10" style={{background:'rgba(255,255,255,0.04)'}}>
                  <svg className="w-3 h-3 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  <span className="text-[10px] text-gray-400 max-w-[80px] truncate">{a.name}</span>
                  <button onClick={()=>setAttachments(p=>p.filter((_,j)=>j!==i))} className="w-3 h-3 bg-red-500/80 rounded-full text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <label className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition-colors hover:bg-white/5 border border-white/[0.07]" style={{background:'rgba(255,255,255,0.03)'}}>
              <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              <input type="file" accept="image/*,text/*,.pdf,.csv,.txt,.md,.json,.docx,.xlsx,.js,.py,.ts" multiple className="hidden" onChange={handleFileInput}/>
            </label>
            <textarea
              ref={inputRef} value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={handleKey} onPaste={handleFilePaste}
              disabled={loading||!apiKey} rows={1}
              placeholder={apiKey?'Ask Claude anything — artifacts, analysis, code, leads, emails…':'Add Anthropic API key in Settings to enable'}
              className="flex-1 rounded-xl px-4 py-2.5 text-[13px] text-white placeholder-gray-700 resize-none transition-all disabled:opacity-30 focus:outline-none"
              style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',minHeight:'40px',maxHeight:'120px'}}
              onFocus={e=>e.target.style.borderColor='rgba(34,197,94,0.3)'}
              onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.07)'}
              onInput={e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}}
            />
            <button onClick={handleSend} disabled={loading||!input.trim()||!apiKey}
              className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              style={{background:'linear-gradient(135deg,#22c55e,#16a34a)'}}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            </button>
          </div>
          {msgs.length>0&&<button onClick={newConversation} className="mt-1.5 text-[10px] text-gray-700 hover:text-gray-500 transition-colors">New conversation</button>}
        </div>
      </div>

      {/* Artifact panel */}
      {artifact&&(
        <div className="w-[480px] flex-shrink-0">
          <ArtifactPanel artifact={artifact} onClose={()=>setArtifact(null)}/>
        </div>
      )}
    </div>
  );
}
