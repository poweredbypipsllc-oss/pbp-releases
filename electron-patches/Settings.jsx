import React, { useState } from 'react';
import useAuthStore from '../store/authStore';
import { resetSupabaseClient, getSupabase, isSupabaseConfigured } from '../lib/supabase';
import { saveSettingsToDisk } from '../lib/settings';

function ClearRow({ label, table, desc }) {
  const [status, setStatus] = useState('');
  const configured = isSupabaseConfigured();

  async function clear() {
    if (!configured) { setStatus('Configure Supabase first.'); return; }
    if (!window.confirm(`Delete ALL rows from "${table}"? This cannot be undone.`)) return;
    setStatus('clearing...');
    const sb = getSupabase();
    const { error } = await sb.from(table).delete().not('id', 'is', null);
    if (error) {
      setStatus('Error: ' + error.message);
    } else {
      setStatus('Cleared.');
      setTimeout(() => setStatus(''), 3000);
    }
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-gray-600 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
        {status && (
          <span className={`text-xs ${status === 'Cleared.' ? 'text-brand-400' : status === 'clearing...' ? 'text-gray-400' : 'text-red-400'}`}>
            {status}
          </span>
        )}
        <button
          onClick={clear}
          className="px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-all whitespace-nowrap"
        >
          {status === 'clearing...' ? 'Clearing...' : 'Clear Table'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-surface-700 border border-white/[0.06] rounded-xl p-6 mb-5">
      <h2 className="text-sm font-bold text-white uppercase tracking-widest mb-5">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const INPUT = 'w-full bg-surface-600 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500/40 transition-all';

export default function Settings() {
  const { changePassword } = useAuthStore();

  const [supabase, setSupabase] = useState({
    url: localStorage.getItem('mp_supabase_url') || '',
    key: localStorage.getItem('mp_supabase_anon_key') || '',
  });

  const [email, setEmail] = useState({
    fromAddress:  localStorage.getItem('mp_from_address') || '',
    resendApiKey: localStorage.getItem('mp_resend_key') || '',
    hunterApiKey: localStorage.getItem('mp_hunter_key') || '',
  });

  const [tracerfy, setTracerfy] = useState({
    apiKey: localStorage.getItem('mp_tracerfy_key') || '',
  });

  const [anthropic, setAnthropic] = useState({
    apiKey: localStorage.getItem('mp_anthropic_key') || '',
  });

  const [template, setTemplate] = useState({
    subject: localStorage.getItem('mp_email_subject') || 'Important Notice: Unclaimed Funds in Your Name',
    body: localStorage.getItem('mp_email_body') ||
`Dear {name},

I am reaching out regarding unclaimed surplus funds of {amount} that may belong to you following a recent property sale.

These funds are currently held by the court and will be forfeited if unclaimed within the statutory period. Our firm recovers these funds for rightful owners at no upfront cost — we only collect a fee when you receive your money.

If you would like us to begin the recovery process on your behalf, please reply to this message or call us at your earliest convenience.

Sincerely,
Summit Claims Advisors
info@summitclaimsadvisors.com`,
  });

  const [bland, setBland] = useState({
    apiKey:        localStorage.getItem('mp_bland_key')      || '',
    voice:         localStorage.getItem('mp_bland_voice')    || 'maya',
    callbackPhone: localStorage.getItem('mp_callback_phone') || '',
  });

  const [twilio, setTwilio] = useState({
    sid:     localStorage.getItem('mp_twilio_sid')      || '',
    token:   localStorage.getItem('mp_twilio_token')    || '',
    from:    localStorage.getItem('mp_twilio_from')     || '',
    myPhone: localStorage.getItem('mp_twilio_my_phone') || '',
  });

  const [retell, setRetell] = useState({
    apiKey:        localStorage.getItem('mp_retell_api_key')         || '',
    agentId:       localStorage.getItem('mp_retell_agent_id')        || '',
    phoneNumberId: localStorage.getItem('mp_retell_phone_number_id') || '',
  });

  const [smtp, setSmtp] = useState({
    user: localStorage.getItem('mp_smtp_user') || '',
    pass: localStorage.getItem('mp_smtp_pass') || '',
  });

  const [remoteControl, setRemoteControl] = useState({
    token: localStorage.getItem('mp_remote_control_token') || '',
    port:  localStorage.getItem('mp_remote_control_port')  || '3003',
  });

  const [docusign, setDocusign] = useState({
    token:      localStorage.getItem('mp_docusign_token')    || '',
    accountId:  localStorage.getItem('mp_docusign_account')  || '',
    templateId: localStorage.getItem('mp_docusign_template') || '',
    baseUrl:    localStorage.getItem('mp_docusign_baseurl')  || 'https://na4.docusign.net',
  });
  const [dsTestStatus, setDsTestStatus] = useState('');

  const [gmail, setGmail] = useState({
    clientId:     localStorage.getItem('mp_gmail_client_id')     || '',
    clientSecret: localStorage.getItem('mp_gmail_client_secret') || '',
  });
  const [gmailConnectStatus, setGmailConnectStatus] = useState('');

  const [gmail2, setGmail2] = useState({
    clientId:     localStorage.getItem('mp_gmail2_client_id')     || '',
    clientSecret: localStorage.getItem('mp_gmail2_client_secret') || '',
  });
  const [gmail2ConnectStatus, setGmail2ConnectStatus] = useState('');

  const [password, setPassword] = useState({ username: '', current: '', newPass: '', confirm: '' });
  const [saved, setSaved] = useState('');
  const [testEmail, setTestEmail] = useState({ to: '', status: '' });

  function saveSupabase() {
    localStorage.setItem('mp_supabase_url', supabase.url);
    localStorage.setItem('mp_supabase_anon_key', supabase.key);
    resetSupabaseClient();
    setSaved('supabase');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveEmail() {
    localStorage.setItem('mp_from_address',  email.fromAddress);
    localStorage.setItem('mp_resend_key',    email.resendApiKey);
    localStorage.setItem('mp_hunter_key',    email.hunterApiKey);
    setSaved('email');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveBland() {
    localStorage.setItem('mp_bland_key',      bland.apiKey);
    localStorage.setItem('mp_bland_voice',    bland.voice);
    localStorage.setItem('mp_callback_phone', bland.callbackPhone);
    setSaved('bland');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveTwilio() {
    localStorage.setItem('mp_twilio_sid',      twilio.sid);
    localStorage.setItem('mp_twilio_token',    twilio.token);
    localStorage.setItem('mp_twilio_from',     twilio.from);
    localStorage.setItem('mp_twilio_my_phone', twilio.myPhone);
    setSaved('twilio');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveRetell() {
    localStorage.setItem('mp_retell_api_key',         retell.apiKey);
    localStorage.setItem('mp_retell_agent_id',        retell.agentId);
    localStorage.setItem('mp_retell_phone_number_id', retell.phoneNumberId);
    setSaved('retell');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveSmtp() {
    localStorage.setItem('mp_smtp_user', smtp.user);
    localStorage.setItem('mp_smtp_pass', smtp.pass);
    setSaved('smtp');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveRemoteControl() {
    localStorage.setItem('mp_remote_control_token', remoteControl.token);
    localStorage.setItem('mp_remote_control_port',  remoteControl.port);
    setSaved('remoteControl');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveGmail() {
    localStorage.setItem('mp_gmail_client_id',     gmail.clientId);
    localStorage.setItem('mp_gmail_client_secret', gmail.clientSecret);
    setSaved('gmail');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  async function connectGmail() {
    if (!gmail.clientId || !gmail.clientSecret) {
      setGmailConnectStatus('error:Paste your Client ID and Secret first.');
      return;
    }
    if (!window.electronAPI) {
      setGmailConnectStatus('error:Desktop app required.');
      return;
    }
    saveGmail();
    setGmailConnectStatus('loading');
    const res = await window.electronAPI.gmailAuthStart({ clientId: gmail.clientId, clientSecret: gmail.clientSecret });
    if (res.success) {
      setGmailConnectStatus('success:Gmail connected! Check the Messages page.');
    } else {
      setGmailConnectStatus('error:' + res.error);
    }
    setTimeout(() => setGmailConnectStatus(''), 6000);
  }

  async function disconnectGmail() {
    if (!window.electronAPI) return;
    await window.electronAPI.gmailDisconnect();
    setGmailConnectStatus('success:Disconnected.');
    setTimeout(() => setGmailConnectStatus(''), 3000);
  }

  function saveGmail2() {
    localStorage.setItem('mp_gmail2_client_id',     gmail2.clientId);
    localStorage.setItem('mp_gmail2_client_secret', gmail2.clientSecret);
    setSaved('gmail2');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  async function connectGmail2() {
    if (!gmail2.clientId || !gmail2.clientSecret) {
      setGmail2ConnectStatus('error:Paste your Client ID and Secret first.');
      return;
    }
    if (!window.electronAPI) {
      setGmail2ConnectStatus('error:Desktop app required.');
      return;
    }
    saveGmail2();
    setGmail2ConnectStatus('loading');
    const res = await window.electronAPI.gmail2AuthStart({ clientId: gmail2.clientId, clientSecret: gmail2.clientSecret });
    if (res.success) {
      setGmail2ConnectStatus('success:info@ Gmail connected! Check the Messages page.');
    } else {
      setGmail2ConnectStatus('error:' + res.error);
    }
    setTimeout(() => setGmail2ConnectStatus(''), 6000);
  }

  async function disconnectGmail2() {
    if (!window.electronAPI) return;
    await window.electronAPI.gmail2Disconnect();
    setGmail2ConnectStatus('success:Disconnected.');
    setTimeout(() => setGmail2ConnectStatus(''), 3000);
  }

  function saveDocusign() {
    localStorage.setItem('mp_docusign_token',    docusign.token);
    localStorage.setItem('mp_docusign_account',  docusign.accountId);
    localStorage.setItem('mp_docusign_template', docusign.templateId);
    localStorage.setItem('mp_docusign_baseurl',  docusign.baseUrl || 'https://na4.docusign.net');
    setSaved('docusign');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  async function testDocuSign() {
    if (!docusign.token) { setDsTestStatus('error:Paste your Access Token first.'); return; }
    setDsTestStatus('loading');
    try {
      const res = await fetch('https://account.docusign.com/oauth/userinfo', {
        headers: { Authorization: 'Bearer ' + docusign.token },
      });
      const data = await res.json();
      if (!res.ok || !data.accounts) {
        setDsTestStatus('error:' + (data.error_description || data.error || 'Invalid token'));
        return;
      }
      const acct = data.accounts.find((a) => a.is_default) || data.accounts[0];
      setDocusign((s) => ({ ...s, accountId: acct.account_id, baseUrl: acct.base_uri }));
      setDsTestStatus('ok:Connected — ' + acct.account_name);
    } catch (e) {
      setDsTestStatus('error:' + e.message);
    }
  }

  function saveTracerfy() {
    localStorage.setItem('mp_tracerfy_key', tracerfy.apiKey);
    setSaved('tracerfy');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveAnthropic() {
    localStorage.setItem('mp_anthropic_key', anthropic.apiKey);
    setSaved('anthropic');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function saveTemplate() {
    localStorage.setItem('mp_email_subject', template.subject);
    localStorage.setItem('mp_email_body',    template.body);
    setSaved('template');
    setTimeout(() => setSaved(''), 2500);
    saveSettingsToDisk();
  }

  function savePassword() {
    if (!password.newPass || password.newPass !== password.confirm) {
      alert('Passwords do not match.');
      return;
    }
    changePassword(password.username || undefined, password.newPass);
    setPassword({ username: '', current: '', newPass: '', confirm: '' });
    setSaved('password');
    setTimeout(() => setSaved(''), 2500);
  }

  const SaveBtn = ({ id, onClick }) => (
    <button onClick={onClick} className="mt-2 px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold transition-all">
      {saved === id ? 'Saved' : 'Save'}
    </button>
  );

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-xs text-gray-600 mt-0.5">App configuration and account settings</p>
      </div>

      {/* Supabase */}
      <Section title="Database — Supabase">
        <p className="text-xs text-gray-500 mb-4">Enter your Supabase project URL and anon key to enable persistent data storage.</p>
        <Field label="Project URL">
          <input type="text" className={INPUT} placeholder="https://xxxx.supabase.co" value={supabase.url} onChange={(e) => setSupabase((s) => ({ ...s, url: e.target.value }))} />
        </Field>
        <Field label="Anon / Public Key">
          <input type="password" className={INPUT} placeholder="eyJh..." value={supabase.key} onChange={(e) => setSupabase((s) => ({ ...s, key: e.target.value }))} />
        </Field>
        <SaveBtn id="supabase" onClick={saveSupabase} />
      </Section>

      {/* Email / Resend */}
      <Section title="Email — Bot Credentials">
        <p className="text-xs text-gray-500 mb-4">
          Get your Resend API key at <span className="text-brand-400">resend.com</span>. Add and verify your sending domain there first, then paste the key below.
        </p>
        <Field label="From Address">
          <input type="text" className={INPUT} placeholder="outreach@yourdomain.com" value={email.fromAddress} onChange={(e) => setEmail((s) => ({ ...s, fromAddress: e.target.value }))} />
        </Field>
        <Field label="Resend API Key">
          <input type="password" className={INPUT} placeholder="re_..." value={email.resendApiKey} onChange={(e) => setEmail((s) => ({ ...s, resendApiKey: e.target.value }))} />
        </Field>
        <Field label="Hunter.io API Key (optional — Bot 3 skip tracing)">
          <input type="password" className={INPUT} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={email.hunterApiKey} onChange={(e) => setEmail((s) => ({ ...s, hunterApiKey: e.target.value }))} />
        </Field>
        <SaveBtn id="email" onClick={saveEmail} />

        {/* Test send */}
        <div className="mt-5 pt-5 border-t border-white/5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-3">Send Test Email</p>
          <div className="flex items-center gap-3">
            <input
              type="email"
              placeholder="Send test to this address..."
              value={testEmail.to}
              onChange={(e) => setTestEmail((t) => ({ ...t, to: e.target.value, status: '' }))}
              className="flex-1 bg-surface-600 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500/40 transition-all"
            />
            <button
              onClick={async () => {
                setTestEmail((t) => ({ ...t, status: 'sending' }));
                const apiKey = email.resendApiKey;
                const from   = email.fromAddress;
                if (!apiKey || !from || !testEmail.to) {
                  setTestEmail((t) => ({ ...t, status: 'error: fill in API key, From Address, and test recipient' }));
                  return;
                }
                if (!window.electronAPI) {
                  setTestEmail((t) => ({ ...t, status: 'error: desktop app required' }));
                  return;
                }
                const result = await window.electronAPI.sendEmail({
                  apiKey,
                  from,
                  to: testEmail.to,
                  subject: 'MONEY PRINTER — Test Email',
                  text: 'This is a test email from MONEY PRINTER. Your Resend integration is working correctly.',
                });
                setTestEmail((t) => ({ ...t, status: result.success ? 'sent' : `error: ${result.error}` }));
              }}
              disabled={testEmail.status === 'sending'}
              className="px-4 py-2.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-sm font-semibold border border-brand-500/20 transition-all disabled:opacity-50 whitespace-nowrap"
            >
              {testEmail.status === 'sending' ? 'Sending...' : 'Send Test'}
            </button>
          </div>
          {testEmail.status && testEmail.status !== 'sending' && (
            <p className={`text-xs mt-2 ${testEmail.status === 'sent' ? 'text-brand-400' : 'text-red-400'}`}>
              {testEmail.status === 'sent' ? 'Test email delivered successfully.' : testEmail.status}
            </p>
          )}
        </div>
      </Section>

      {/* Tracerfy */}
      <Section title="Skip Tracer — Tracerfy">
        <p className="text-xs text-gray-500 mb-4">
          Tracerfy provides real estate skip tracing at $0.02/hit — misses are free. Get your API key from your Tracerfy dashboard after adding credits.
        </p>
        <Field label="API Key">
          <input
            type="password"
            className={INPUT}
            placeholder="tf_live_..."
            value={tracerfy.apiKey}
            onChange={(e) => setTracerfy((s) => ({ ...s, apiKey: e.target.value }))}
          />
        </Field>
        <SaveBtn id="tracerfy" onClick={saveTracerfy} />
      </Section>

      {/* Anthropic */}
      <Section title="Document OCR — Anthropic Claude">
        <p className="text-xs text-gray-500 mb-4">
          Used by the County Records bot to read scanned court document images. Claude Haiku reads each document page and extracts the amount owed. Typical cost: ~$0.002 per document image.
        </p>
        <Field label="API Key">
          <input
            type="password"
            className={INPUT}
            placeholder="sk-ant-..."
            value={anthropic.apiKey}
            onChange={(e) => setAnthropic((s) => ({ ...s, apiKey: e.target.value }))}
          />
        </Field>
        <SaveBtn id="anthropic" onClick={saveAnthropic} />
      </Section>

      {/* Bland.ai */}
      <Section title="Voicemail — Bland.ai">
        <p className="text-xs text-gray-500 mb-4">
          Bland.ai drops personalized ringless voicemails with the owner's name, fund amount, and property address.
          Get your API key at <span className="text-brand-400">bland.ai</span>. Set your business callback number so people know who to call back.
        </p>
        <Field label="API Key">
          <input type="password" className={INPUT} placeholder="sk-..." value={bland.apiKey} onChange={(e) => setBland((s) => ({ ...s, apiKey: e.target.value }))} />
        </Field>
        <Field label="Voice (default: maya)">
          <input type="text" className={INPUT} placeholder="maya" value={bland.voice} onChange={(e) => setBland((s) => ({ ...s, voice: e.target.value }))} />
        </Field>
        <Field label="Callback Phone Number (your business number)">
          <input type="text" className={INPUT} placeholder="(555) 000-0000" value={bland.callbackPhone} onChange={(e) => setBland((s) => ({ ...s, callbackPhone: e.target.value }))} />
        </Field>
        <SaveBtn id="bland" onClick={saveBland} />
      </Section>

      {/* Twilio */}
      <Section title="SMS — Twilio">
        <p className="text-xs text-gray-500 mb-4">
          Twilio sends the Touch 3 follow-up SMS 48 hours after the voicemail drop.
          Get credentials at <span className="text-brand-400">twilio.com</span> — you need a Twilio phone number to send from.
        </p>
        <Field label="Account SID">
          <input type="text" className={INPUT} placeholder="ACxxxxxxxxxxxxxxxx" value={twilio.sid} onChange={(e) => setTwilio((s) => ({ ...s, sid: e.target.value }))} />
        </Field>
        <Field label="Auth Token">
          <input type="password" className={INPUT} placeholder="xxxxxxxxxxxxxxxx" value={twilio.token} onChange={(e) => setTwilio((s) => ({ ...s, token: e.target.value }))} />
        </Field>
        <Field label="From Number (Twilio number)">
          <input type="text" className={INPUT} placeholder="+15550001234" value={twilio.from} onChange={(e) => setTwilio((s) => ({ ...s, from: e.target.value }))} />
        </Field>
        <Field label="My Phone Number (receives instant NOS alerts)">
          <input type="text" className={INPUT} placeholder="+15550001234" value={twilio.myPhone} onChange={(e) => setTwilio((s) => ({ ...s, myPhone: e.target.value }))} />
          <p className="text-[11px] text-gray-600 mt-1">You'll get a text the instant every lead is found. Must be verified in Twilio trial console.</p>
        </Field>
        <SaveBtn id="twilio" onClick={saveTwilio} />
      </Section>

      {/* Retell AI */}
      <Section title="Voice Calls — Retell AI">
        <p className="text-xs text-gray-500 mb-4">
          Retell AI makes automated AI voice calls to leads. Get your API key at <span className="text-brand-400">retellai.com</span>. Create an agent and buy a phone number in the Retell dashboard, then paste the IDs below.
        </p>
        <Field label="API Key">
          <input type="password" className={INPUT} placeholder="key_..." value={retell.apiKey} onChange={(e) => setRetell((s) => ({ ...s, apiKey: e.target.value }))} />
        </Field>
        <Field label="Agent ID">
          <input type="text" className={INPUT} placeholder="agent_xxxxxxxxxxxxxxxx" value={retell.agentId} onChange={(e) => setRetell((s) => ({ ...s, agentId: e.target.value }))} />
        </Field>
        <Field label="Phone Number ID">
          <input type="text" className={INPUT} placeholder="phone_xxxxxxxxxxxxxxxx" value={retell.phoneNumberId} onChange={(e) => setRetell((s) => ({ ...s, phoneNumberId: e.target.value }))} />
        </Field>
        <SaveBtn id="retell" onClick={saveRetell} />
      </Section>

      {/* SMTP */}
      <Section title="Mass Outreach Email — SMTP (info@)">
        <p className="text-xs text-gray-500 mb-4">
          Gmail SMTP for sending bulk outreach emails from <code className="text-brand-400 bg-brand-500/10 px-1 rounded">info@summitclaimsadvisors.com</code>. You need a Gmail App Password — enable 2-Step Verification in your Google account, then visit <span className="text-brand-400">myaccount.google.com/apppasswords</span> to generate one. Do NOT use your regular Gmail password.
        </p>
        <Field label="Gmail Address">
          <input type="text" className={INPUT} placeholder="info@summitclaimsadvisors.com" value={smtp.user} onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))} />
        </Field>
        <Field label="App Password (16-character code from Google)">
          <input type="password" className={INPUT} placeholder="xxxx xxxx xxxx xxxx" value={smtp.pass} onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))} />
        </Field>
        <SaveBtn id="smtp" onClick={saveSmtp} />
      </Section>

      {/* Remote Control */}
      <Section title="Remote Control API">
        <p className="text-xs text-gray-500 mb-4">
          Allows you to control the app remotely via SMS or HTTP. Text anything to your Twilio number and the AI will respond with full app access. The HTTP API lets you send commands from anywhere — use <span className="text-brand-400">ngrok</span> to expose it externally.
        </p>
        <div className="mb-4 p-3 rounded-lg border border-brand-500/20 bg-brand-500/5">
          <p className="text-[11px] text-brand-400 font-semibold mb-1">How to use SMS remote control</p>
          <p className="text-[11px] text-gray-500">Text anything to your Twilio number — e.g. "show me the 5 newest leads" or "start a Duval scan". The AI replies instantly with full database access. Text <code className="text-brand-400">RESET</code> to start a fresh session.</p>
        </div>
        <Field label="API Token (protects the HTTP endpoint)">
          <input type="password" className={INPUT} placeholder="Set a secret token for HTTP requests" value={remoteControl.token} onChange={(e) => setRemoteControl((s) => ({ ...s, token: e.target.value }))} />
          <p className="text-[11px] text-gray-600 mt-1">Send as: <code className="text-brand-400">{"POST :3003/remote"}</code> with body <code className="text-brand-400">{'{"message":"...","token":"yourtoken"}'}</code></p>
        </Field>
        <Field label="HTTP Port (default: 3003)">
          <input type="number" className={INPUT} placeholder="3003" value={remoteControl.port} onChange={(e) => setRemoteControl((s) => ({ ...s, port: e.target.value }))} />
        </Field>
        <SaveBtn id="remoteControl" onClick={saveRemoteControl} />
      </Section>

      {/* DocuSign */}
      <Section title="DocuSign — Contracts">
        <p className="text-xs text-gray-500 mb-4">
          DocuSign sends your recovery agreement for e-signature. Paste your Access Token below and click
          <strong className="text-gray-400"> Test &amp; Auto-Detect</strong> — it will find your Account ID and server
          automatically. Then create a template in DocuSign with tabs named&nbsp;
          <code className="text-brand-400 bg-brand-500/10 px-1 rounded">Amount</code>&nbsp;
          <code className="text-brand-400 bg-brand-500/10 px-1 rounded">Address</code>&nbsp;
          <code className="text-brand-400 bg-brand-500/10 px-1 rounded">FeePct</code>&nbsp;
          <code className="text-brand-400 bg-brand-500/10 px-1 rounded">FullName</code> and paste the Template ID below.
        </p>
        <Field label="Access Token">
          <div className="flex gap-2">
            <input type="password" className={INPUT + ' flex-1'} placeholder="eyJ0eXAiOiJKV1Qi..." value={docusign.token} onChange={(e) => setDocusign((s) => ({ ...s, token: e.target.value }))} />
            <button
              onClick={testDocuSign}
              disabled={dsTestStatus === 'loading'}
              className="shrink-0 px-3 py-2 rounded-lg bg-surface-600 border border-white/10 text-xs font-semibold text-gray-300 hover:text-white hover:border-brand-500/40 disabled:opacity-50 transition-all whitespace-nowrap"
            >
              {dsTestStatus === 'loading' ? 'Detecting...' : 'Test & Auto-Detect'}
            </button>
          </div>
          {dsTestStatus && dsTestStatus !== 'loading' && (
            <p className={'text-xs mt-2 ' + (dsTestStatus.startsWith('ok:') ? 'text-brand-400' : 'text-red-400')}>
              {dsTestStatus.startsWith('ok:') ? '✓ ' : '✗ '}{dsTestStatus.replace(/^(ok|error):/, '')}
            </p>
          )}
        </Field>
        <Field label="Account ID">
          <input type="text" className={INPUT} placeholder="Auto-filled by Test & Auto-Detect" value={docusign.accountId} onChange={(e) => setDocusign((s) => ({ ...s, accountId: e.target.value }))} />
        </Field>
        <Field label="API Base URL">
          <input type="text" className={INPUT} placeholder="https://na4.docusign.net" value={docusign.baseUrl} onChange={(e) => setDocusign((s) => ({ ...s, baseUrl: e.target.value }))} />
        </Field>
        <Field label="Template ID">
          <input type="text" className={INPUT} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={docusign.templateId} onChange={(e) => setDocusign((s) => ({ ...s, templateId: e.target.value }))} />
        </Field>
        <SaveBtn id="docusign" onClick={saveDocusign} />
      </Section>

      {/* Gmail Inbox */}
      <Section title="Gmail Inbox — sumeet@summitclaimsadvisors.com">
        <p className="text-xs text-gray-500 mb-4">
          Connect your Google Workspace inbox so messages appear in the Messages page.
          Requires a <strong className="text-gray-400">Google Cloud OAuth 2.0 credential</strong> (Desktop app type) with Gmail API enabled.
          Add <code className="text-brand-400 bg-brand-500/10 px-1 rounded">http://127.0.0.1</code> as an authorized redirect URI.
        </p>
        <Field label="OAuth Client ID">
          <input
            type="text"
            className={INPUT}
            placeholder="xxxxxxxxxx.apps.googleusercontent.com"
            value={gmail.clientId}
            onChange={e => setGmail(s => ({ ...s, clientId: e.target.value }))}
          />
        </Field>
        <Field label="OAuth Client Secret">
          <input
            type="password"
            className={INPUT}
            placeholder="GOCSPX-..."
            value={gmail.clientSecret}
            onChange={e => setGmail(s => ({ ...s, clientSecret: e.target.value }))}
          />
        </Field>
        {gmailConnectStatus && (
          <p className={`text-xs mb-3 ${gmailConnectStatus.startsWith('error:') ? 'text-red-400' : gmailConnectStatus === 'loading' ? 'text-gray-500' : 'text-green-400'}`}>
            {gmailConnectStatus === 'loading' ? 'Opening browser for authorization...' : gmailConnectStatus.replace(/^(error:|success:)/, '')}
          </p>
        )}
        <div className="flex gap-3 mt-2">
          <button
            onClick={connectGmail}
            disabled={gmailConnectStatus === 'loading'}
            className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white text-sm font-semibold transition-all"
          >
            {gmailConnectStatus === 'loading' ? 'Waiting for auth...' : 'Connect Gmail'}
          </button>
          <button
            onClick={disconnectGmail}
            className="px-4 py-2 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white hover:border-white/20 transition-all"
          >
            Disconnect
          </button>
        </div>
      </Section>

      {/* Gmail Inbox — info@ */}
      <Section title="Gmail Inbox — info@summitclaimsadvisors.com">
        <p className="text-xs text-gray-500 mb-4">
          Connect your info@ inbox to view website inquiries and bot-sent emails.
          You can reuse the same Google Cloud OAuth 2.0 credential — the authorization
          flow will let you select info@summitclaimsadvisors.com.
        </p>
        <Field label="OAuth Client ID">
          <input
            type="text"
            className={INPUT}
            placeholder="xxxxxxxxxx.apps.googleusercontent.com"
            value={gmail2.clientId}
            onChange={e => setGmail2(s => ({ ...s, clientId: e.target.value }))}
          />
        </Field>
        <Field label="OAuth Client Secret">
          <input
            type="password"
            className={INPUT}
            placeholder="GOCSPX-..."
            value={gmail2.clientSecret}
            onChange={e => setGmail2(s => ({ ...s, clientSecret: e.target.value }))}
          />
        </Field>
        {gmail2ConnectStatus && (
          <p className={`text-xs mb-3 ${gmail2ConnectStatus.startsWith('error:') ? 'text-red-400' : gmail2ConnectStatus === 'loading' ? 'text-gray-500' : 'text-green-400'}`}>
            {gmail2ConnectStatus === 'loading' ? 'Opening browser for authorization...' : gmail2ConnectStatus.replace(/^(error:|success:)/, '')}
          </p>
        )}
        <div className="flex gap-3 mt-2">
          <button
            onClick={connectGmail2}
            disabled={gmail2ConnectStatus === 'loading'}
            className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white text-sm font-semibold transition-all"
          >
            {gmail2ConnectStatus === 'loading' ? 'Waiting for auth...' : 'Connect info@ Gmail'}
          </button>
          <button
            onClick={disconnectGmail2}
            className="px-4 py-2 rounded-lg border border-white/10 text-sm text-gray-400 hover:text-white hover:border-white/20 transition-all"
          >
            Disconnect
          </button>
        </div>
      </Section>

      {/* Email Template */}
      <Section title="Email Template">
        <p className="text-xs text-gray-500 mb-4">
          Use <code className="text-brand-400 bg-brand-500/10 px-1 rounded">{'{name}'}</code> and{' '}
          <code className="text-brand-400 bg-brand-500/10 px-1 rounded">{'{amount}'}</code> as placeholders.
        </p>
        <Field label="Subject Line">
          <input type="text" className={INPUT} value={template.subject} onChange={(e) => setTemplate((t) => ({ ...t, subject: e.target.value }))} />
        </Field>
        <Field label="Email Body">
          <textarea
            rows={10}
            className={`${INPUT} resize-none font-mono text-xs leading-relaxed`}
            value={template.body}
            onChange={(e) => setTemplate((t) => ({ ...t, body: e.target.value }))}
          />
        </Field>
        <SaveBtn id="template" onClick={saveTemplate} />
      </Section>

      {/* Data Management */}
      <Section title="Data Management">
        <p className="text-xs text-gray-500 mb-5">
          Clear tables in your Supabase database. Use before switching to live operation.
          These actions are permanent and cannot be undone.
        </p>
        <div className="space-y-3">
          {[
            { key: 'sf',  label: 'Clear Surplus Funds',  table: 'surplus_funds',   desc: 'Remove all surplus fund records (scraped lists, owner data, email status)' },
            { key: 'ra',  label: 'Clear Raw Auctions',   table: 'raw_auctions',    desc: 'Remove all raw auction records pulled by the Auction Monitor' },
            { key: 'ud',  label: 'Clear Undelivered',    table: 'undelivered_emails', desc: 'Remove all undelivered email records' },
            { key: 'log', label: 'Clear Bot Logs',       table: 'bot_logs',        desc: 'Remove all stored bot log entries from Supabase' },
          ].map(({ key, label, table, desc }) => (
            <ClearRow key={key} label={label} table={table} desc={desc} />
          ))}
        </div>
      </Section>

      {/* Change Password */}
      <Section title="Account">
        <div className="grid grid-cols-2 gap-4">
          <Field label="New Username (optional)">
            <input type="text" className={INPUT} placeholder="Leave blank to keep current" value={password.username} onChange={(e) => setPassword((p) => ({ ...p, username: e.target.value }))} />
          </Field>
          <div />
          <Field label="New Password">
            <input type="password" className={INPUT} placeholder="••••••••" value={password.newPass} onChange={(e) => setPassword((p) => ({ ...p, newPass: e.target.value }))} />
          </Field>
          <Field label="Confirm Password">
            <input type="password" className={INPUT} placeholder="••••••••" value={password.confirm} onChange={(e) => setPassword((p) => ({ ...p, confirm: e.target.value }))} />
          </Field>
        </div>
        <SaveBtn id="password" onClick={savePassword} />
      </Section>
    </div>
  );
}

