import React, { useState, useEffect, useRef } from 'react';

const { ipcRenderer } = window.require('electron');

export default function RemoteControlPanel() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const activityRef = useRef([]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 15000);

    // Live activity feed from main process
    const handler = (event, data) => {
      const entry = { ...data, id: Date.now() };
      activityRef.current = [entry, ...activityRef.current].slice(0, 30);
      setActivity([...activityRef.current]);
    };
    ipcRenderer.on('remote-control:activity', handler);

    return () => {
      clearInterval(interval);
      ipcRenderer.removeListener('remote-control:activity', handler);
    };
  }, []);

  async function loadStats() {
    try {
      const s = await ipcRenderer.invoke('remote:stats');
      setStats(s);
    } catch {}
  }

  async function clearSession(sessionId) {
    await ipcRenderer.invoke('remote:clear-session', { sessionId });
    loadStats();
  }

  const channelIcon = (ch) => ch === 'sms' ? '📱' : '🌐';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${stats?.httpRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
          <span className="font-semibold text-sm text-gray-800">Remote Control</span>
          {activity.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
              {activity.length} events
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <span className="text-xs text-gray-500">{stats.commandCount} commands total</span>
          )}
          <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Ports */}
          <div className="px-4 py-3 bg-gray-50 grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white rounded-lg p-2.5 border border-gray-100">
              <div className="text-gray-500 mb-0.5">SMS Webhook</div>
              <div className="font-mono text-gray-800">:3001/sms</div>
              <div className="text-green-600 mt-0.5">Twilio → Claude</div>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-gray-100">
              <div className="text-gray-500 mb-0.5">HTTP API</div>
              <div className="font-mono text-gray-800">:3003/remote</div>
              <div className={stats?.httpRunning ? 'text-green-600 mt-0.5' : 'text-gray-400 mt-0.5'}>
                {stats?.httpRunning ? 'Running' : 'Offline'}
              </div>
            </div>
          </div>

          {/* Active sessions */}
          {stats?.activeSessions?.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <div className="text-xs font-medium text-gray-600 mb-2">Active Sessions</div>
              <div className="space-y-1.5">
                {stats.activeSessions.map(s => (
                  <div key={s.sessionId} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-xs font-mono text-gray-700">{s.sessionId}</span>
                      <span className="text-xs text-gray-400 ml-2">{s.messageCount} msgs</span>
                    </div>
                    <button
                      onClick={() => clearSession(s.sessionId)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live activity feed */}
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-600 mb-2">Live Activity</div>
            {activity.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No activity yet. Text your Twilio number or POST to :3003/remote.
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {activity.map(a => (
                  <div key={a.id} className="flex gap-2 text-xs">
                    <span className="shrink-0">{channelIcon(a.channel)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-gray-500 truncate">{a.session}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-400 shrink-0">
                          {new Date(a.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {a.message && (
                        <div className="text-gray-700 truncate">→ {a.message}</div>
                      )}
                      {a.response && (
                        <div className="text-green-700 truncate">← {a.response}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Usage instructions */}
          <div className="px-4 py-3 border-t border-gray-100 bg-blue-50">
            <div className="text-xs font-medium text-blue-800 mb-1.5">How to use</div>
            <div className="text-xs text-blue-700 space-y-1">
              <p><strong>SMS:</strong> Text anything to +19046898998 — Claude answers with full app access.</p>
              <p><strong>API:</strong> <code className="bg-blue-100 px-1 rounded">POST :3003/remote</code> with <code className="bg-blue-100 px-1 rounded">{`{"message":"..."}`}</code></p>
              <p><strong>Reset SMS session:</strong> Text <code className="bg-blue-100 px-1 rounded">RESET</code> to start fresh.</p>
              <p><strong>Expose externally:</strong> Run <code className="bg-blue-100 px-1 rounded">ngrok http 3003</code> for true remote access.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
