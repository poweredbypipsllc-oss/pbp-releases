const KEYS = [
  'mp_supabase_url', 'mp_supabase_anon_key',
  'mp_from_address', 'mp_resend_key', 'mp_hunter_key',
  'mp_tracerfy_key', 'mp_anthropic_key',
  'mp_email_subject', 'mp_email_body',
  'mp_bland_key', 'mp_bland_voice', 'mp_callback_phone',
  'mp_twilio_sid', 'mp_twilio_token', 'mp_twilio_from', 'mp_twilio_my_phone',
  'mp_retell_api_key', 'mp_retell_agent_id', 'mp_retell_phone_number_id',
  'mp_remote_control_token', 'mp_remote_control_port',
  'mp_smtp_user', 'mp_smtp_pass',
  'mp_docusign_token', 'mp_docusign_account', 'mp_docusign_template', 'mp_docusign_baseurl',
  'mp_gmail_client_id', 'mp_gmail_client_secret',
];

export async function loadSettingsFromDisk() {
  if (!window.electronAPI?.loadSettings) return;
  const saved = await window.electronAPI.loadSettings();
  if (!saved) return;
  for (const [key, value] of Object.entries(saved)) {
    if (value != null) localStorage.setItem(key, value);
  }
}

export async function saveSettingsToDisk() {
  if (!window.electronAPI?.saveSettings) return;
  const data = {};
  for (const key of KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) data[key] = val;
  }
  await window.electronAPI.saveSettings(data);
}
