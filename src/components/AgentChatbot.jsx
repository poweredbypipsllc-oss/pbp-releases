import React, { useState, useRef, useEffect, useCallback } from 'react';

const { ipcRenderer } = window.require('electron');

const QUICK_ACTIONS = [
  { label: 'Show hot leads', prompt: 'Show me the 10 most recent hot leads' },
  { label: 'Scan status', prompt: 'What is the current bot scan status for all counties?' },
  { label: "Today's stats", prompt: 'Give me a full summary of today — leads found, outreach sent, and anything pending' },
  { label: 'Pending outreach', prompt: 'Show me all leads with outreach_status = pending, limit 20' },
  { label: 'Trigger scan', prompt: 'Trigger a scan for Duval county' },
];

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-900 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shrink-0">
          AI
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
        }`}
      >
        {msg.type === 'tool_activity' ? (
          <span className="text-xs text-blue-500 italic">{msg.text}</span>
        ) : (
          <FormattedText text={msg.text} />
        )}
        {msg.loading && (
          <span className="inline-flex gap-1 ml-1">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-xs font-bold ml-2 mt-1 shrink-0">
          S
        </div>
      )}
    </div>
  );
}

function FormattedText({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="font-bold">{line.slice(2, -2)}</p>;
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return <li key={i} className="ml-3 list-disc">{line.slice(2)}</li>;
        }
        if (line.trim() === '') return <br key={i} />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export default function AgentChatbot() {
  const [messages, setMessages] = useState([
    {
      id: 0,
      role: 'assistant',
      text: "I'm your Summit Claims AI — fully connected to the leads database, bot status, and outreach system. What do you need?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [streamingId, setStreamingId] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const idCounter = useRef(1);

  const nextId = () => ++idCounter.current;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for streaming chunks from main process
  useEffect(() => {
    const handler = (event, chunk) => {
      if (chunk.type === 'text') {
        setMessages(prev => prev.map(m =>
          m.id === streamingId
            ? { ...m, text: m.text + chunk.delta, loading: false }
            : m
        ));
      } else if (chunk.type === 'tool_start') {
        setMessages(prev => {
          const toolMsg = {
            id: nextId(),
            role: 'assistant',
            type: 'tool_activity',
            text: `⚙️ Running: ${chunk.tool}...`
          };
          return [...prev.slice(0, -1), toolMsg, prev[prev.length - 1]];
        });
      } else if (chunk.type === 'done') {
        setIsStreaming(false);
        setStreamingId(null);
      } else if (chunk.type === 'error') {
        setMessages(prev => prev.map(m =>
          m.id === streamingId
            ? { ...m, text: chunk.error, loading: false, error: true }
            : m
        ));
        setIsStreaming(false);
        setStreamingId(null);
      }
    };

    ipcRenderer.on('chatbot:stream:chunk', handler);
    return () => ipcRenderer.removeListener('chatbot:stream:chunk', handler);
  }, [streamingId]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() && !imageFile) return;
    if (isStreaming) return;

    const userMsg = { id: nextId(), role: 'user', text: text || '[Image attached]' };
    const assistantId = nextId();
    const assistantMsg = { id: assistantId, role: 'assistant', text: '', loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingId(assistantId);

    let imageData = null;
    if (imageFile) {
      const arrayBuffer = await imageFile.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      imageData = { base64, mimeType: imageFile.type };
      setImageFile(null);
    }

    ipcRenderer.send('chatbot:stream', { message: text, imageData });
  }, [isStreaming, imageFile]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleClear = async () => {
    await ipcRenderer.invoke('chatbot:clear');
    setMessages([{
      id: nextId(),
      role: 'assistant',
      text: "History cleared. Fresh start — what do you need?"
    }]);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) setImageFile(file);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-blue-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
          <span className="font-semibold text-sm">Summit Claims AI</span>
          <span className="text-blue-300 text-xs">— Second in Command</span>
        </div>
        <button
          onClick={handleClear}
          className="text-blue-300 hover:text-white text-xs transition-colors"
          title="Clear conversation history"
        >
          Clear history
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto shrink-0 bg-white border-b border-gray-100">
        {QUICK_ACTIONS.map((a, i) => (
          <button
            key={i}
            onClick={() => sendMessage(a.prompt)}
            disabled={isStreaming}
            className="shrink-0 text-xs bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Image preview */}
      {imageFile && (
        <div className="px-4 pb-2 flex items-center gap-2 shrink-0">
          <img
            src={URL.createObjectURL(imageFile)}
            alt="attachment"
            className="h-14 w-14 object-cover rounded border border-gray-200"
          />
          <button
            onClick={() => setImageFile(null)}
            className="text-gray-400 hover:text-red-500 text-xs"
          >
            ✕ Remove
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 pb-3 pt-2 bg-white border-t border-gray-100 shrink-0">
        <div className="flex items-end gap-2 bg-gray-100 rounded-2xl px-3 py-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-gray-400 hover:text-blue-600 transition-colors shrink-0 pb-0.5"
            title="Attach image"
          >
            📎
          </button>
          <input type="file" ref={fileRef} className="hidden" accept="image/*" onChange={handleFileChange} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything — query leads, check status, trigger scans..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-gray-800 placeholder-gray-400 max-h-28 disabled:opacity-60"
            style={{ overflowY: input.split('\n').length > 3 ? 'auto' : 'hidden' }}
          />
          <button
            type="submit"
            disabled={isStreaming || (!input.trim() && !imageFile)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-full w-8 h-8 flex items-center justify-center shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isStreaming ? (
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-sm">↑</span>
            )}
          </button>
        </div>
        <p className="text-center text-gray-400 text-xs mt-1.5">
          Full access: leads database · bot control · email · county scans
        </p>
      </form>
    </div>
  );
}
