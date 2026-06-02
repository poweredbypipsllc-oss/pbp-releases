// ─── PATCH: Add to App.jsx ─────────────────────────────────────────────────────
//
// STEP 1 — Find your existing lazy imports (e.g., const ClaudeControl = lazy(...))
// Add these two lines right after them:
//
const AgentChatbot      = lazy(() => import('./components/AgentChatbot'));
const RemoteControlPanel = lazy(() => import('./components/RemoteControlPanel'));
//
// ─────────────────────────────────────────────────────────────────────────────────
//
// STEP 2 — Find your <Routes> block. Add these two <Route> entries alongside
// your existing routes (e.g., next to the ClaudeControl route):
//
// <Route path="/chatbot"        element={<AgentChatbot />} />
// <Route path="/remote-control" element={<RemoteControlPanel />} />
//
// ─────────────────────────────────────────────────────────────────────────────────
//
// STEP 3 — Find your sidebar / nav links. Add entries for the new pages.
// Match the style of your existing nav items.  Example link objects:
//
// { path: '/chatbot',        label: 'AI Chatbot',       icon: 'chat'   }
// { path: '/remote-control', label: 'Remote Control',   icon: 'signal' }
//
// ─────────────────────────────────────────────────────────────────────────────────
//
// OPTIONAL — If you prefer not to add new routes, you can use these components
// directly inside ClaudeControl.jsx or any other page:
//
// import AgentChatbot       from '../components/AgentChatbot';
// import RemoteControlPanel from '../components/RemoteControlPanel';
//
// Then render them as:
//   <AgentChatbot />          ← IPC-based chat connected to backend claudeAgent
//   <RemoteControlPanel />    ← Live remote control stats and activity feed
//
// AgentChatbot is the in-app interface to the SAME backend agent exposed
// via SMS (port 3001) and HTTP API (port 3003).  Use it to test remote control.
