import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// PROVIDER REGISTRY
const PROVIDERS = {
  ollama: {
    name: "Ollama (Offline)",
    tag: "OLLAMA",
    accent: "#10b981", // Green
    models: [], // populated at runtime from installed models
    free: "100% FREE — runs fully offline, no internet needed",
    setup: "ollama.com/download  then:  ollama pull llama3.2",
    noKey: true,
    local: true,
  },
};

// DEFAULT MODELS
const DEFAULT_MODELS_MAP = {
  gemini: [
    { id: "gemini-2.5-flash",  name: "Gemini 2.5 Flash", ctx: "1M",  isFree: true },
    { id: "gemini-2.5-pro",    name: "Gemini 2.5 Pro",   ctx: "2M",  isFree: false },
    { id: "gemini-2.0-flash",  name: "Gemini 2.0 Flash", ctx: "1M",  isFree: true },
    { id: "gemini-1.5-pro",    name: "Gemini 1.5 Pro",   ctx: "2M",  isFree: false },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile",                       name: "Llama 3.3 70B",          ctx: "131K", isFree: true },
    { id: "llama-3.1-8b-instant",                          name: "Llama 3.1 8B (Fast)",    ctx: "131K", isFree: true },
    { id: "openai/gpt-oss-120b",                           name: "GPT OSS 120B",            ctx: "131K", isFree: true },
    { id: "openai/gpt-oss-20b",                            name: "GPT OSS 20B (Fast)",      ctx: "131K", isFree: true },
    { id: "groq/compound",                                 name: "Groq Compound (Agentic)", ctx: "131K", isFree: true },
    { id: "groq/compound-mini",                            name: "Groq Compound Mini",      ctx: "131K", isFree: true },
    { id: "qwen/qwen3-32b",                                name: "Qwen3 32B (Preview)",     ctx: "131K", isFree: true },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct",     name: "Llama 4 Scout 17B",       ctx: "131K", isFree: true },
  ],
  openrouter: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)",        ctx: "131K", isFree: true },
    { id: "deepseek/deepseek-v4-flash:free",         name: "DeepSeek V4 Flash (Free)",    ctx: "1M",   isFree: true },
    { id: "google/gemma-3-27b-it:free",              name: "Gemma 3 27B (Free)",          ctx: "96K",  isFree: true },
    { id: "mistralai/mistral-7b-instruct:free",      name: "Mistral 7B (Free)",           ctx: "32K",  isFree: true },
    { id: "qwen/qwen3-235b-a22b:free",               name: "Qwen3 235B (Free)",           ctx: "40K",  isFree: true },
  ],
};

function getDefaultModelsForProvider(provId, provData) {
  // Direct match by id
  if (DEFAULT_MODELS_MAP[provId]) return DEFAULT_MODELS_MAP[provId];
  // Match by URL
  const url = provData?.customUrl || provData?.url || '';
  if (url.includes('generativelanguage.googleapis.com')) return DEFAULT_MODELS_MAP.gemini;
  if (url.includes('api.groq.com'))                      return DEFAULT_MODELS_MAP.groq;
  if (url.includes('openrouter.ai'))                     return DEFAULT_MODELS_MAP.openrouter;
  // Match by name
  const name = (provData?.name || '').toLowerCase();
  if (name.includes('gemini'))     return DEFAULT_MODELS_MAP.gemini;
  if (name.includes('groq'))       return DEFAULT_MODELS_MAP.groq;
  if (name.includes('openrouter')) return DEFAULT_MODELS_MAP.openrouter;
  return [];
}

// Returns true only if the key looks like a real, complete API key
function isKeyValid(key) {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (trimmed.length < 20) return false;
  if (trimmed === 'YOUR_API_KEY_HERE') return false;
  if (/^x+$/i.test(trimmed)) return false; // masked display value
  return true;
}

// API CALLER
async function callProvider(pid, modelId, messages, apiKey, sysPrompt, customUrl, signal) {
  const defaultSys = "You are a helpful AI assistant. Be concise.";
  const sys = sysPrompt && sysPrompt.trim()
    ? sysPrompt.trim()
    : defaultSys;

  // Keep only the last 20 messages for cloud providers to limit token usage
  // Ollama runs locally so it gets the full history
  const MAX_HISTORY = 20;
  const isLocal = pid === "ollama";
  const trimmedMessages = (!isLocal && messages.length > MAX_HISTORY)
    ? [...messages.slice(0, 1), ...messages.slice(-MAX_HISTORY + 1)]
    : messages;

  // Trim whitespace from message content to reduce tokens
  const cleanMessages = trimmedMessages.map(m => ({
    ...m,
    content: m.content.trim().replace(/\n{3,}/g, '\n\n'),
  }));

  // Helper: wraps any promise in a race against the abort signal
  // so IPC calls (which don't natively support abort) are also cancellable
  function abortable(promise) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        v => { signal.removeEventListener('abort', onAbort); resolve(v); },
        e => { signal.removeEventListener('abort', onAbort); reject(e); }
      );
    });
  }

  // Treat as Gemini if pid is "gemini" OR custom provider pointing to Gemini API
  const isGeminiProvider = pid === "gemini" || (customUrl && customUrl.includes("generativelanguage.googleapis.com"));

  if (isGeminiProvider) {
    const contents = cleanMessages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const baseUrl = customUrl || "https://generativelanguage.googleapis.com";
    let resOk, resStatus, errTxt, d;
    const bodyObj = {
      systemInstruction: { parts: [{ text: sys }] },
      contents,
      generationConfig: { maxOutputTokens: 2048 },
    };
    const finalUrl = `${baseUrl}/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    if (window.electronAPI && window.electronAPI.chatCompletion) {
      const resp = await abortable(window.electronAPI.chatCompletion(pid, finalUrl, { "Content-Type": "application/json" }, bodyObj));
      resOk = resp.ok; resStatus = resp.status; errTxt = resp.body;
      if (resOk) { try { d = JSON.parse(resp.body); } catch (e) { resOk = false; } }
    } else {
      const resp = await fetch(finalUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj), signal });
      resOk = resp.ok; resStatus = resp.status;
      if (!resOk) errTxt = await resp.text(); else d = await resp.json();
    }

    if (!resOk) {
      if (resStatus === 401 || resStatus === 403 || errTxt.includes("API_KEY_INVALID") || errTxt.toLowerCase().includes("api key")) {
        throw new Error("Please put a valid API Key in Providers in settings.");
      }
      throw new Error(`Gemini ${resStatus}: ${errTxt}`);
    }
    if (d && d.error) throw new Error(d.error.message);
    return d?.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini.";
  }

  if (pid === "groq" || pid === "openrouter" || (pid.startsWith("custom_") && !isGeminiProvider)) {
    let url = customUrl;
    if (!url) {
      if (pid === "groq") url = "https://api.groq.com/openai/v1/chat/completions";
      else url = "https://openrouter.ai/api/v1/chat/completions";
    }

    const hdrs = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    if (pid === "openrouter") {
      hdrs["HTTP-Referer"] = "https://claude.ai";
      hdrs["X-Title"] = "AI Personal Tool";
    }
    let resOk, resStatus, errTxt, d;
    const bodyObj = {
      model: modelId,
      messages: [{ role: "system", content: sys }, ...cleanMessages.map(m => ({ role: m.role, content: m.content }))],
      max_tokens: 2048,
    };

    if (window.electronAPI && window.electronAPI.chatCompletion) {
      const resp = await abortable(window.electronAPI.chatCompletion(pid, url, hdrs, bodyObj));
      resOk = resp.ok; resStatus = resp.status; errTxt = resp.body;
      if (resOk) { try { d = JSON.parse(resp.body); } catch (e) { resOk = false; } }
    } else {
      const resp = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(bodyObj), signal });
      resOk = resp.ok; resStatus = resp.status;
      if (!resOk) errTxt = await resp.text(); else d = await resp.json();
    }

    if (!resOk) {
      if (resStatus === 401 || resStatus === 403 || errTxt.toLowerCase().includes("invalid_api_key")) {
        throw new Error("Please put a valid API Key in Providers in settings.");
      }
      try {
        const j = JSON.parse(errTxt);
        if (j.error?.metadata?.raw) errTxt = j.error.metadata.raw;
        else if (j.error?.message) errTxt = j.error.message;
      } catch { }
      if (resStatus === 429) throw new Error(`${pid} Rate Limit (429): ${errTxt}\nTry a different model or wait a minute.`);
      throw new Error(`${pid} ${resStatus}: ${errTxt}`);
    }
    if (resOk && (!d || !d.choices)) d = { choices: [{ message: { content: "No valid response." } }] };
    return d.choices[0].message.content;
  }

  if (pid === "ollama") {
    if (!window.electronAPI?.ollamaApi) throw new Error("Ollama IPC not available.");

    // modelId format: "direct:<model>" | "codex:<model>" | "claude:<model>"
    const sep = modelId.indexOf(':');
    const launcher = sep !== -1 ? modelId.substring(0, sep) : 'direct';
    const actualModel = sep !== -1 ? modelId.substring(sep + 1) : modelId;

    try {
      if (launcher === 'claude') {
        await window.electronAPI.launchClaudeTerminal({ model: actualModel });
        return `Claude Code launched in a terminal window with model: **${actualModel}**\n\nUse the terminal to chat. This app cannot capture Claude Code's interactive output.`;
      }
      if (launcher === 'codex') {
        return await abortable(window.electronAPI.launcherApi({ launcher: 'codex', model: actualModel, messages: cleanMessages, systemPrompt: sys }));
      }
      return await abortable(window.electronAPI.ollamaApi({ model: actualModel, messages: cleanMessages, systemPrompt: sys }));
    } catch (e) {
      // Re-throw AbortError as-is so handleStop can detect it
      if (e.name === 'AbortError') throw e;
      throw new Error(`Ollama Error: ${e.message}`);
    }
  }

  throw new Error("Unknown provider: " + pid);
}

// UTILITIES
function langToExt(lang) {
  const MAP = {
    javascript: "js", typescript: "ts", python: "py", bash: "sh", shell: "sh",
    html: "html", css: "css", json: "json", yaml: "yml", markdown: "md", rust: "rs",
    go: "go", java: "java", cpp: "cpp", c: "c", php: "php", ruby: "rb", swift: "swift"
  };
  return MAP[lang.toLowerCase()] || lang;
}

function download(content, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  a.download = filename;
  a.click();
}

async function buildTree(handle, depth = 0) {
  if (depth > 4) return [];
  const items = [];
  for await (const [name, h] of handle.entries()) {
    if (name.startsWith(".") || name === "node_modules" || name === "__pycache__" || name === "dist") continue;
    if (h.kind === "directory") {
      const children = await buildTree(h, depth + 1);
      items.push({ name, kind: "dir", handle: h, children });
    } else {
      items.push({ name, kind: "file", handle: h });
    }
  }
  return items.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// STORAGE HELPERS
async function storageGet(key) {
  try {
    if (window.electronAPI?.storageGet) {
      // Value is already parsed JSON (main process stores raw JSON strings)
      const raw = await window.electronAPI.storageGet(key);
      if (raw === null || raw === undefined) return null;
      // Main stores values as JSON strings; parse if string, return directly otherwise
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return raw; }
      }
      return raw;
    }
    const r = localStorage.getItem(key);
    return r ? JSON.parse(r) : null;
  } catch { return null; }
}

async function storageSet(key, val) {
  try {
    if (window.electronAPI?.storageSet) {
      // Store as JSON string so main process can handle any type
      await window.electronAPI.storageSet(key, val === null || val === undefined ? null : JSON.stringify(val));
      return;
    }
    if (val === null || val === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(val));
    }
  } catch { }
}

// COMPONENTS
function FileNode({ item, depth, attached, expanded, onToggle, onSelect }) {
  const pad = depth * 16 + 8;
  if (item.kind === "dir") {
    const open = expanded[item.name + depth];
    return (
      <div>
        <div onClick={() => onToggle(item.name + depth)}
          className="file-node" style={{ paddingLeft: pad }}>
          <span className="dir-icon">📁</span>
          <span style={{ fontWeight: 500 }}>{item.name}</span>
        </div>
        {open && item.children.map((c, i) => (
          <FileNode key={i} item={c} depth={depth + 1} attached={attached} expanded={expanded}
            onToggle={onToggle} onSelect={onSelect} />
        ))}
      </div>
    );
  }
  const isOn = attached.some(f => f.name === item.name);
  return (
    <div onClick={() => onSelect(item.handle, item.name)}
      className={`file-node ${isOn ? 'attached' : ''}`} style={{ paddingLeft: pad }}>
      <span>{isOn ? "●" : "○"}</span>
      <span>{item.name}</span>
    </div>
  );
}

// Custom renderers for ReactMarkdown code blocks
function MarkdownCodeBlock({ children, className }) {
  const lang = className?.replace("language-", "") || "txt";
  const code = String(children).replace(/\n$/, "");
  const ext = langToExt(lang);
  const fname = `code.${ext}`;
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang}</span>
        <div className="code-actions">
          <button onClick={copy} className={`code-btn ${copied ? 'success' : ''}`}>{copied ? "✓ COPIED" : "COPY"}</button>
          <button onClick={() => download(code, fname)} className="code-btn">↓ SAVE {fname.toUpperCase()}</button>
        </div>
      </div>
      <pre className="code-pre"><code>{code}</code></pre>
    </div>
  );
}

const mdComponents = {
  code({ node, inline, className, children, ...props }) {
    if (inline) return <code style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, padding: "2px 6px", fontSize: "0.9em", fontFamily: "var(--font-mono)" }}>{children}</code>;
    return <MarkdownCodeBlock className={className}>{children}</MarkdownCodeBlock>;
  },
  p({ children }) { return <p style={{ margin: "0 0 10px", lineHeight: 1.7 }}>{children}</p>; },
  ul({ children }) { return <ul style={{ margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.8 }}>{children}</ul>; },
  ol({ children }) { return <ol style={{ margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.8 }}>{children}</ol>; },
  li({ children }) { return <li style={{ marginBottom: 4 }}>{children}</li>; },
  h1({ children }) { return <h1 style={{ fontSize: 20, fontWeight: 700, margin: "12px 0 8px", color: "var(--text-primary)" }}>{children}</h1>; },
  h2({ children }) { return <h2 style={{ fontSize: 17, fontWeight: 600, margin: "12px 0 6px", color: "var(--text-primary)" }}>{children}</h2>; },
  h3({ children }) { return <h3 style={{ fontSize: 15, fontWeight: 600, margin: "10px 0 4px", color: "var(--text-primary)" }}>{children}</h3>; },
  strong({ children }) { return <strong style={{ fontWeight: 600, color: "var(--text-primary)" }}>{children}</strong>; },
  blockquote({ children }) { return <blockquote style={{ borderLeft: "3px solid var(--accent)", margin: "8px 0", padding: "4px 12px", color: "var(--text-secondary)", fontStyle: "italic" }}>{children}</blockquote>; },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>{children}</a>; },
  hr() { return <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "12px 0" }} />; },
};

function CodeBlock({ lang, code, idx }) {
  const [copied, setCopied] = useState(false);
  const ext = langToExt(lang);
  const fname = `code_${idx + 1}.${ext}`;
  function copy() {
    navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{lang || 'text'}</span>
        <div className="code-actions">
          <button onClick={copy} className={`code-btn ${copied ? 'success' : ''}`}>
            {copied ? "✓ COPIED" : "COPY"}
          </button>
          <button onClick={() => download(code, fname)} className="code-btn">
            ↓ SAVE {fname.toUpperCase()}
          </button>
        </div>
      </div>
      <pre className="code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const AIJI_STOP_QUIPS = [
  "Why did you interrupt them bro? 💀",
  "You excited or something? Let 'em finish talking dude",
  "Bro really said 'nah I'm good' mid-sentence 😭",
  "The AI was literally about to say something fire...",
  "You cut them off like that? Cold.",
  "Okay rude. They were still thinking.",
  "That was their moment and you took it.",
  "Imagine being stopped mid-thought. That's them right now.",
  "You really said stop to the AI? Brave.",
  "They had more to say, just so you know.",
  "Cancelled. Just like that. No mercy.",
  "The AI felt that. Probably.",
  "Bro hit the eject button 💺",
  "You really couldn't wait 2 more seconds huh",
  "Okay speed runner, chill out.",
];

function MsgBubble({ msg, provId, modelId, provOverride }) {
  // Use stored provider info from message if available, otherwise fall back to current provider
  const prov = msg.providerId 
    ? { 
        name: msg.providerName || "Unknown", 
        tag: msg.providerTag || "AI", 
        accent: msg.providerAccent || "#3b82f6" 
      }
    : (provOverride || PROVIDERS[provId] || { name: "Custom Provider", tag: "CUST", accent: "#3b82f6" });
  
  const displayModelId = msg.modelId || modelId;
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="msg-wrapper user">
        <div className="msg-inner" style={{
          background: 'rgba(59, 130, 246, 0.12)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '16px',
          borderBottomRightRadius: '4px',
          padding: '10px 16px',
          width: 'fit-content',
          maxWidth: '80%',
          alignSelf: 'flex-end',
        }}>
          <div className="msg-header" style={{ color: '#60a5fa', alignSelf: 'flex-end' }}>YOU</div>
          <div className="msg-content" style={{ whiteSpace: "pre-wrap", textAlign: 'left', color: '#e5e7eb' }}>{msg.display || msg.content}</div>
        </div>
      </div>
    );
  }

  // Stopped indicator
  if (msg.stopped) {
    const quip = msg.stopQuip || AIJI_STOP_QUIPS[0];
    return (
      <div className="msg-wrapper assistant">
        <div className="msg-inner" style={{
          background: 'transparent',
          border: 'none',
        }}>
          <div className="msg-header">
            <span style={{ color: '#ef4444' }}>AIJI</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>·</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>response stopped</span>
          </div>
          <div className="msg-content" style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {quip}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-wrapper assistant">
      <div className="msg-inner">
        <div className="msg-header">
          <span style={{ color: prov.accent, whiteSpace: 'nowrap', minWidth: 'fit-content' }}>{prov.tag}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>·</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{
            displayModelId.startsWith('direct:') ? displayModelId.replace('direct:', '') :
            displayModelId.startsWith('codex:')  ? `Codex → ${displayModelId.replace('codex:', '')}` :
            displayModelId.startsWith('claude:') ? `Claude Code → ${displayModelId.replace('claude:', '')}` :
            displayModelId.split("/").pop().split(":")[0]
          }</span>
        </div>
        <div className="msg-content markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {msg.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── Ollama Terminal component ─────────────────────────────────
function OllamaTerminal({ lines }) {
  const containerRef = useRef(null);

  // Auto-scroll to bottom whenever lines change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  // Join all raw chunks, split on \n, handle \r within each segment
  const raw = lines.join('');
  const displayLines = [];
  for (const segment of raw.split('\n')) {
    const crParts = segment.split('\r');
    displayLines.push(crParts[crParts.length - 1]);
  }
  // Drop trailing blank
  if (displayLines.length && displayLines[displayLines.length - 1] === '') displayLines.pop();

  // Line height is 1.6em at 12px = ~19.2px. 4 lines = ~77px + padding
  const LINE_H = 19.2;
  const LINES_VISIBLE = 4;
  const termHeight = LINE_H * LINES_VISIBLE + 20; // +20 for padding

  return (
    <div
      ref={containerRef}
      style={{
        backgroundColor: '#0c0c0c',
        border: '1px solid #2a2a2a',
        borderRadius: 6,
        padding: '6px 12px',
        fontFamily: '"Cascadia Code", "Consolas", "Courier New", monospace',
        fontSize: 12,
        color: '#cccccc',
        height: termHeight,
        overflowY: 'auto',
        lineHeight: '1.6em',
        userSelect: 'text',
      }}
    >
      {displayLines.length === 0 ? (
        <span style={{ color: '#444' }}>Waiting for output...</span>
      ) : (
        displayLines.map((line, i) => {
          let color = '#cccccc';
          if (line.startsWith('>') || line.startsWith('[path]') || line.startsWith('[kill]')) color = '#569cd6';
          else if (/error|failed|✗|not found/i.test(line)) color = '#f44747';
          else if (/✓|ready|success|running|pulled/i.test(line)) color = '#4ec9b0';
          else if (/warning|⚠|timed out/i.test(line)) color = '#ce9178';
          else if (/downloading|pulling|starting|waiting|stopping|killing/i.test(line)) color = '#dcdcaa';
          else if (/time=|level=|msg=/i.test(line)) color = '#9cdcfe';
          return (
            <div key={i} style={{ color, minHeight: '1.6em', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line || '\u00a0'}
            </div>
          );
        })
      )}
    </div>
  );
}



function TokenBars({ level, onChange }) {
  if (level === 0) {
    return (
      <div
        style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: 'var(--text-muted)', cursor: onChange ? 'pointer' : 'default', backgroundColor: 'var(--bg-active)', padding: '2px 6px', borderRadius: 4 }}
        onClick={(e) => { if (onChange) { e.stopPropagation(); onChange(4); } }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        Quota resets in 23:59:59
      </div>
    );
  }

  const getColor = (i, lvl) => {
    if (i > lvl) return 'var(--bg-active)';
    if (lvl === 1) return '#ef4444';
    if (lvl === 2) return '#f59e0b';
    return '#10b981';
  };

  return (
    <div style={{ display: 'flex', gap: 2, cursor: onChange ? 'pointer' : 'default', alignItems: 'center' }}>
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          onClick={(e) => { if (onChange) { e.stopPropagation(); onChange(i === level ? 0 : i); } }}
          style={{
            width: 8, height: 12, borderRadius: 2,
            backgroundColor: getColor(i, level),
            border: '1px solid var(--border-color)',
            transition: 'all 0.2s'
          }}
        />
      ))}
    </div>
  );
}

// MAIN APP
export default function AITool() {
  const [pid, setPid] = useState("ollama");
  const [model, setModel] = useState("");
  const [apiKeys, setApiKeys] = useState({});
  const [customProviders, setCustomProviders] = useState([]);
  const [deletedProviders, setDeletedProviders] = useState([]);

  // Drag and Drop States
  const [providerOrder, setProviderOrder] = useState([]);
  const [draggedProvider, setDraggedProvider] = useState(null);
  const [dragOverProvider, setDragOverProvider] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);


  const mergedProviders = useMemo(() => {
    const enrichModels = (models, provId) => models.map(m => ({
      ...m,
      isFree: m.isFree !== undefined ? m.isFree : (provId === 'groq' || m.id.includes('free') || false),
      isActive: m.isActive !== undefined ? m.isActive : true,
      isAvailable: m.isAvailable !== undefined ? m.isAvailable : true,
      tokensRemainingLevel: m.tokensRemainingLevel !== undefined ? m.tokensRemainingLevel : 4
    }));

    const customObj = {};
    customProviders.forEach(p => {
      if (PROVIDERS[p.id]) {
        customObj[p.id] = {
          ...PROVIDERS[p.id],
          name: p.name || PROVIDERS[p.id].name,
          customUrl: p.customUrl || p.url,
          models: enrichModels(p.models && p.models.length > 0 ? p.models : PROVIDERS[p.id].models, p.id),
        };
      } else {
        customObj[p.id] = {
          name: p.name !== undefined ? p.name : "Unnamed Provider",
          tag: (p.name || "CUST").substring(0, 3).toUpperCase(),
          accent: "#3b82f6",
          models: enrichModels(p.models && p.models.length > 0 ? p.models : [], p.id),
          customUrl: p.customUrl !== undefined ? p.customUrl : (p.url !== undefined ? p.url : "https://api.openai.com/v1/chat/completions"),
          isCustom: true,
          noKey: false
        };
      }
    });

    const finalProv = { ...PROVIDERS, ...customObj };
    Object.keys(finalProv).forEach(k => {
      if (!customObj[k]) {
        finalProv[k] = { ...finalProv[k], models: enrichModels(finalProv[k].models, k) };
      }
    });
    deletedProviders.forEach(id => {
      delete finalProv[id];
    });
    return finalProv;
  }, [customProviders, deletedProviders]);

  const getOrderedProviders = useCallback(() => {
    const allKeys = Object.keys(mergedProviders);
    return allKeys.sort((a, b) => {
      // Ollama always goes last
      const aIsOllama = a === 'ollama' || mergedProviders[a]?.local;
      const bIsOllama = b === 'ollama' || mergedProviders[b]?.local;
      if (aIsOllama && !bIsOllama) return 1;
      if (!aIsOllama && bIsOllama) return -1;
      // Otherwise sort by saved order
      const idxA = providerOrder.indexOf(a);
      const idxB = providerOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }, [mergedProviders, providerOrder]);

  const handleDragStart = (e, prov) => {
    setDraggedProvider(prov);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', prov);
  };

  const handleDragOver = (e, prov) => {
    e.preventDefault();
    if (prov !== dragOverProvider) {
      setDragOverProvider(prov);
    }
  };

  const handleDragLeave = () => {
    setDragOverProvider(null);
  };

  const handleDrop = (e, targetProv) => {
    e.preventDefault();
    setDragOverProvider(null);
    if (!draggedProvider || draggedProvider === targetProv) return;

    const currentOrder = getOrderedProviders();
    const draggedIdx = currentOrder.indexOf(draggedProvider);
    const targetIdx = currentOrder.indexOf(targetProv);

    const newOrder = [...currentOrder];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedProvider);

    setProviderOrder(newOrder);
    storageSet("ait-v2-provider-order", newOrder);
    setDraggedProvider(null);
  };

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [expandedModelsProv, setExpandedModelsProv] = useState(null);
  const [editingModelId, setEditingModelId] = useState(null);
  const [availableSearch, setAvailableSearch] = useState({});
  const [availableSort, setAvailableSort] = useState({});
  const [sectionOpen, setSectionOpen] = useState({});
  // keyStatus: { [provId]: 'synced' | 'invalid' | 'active' | 'inactive' | 'fetching' }
  const [keyStatus, setKeyStatus] = useState({});

  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsClosing, setSettingsClosing] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingChatId, setLoadingChatId] = useState(null);
  const [loadingText, setLoadingText] = useState("");
  const [sysPrompt, setSysPrompt] = useState(
    "You are a powerful AI coding assistant. When creating files, always wrap code in ```ext\\ncode``` blocks with the correct file extension. Be thorough, complete, and production-ready."
  );
  const [dirHandle, setDirHandle] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [attached, setAttached] = useState([]);   // { name, content }
  const [expanded, setExpanded] = useState({});
  const [panel, setPanel] = useState("chat");      // "chat" | "files" | "settings"
  const [err, setErr] = useState(null);
  const [ollamaOk, setOllamaOk] = useState(null); // null | true | false
  const [ollamaBlocked, setOllamaBlocked] = useState(true);
  const [ollamaStatus, setOllamaStatus] = useState("checking");
  const [ollamaNotFound, setOllamaNotFound] = useState(false); // true = binary not installed
  const [ollamaModels, setOllamaModels] = useState([]); // array of installed model names
  const [launchersAvailable, setLaunchersAvailable] = useState({ codex: false, claudeCode: false });
  const [tokenCount, setTokenCount] = useState(0);
  const [apiStatus, setApiStatus] = useState({ state: "idle", label: "" });
  const [darkMode, setDarkMode] = useState(true);
  const [visibleKeys, setVisibleKeys] = useState({});
  const [validatingProv, setValidatingProv] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [settingsSection, setSettingsSection] = useState(null); // null | 'system-prompt' | 'api-keys' | 'models'
  const [sectionClosing, setSectionClosing] = useState(false);
  const [inputHistory, setInputHistory] = useState([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [lastInputLength, setLastInputLength] = useState(0);
  const [isPasting, setIsPasting] = useState(false);
  const [undoBuffer, setUndoBuffer] = useState('');
  const [sidebarTab, setSidebarTab] = useState("chats"); // "chats" | "archive" | "trash"
  const [showAttachMenu, setShowAttachMenu] = useState(false); // Dropdown for attach button
  const [abortController, setAbortController] = useState(null);
  const [ollamaTerminalLog, setOllamaTerminalLog] = useState([]);
  const [ollamaTerminalOpen, setOllamaTerminalOpen] = useState(false);
  const [ollamaTerminalBusy, setOllamaTerminalBusy] = useState(false);
  const [ollamaPullModel, setOllamaPullModel] = useState("llama3.2");

  const closeSettings = () => {
    if (settingsClosing) return; // already closing, ignore
    if (settingsSection) {
      // Close both section and settings simultaneously for a unified sliding animation
      setSectionClosing(true);
      setSettingsClosing(true);
      setTimeout(() => {
        setShowSettings(false);
        setSettingsSection(null);
        setSectionClosing(false);
        setSettingsClosing(false);
      }, 300);
    } else {
      // No section open, just close settings
      setSettingsClosing(true);
      setTimeout(() => {
        setShowSettings(false);
        setSettingsClosing(false);
      }, 300);
    }
  };

  const closeSection = () => {
    setSectionClosing(true);
    setTimeout(() => {
      setSettingsSection(null);
      setSectionClosing(false);
    }, 300);
  };

  const handleSaveAndValidateKey = async (provId, keyValue) => {
    if (!keyValue) {
      setValidationErrors(prev => ({ ...prev, [provId]: "API Key cannot be empty" }));
      return;
    }

    setValidatingProv(provId);
    setValidationErrors(prev => ({ ...prev, [provId]: null }));

    const safeFetch = async (url, opts = {}) => {
      try {
        const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
        let body = "";
        try { body = await r.text(); } catch { /* ignore */ }
        return { ok: r.ok, status: r.status, body, blocked: false };
      } catch (e) {
        return { ok: false, status: 0, body: e.message || "", blocked: true };
      }
    };

    const interpret = ({ ok, status, body, blocked }) => {
      if (blocked) return { valid: null, msg: "no connection (Network Error)" };
      if (ok) return { valid: true, msg: null };
      const lower = body.toLowerCase();
      if (status === 401 || status === 403) {
        if (lower.includes("expired") || lower.includes("expir")) return { valid: false, msg: "no connection (Expired Key)" };
        return { valid: false, msg: "no connection (Invalid Key)" };
      }
      if (status === 429) return { valid: true, msg: null };
      if (status === 0) return { valid: null, msg: "no connection (Network Error)" };
      return { valid: null, msg: `no connection (Status ${status})` };
    };

    try {
      let result;

      if (window.electronAPI && window.electronAPI.validateKey) {
        let pUrl;
        if (provId !== "gemini" && provId !== "groq" && provId !== "openrouter") {
          pUrl = mergedProviders[provId]?.customUrl;
        }
        result = await window.electronAPI.validateKey(provId, keyValue, pUrl);
      } else {
        if (provId === "gemini") {
          result = interpret(await safeFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyValue}`));
        } else if (provId === "groq") {
          result = interpret(await safeFetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${keyValue}`, "Content-Type": "application/json" }
          }));
        } else if (provId === "openrouter") {
          result = interpret(await safeFetch("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${keyValue}`, "HTTP-Referer": window.location.origin, "X-Title": "AI Tool" }
          }));
          if (!result || result.valid === null) {
            result = interpret(await safeFetch("https://openrouter.ai/api/v1/models", {
              headers: { Authorization: `Bearer ${keyValue}`, "HTTP-Referer": window.location.origin, "X-Title": "AI Tool" }
            }));
          }
        } else {
          const p = mergedProviders[provId];
          const endpoint = (p.customUrl || "https://api.openai.com/v1/chat/completions").trim();
          const modelsUrl = endpoint.replace(/\/chat\/completions\/?$/, "/models");
          result = interpret(await safeFetch(modelsUrl, {
            headers: { Authorization: `Bearer ${keyValue}` }
          }));
        }
      }

      if (result && result.valid === true) {
        await saveKey(provId, keyValue);
        setValidationErrors(prev => ({ ...prev, [provId]: null }));
      } else if (result && result.valid === null) {
        await saveKey(provId, keyValue);
        setValidationErrors(prev => ({ ...prev, [provId]: "⚠ Saved (connection unverifiable)" }));
        setTimeout(() => setValidationErrors(prev => ({ ...prev, [provId]: null })), 4000);
      } else {
        setValidationErrors(prev => ({ ...prev, [provId]: result ? result.msg : "Invalid Key" }));
      }
    } catch (e) {
      setValidationErrors(prev => ({ ...prev, [provId]: "no connection (Network Error)" }));
    } finally {
      setValidatingProv(null);
    }
  };

  // Track input changes to detect paste vs typing
  useEffect(() => {
    const lengthDiff = Math.abs(input.length - lastInputLength);
    if (lengthDiff > 5) {
      setIsPasting(true);
      setTimeout(() => setIsPasting(false), 100);
    }
    setLastInputLength(input.length);
  }, [input, lastInputLength]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (document.activeElement === inputRef.current && input.length > 0) {
          e.preventDefault();

          if (isPasting || currentHistoryIndex === -1) {
            setUndoBuffer(input);
            setInputHistory(prev => [...prev, input]);
            setCurrentHistoryIndex(inputHistory.length);
            setInput('');
          } else {
            const words = input.trim().split(/\s+/);
            if (words.length > 1) {
              const lastWord = words[words.length - 1];
              const newInput = words.slice(0, -1).join(' ') + ' ';
              setUndoBuffer(lastWord);
              setInputHistory(prev => [...prev, input]);
              setCurrentHistoryIndex(inputHistory.length);
              setInput(newInput);
            } else {
              setUndoBuffer(input);
              setInputHistory(prev => [...prev, input]);
              setCurrentHistoryIndex(inputHistory.length);
              setInput('');
            }
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        if (document.activeElement === inputRef.current && currentHistoryIndex >= 0) {
          e.preventDefault();
          const restoredText = inputHistory[currentHistoryIndex];
          setInput(restoredText);
          setUndoBuffer('');
          setCurrentHistoryIndex(prev => prev - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [input, inputHistory, currentHistoryIndex, isPasting]);

  // Close chat context menu when clicking outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [menuOpenId]);

  // Close attach menu when clicking outside
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = () => setShowAttachMenu(false);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showAttachMenu]);

  const msgsRef = useRef(null);
  const inputRef = useRef(null);
  const chatEndRef = useRef(null); // For auto-scrolling to bottom
  const pendingChatRef = useRef(null); // { chatId, msgs } set during handleSend, used by handleStop
  const ollamaCardRef = useRef(null); // For scrolling to ollama card in providers panel

  // Show scroll-to-bottom button when user scrolls up far enough
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  useEffect(() => {
    const el = msgsRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  const prov = mergedProviders[pid] || mergedProviders["gemini"] || Object.values(mergedProviders)[0] || { name: "Unknown", tag: "UNK", accent: "#ccc" };

  // Load saved keys + settings + chats
  useEffect(() => {
    storageGet("ait-v2-keys").then(v => {
      if (v) {
        setApiKeys(v);
        const initialVis = {};
        Object.keys(v).forEach(k => {
          if (v[k]) initialVis[k] = false;
        });
        setVisibleKeys(initialVis);
      } else {
        setVisibleKeys({});
      }
    });
    storageGet("ait-v2-sys").then(v => v && setSysPrompt(v));
    storageGet("ait-v2-dark").then(v => { if (v !== null) setDarkMode(v); });
    storageGet("ait-v2-custom-providers").then(v => { if (v) setCustomProviders(v); });
    storageGet("ait-v2-deleted-providers").then(v => { if (v) setDeletedProviders(v); });
    storageGet("ait-v2-provider-order").then(v => { if (v) setProviderOrder(v); });

    Promise.all([
      storageGet("ait-v2-chats"),
      storageGet("ait-v2-active-chat"),
      storageGet("ait-v2-msgs")
    ]).then(([loadedChats, activeId, legacyMsgs]) => {
      let currentChats = loadedChats || [];
      // Migration from legacy single-chat
      if (legacyMsgs && legacyMsgs.length > 0) {
        const legacyChat = {
          id: "chat_" + Date.now(),
          title: legacyMsgs[0].display || legacyMsgs[0].content.substring(0, 30) + "...",
          messages: legacyMsgs,
          updatedAt: Date.now(),
          isArchived: false
        };
        currentChats = [legacyChat, ...currentChats];
        storageSet("ait-v2-msgs", null); // Clear legacy
      }
      setChats(currentChats);
      // Always start with a fresh new chat on app open — no active chat selected
      setActiveChatId(null);
    });
  }, []);

  const activeChat = chats.find(c => c.id === activeChatId) || null;

  // Only show messages if the active chat belongs to the current tab
  const chatBelongsToTab = activeChat && (
    (sidebarTab === 'chats'   && !activeChat.isArchived && !activeChat.isTrashed) ||
    (sidebarTab === 'archive' &&  activeChat.isArchived && !activeChat.isTrashed) ||
    (sidebarTab === 'trash'   &&  activeChat.isTrashed)
  );
  const messages = chatBelongsToTab ? (activeChat?.messages || []) : [];

  // Scroll to bottom on new messages
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [messages, loading]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // On app load: fetch installed Ollama models and check available launchers
  useEffect(() => {
    if (!window.electronAPI) return;
    (async () => {
      try {
        // Check launchers and models in parallel
        const [models, launchers] = await Promise.all([
          window.electronAPI.getOllamaModels(),
          window.electronAPI.checkLaunchers(),
        ]);

        if (launchers) setLaunchersAvailable(launchers);

        if (models && models.length > 0) {
          setOllamaModels(models);
          storageSet("ait-ollama-installed", models);
        }
      } catch (e) {
        console.warn('[Ollama] Could not fetch installed models:', e.message);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check Ollama running status whenever user switches to Ollama provider
  useEffect(() => {
    if (pid !== "ollama") return;
    setOllamaOk(null);
    setOllamaStatus('checking');

    (async () => {
      try {
        const result = await window.electronAPI.checkOllama();
        setOllamaOk(result.running);
        setOllamaNotFound(false); // if checkOllama succeeded, binary exists or HTTP responded

        if (result.running && !ollamaBlocked) {
          setOllamaStatus('running');
        } else {
          setOllamaStatus('stopped');
        }

        if (result.models && result.models.length > 0) {
          setOllamaModels(result.models);
          storageSet("ait-ollama-installed", result.models);
        }
      } catch (error) {
        console.error('Error checking Ollama:', error);
        setOllamaOk(false);
        setOllamaStatus('stopped');
      }
    })();
  }, [pid]);

  // Subscribe to ollama log stream from main process
  useEffect(() => {
    if (!window.electronAPI?.onOllamaLog) return;
    // Register a persistent background listener that appends to log state
    const unsub = window.electronAPI.onOllamaLog(msg => {
      setOllamaTerminalLog(prev => [...prev, msg]);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Live API status check
  useEffect(() => {
    const key = apiKeys[pid] || "";

    if (pid === "ollama") {
      if (ollamaStatus === 'checking' || ollamaStatus === 'starting') {
        setApiStatus({ state: "checking", label: "Checking Ollama..." });
        return;
      }
      if (ollamaStatus === 'running') {
        setApiStatus({ state: "ok", label: "Ollama Connected" });
        return;
      }
      setApiStatus({ state: "error", label: ollamaNotFound ? "Ollama Not Found · Install" : "Ollama stopped · click Start" });
      return;
    }
    if (!key) {
      setApiStatus({ state: "error", label: "API Key Error" });
      return;
    }
    setApiStatus({ state: "checking", label: "Connecting..." });
    const check = async () => {
      try {
        let result;
        if (window.electronAPI && window.electronAPI.validateKey) {
          const effectivePid = (pid.startsWith('custom_') && prov?.customUrl?.includes('generativelanguage.googleapis.com'))
            ? 'gemini'
            : pid;
          result = await window.electronAPI.validateKey(effectivePid, key, prov?.customUrl);
        } else {
          let ok = false;
          if (pid === "gemini") {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            ok = r.ok;
          } else if (pid === "groq") {
            const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
            ok = r.ok;
          } else if (pid === "openrouter") {
            const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${key}` } });
            ok = r.ok;
          } else {
            const customUrl = prov?.customUrl || '';
            if (customUrl) {
              const modelsUrl = customUrl.replace(/\/chat\/completions\/?$/, '/models');
              try {
                const r = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${key}` } });
                ok = r.ok || r.status === 429;
              } catch { ok = false; }
            } else {
              ok = false;
            }
          }
          result = { valid: ok ? true : false, msg: ok ? null : "API Error" };
        }

        // valid === true  → connected
        // valid === false → confirmed bad key
        // valid === null  → could not verify (network/timeout) — treat as error so user knows to check
        if (result.valid === true) {
          setApiStatus({ state: "ok", label: "API Connected" });
        } else {
          setApiStatus({ state: "error", label: "API Key Error" });
        }
      } catch (e) {
        setApiStatus({ state: "error", label: "API Key Error" });
      }
    };
    check();
  }, [pid, apiKeys, ollamaStatus, ollamaNotFound]);

  // Sync textarea height whenever input changes (handles Ctrl+Z shrink)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    const maxLines = 6;
    const maxHeight = lineHeight * maxLines;
    if (el.scrollHeight <= maxHeight) {
      el.style.height = el.scrollHeight + 'px';
      el.style.overflowY = 'hidden';
    } else {
      el.style.height = maxHeight + 'px';
      el.style.overflowY = 'auto';
    }
  }, [input]);

  // Validate all saved keys once on startup (runs when apiKeys + mergedProviders are both ready)
  const startupValidatedRef = React.useRef(false);
  useEffect(() => {
    if (startupValidatedRef.current) return;
    if (!window.electronAPI?.validateKey) return;
    const keys = Object.keys(apiKeys);
    if (keys.length === 0) return;
    startupValidatedRef.current = true;
    keys.forEach(k => {
      const keyVal = apiKeys[k];
      if (!isKeyValid(keyVal)) return;
      const p = mergedProviders[k];
      const effectivePid = (k.startsWith('custom_') && p?.customUrl?.includes('generativelanguage.googleapis.com'))
        ? 'gemini' : k;
      setKeyStatus(prev => ({ ...prev, [k]: 'fetching' }));
      window.electronAPI.validateKey(effectivePid, keyVal, p?.customUrl).then(result => {
        setKeyStatus(prev => ({ ...prev, [k]: result.valid === true ? 'synced' : 'invalid' }));
      }).catch(() => {
        setKeyStatus(prev => ({ ...prev, [k]: 'invalid' }));
      });
    });
  }, [apiKeys, mergedProviders]);

  // Token estimate
  useEffect(() => {
    const text = messages.map(m => m.content).join(" ") + " " + input;
    setTokenCount(Math.round(text.length / 4));
  }, [messages, input]);

  // Auto-scroll to bottom when error appears
  useEffect(() => {
    if (err && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [err]);

  async function saveKey(k, v) {
    const next = { ...apiKeys, [k]: v };
    setApiKeys(next);
    await storageSet("ait-v2-keys", next);

    // Immediately validate the key and update keyStatus for this provider
    if (isKeyValid(v) && window.electronAPI?.validateKey) {
      const p = mergedProviders[k];
      const effectivePid = (k.startsWith('custom_') && p?.customUrl?.includes('generativelanguage.googleapis.com'))
        ? 'gemini' : k;
      setKeyStatus(prev => ({ ...prev, [k]: 'fetching' }));
      window.electronAPI.validateKey(effectivePid, v, p?.customUrl).then(result => {
        if (result.valid === true) {
          setKeyStatus(prev => ({ ...prev, [k]: 'synced' }));
        } else {
          setKeyStatus(prev => ({ ...prev, [k]: 'invalid' }));
        }
      }).catch(() => {
        setKeyStatus(prev => ({ ...prev, [k]: 'invalid' }));
      });
    } else if (!isKeyValid(v)) {
      setKeyStatus(prev => ({ ...prev, [k]: 'inactive' }));
    }

    // Auto-fetch real model list from the provider API when a key is saved
    if (k === "groq" || k === "gemini" || k === "openrouter") {
      fetchProviderModels(k, v, mergedProviders[k]?.customUrl);
    }

    if (k.startsWith("custom_")) {
      const p = mergedProviders[k];
      if (p) {
        let inferredUrl = "";
        let inferredName = "";
        let inferredLogo = "";
        const val = v.trim();
        if (val.startsWith("sk-or-v1-")) { inferredUrl = "https://openrouter.ai/api/v1/chat/completions"; inferredName = "OpenRouter"; inferredLogo = "https://openrouter.ai/favicon.ico"; }
        else if (val.startsWith("gsk_")) { inferredUrl = "https://api.groq.com/openai/v1/chat/completions"; inferredName = "Groq"; inferredLogo = "https://groq.com/favicon.ico"; }
        else if (val.startsWith("sk-ant-")) { inferredName = "Anthropic (OpenAI proxy required)"; inferredLogo = "https://www.anthropic.com/favicon.ico"; }
        else if (val.startsWith("sk-proj-") || val.startsWith("sk-")) { inferredUrl = "https://api.openai.com/v1/chat/completions"; inferredName = "OpenAI"; inferredLogo = "https://openai.com/favicon.ico"; }
        else if (val.startsWith("xai-")) { inferredUrl = "https://api.x.ai/v1/chat/completions"; inferredName = "xAI"; inferredLogo = "https://x.ai/favicon.ico"; }
        else if (val.startsWith("AIza")) { inferredUrl = "https://generativelanguage.googleapis.com"; inferredName = "Gemini"; inferredLogo = "https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06.png"; }

        // If we have a URL but no specific logo, try to derive favicon from the domain
        const urlToUse = inferredUrl || p.customUrl;
        if (!inferredLogo && urlToUse) {
          try {
            const domain = new URL(urlToUse).origin;
            inferredLogo = `${domain}/favicon.ico`;
          } catch { /* ignore */ }
        }

        let updates = {};
        if (inferredUrl && !p.customUrl) updates.customUrl = inferredUrl;
        if (inferredName && (!p.name || p.name === "New Provider")) updates.name = inferredName;
        if (inferredLogo && !p.logo) updates.logo = inferredLogo;

        if (Object.keys(updates).length > 0) {
          updateCustomProvider(k, updates);
        }
      }
    }
  }

  function startNewChat() {
    const id = "chat_" + Date.now();
    const newChat = { id, title: "New Chat", messages: [], updatedAt: Date.now(), isArchived: false };
    const next = [newChat, ...chats];
    setChats(next);
    setActiveChatId(id);
    storageSet("ait-v2-chats", next);
    storageSet("ait-v2-active-chat", id);
    setPanel("chat");
  }

  function deleteChat(id) {
    const next = chats.map(c => c.id === id ? { ...c, isTrashed: true, isArchived: false } : c);
    setChats(next);
    storageSet("ait-v2-chats", next);
    if (activeChatId === id) {
      const nextActive = next.find(c => !c.isArchived && !c.isTrashed);
      setActiveChatId(nextActive ? nextActive.id : null);
      storageSet("ait-v2-active-chat", nextActive ? nextActive.id : null);
    }
    setMenuOpenId(null);
  }

  function permanentDeleteChat(id) {
    const next = chats.filter(c => c.id !== id);
    setChats(next);
    storageSet("ait-v2-chats", next);
    if (activeChatId === id) {
      const nextActive = next.find(c => !c.isArchived && !c.isTrashed);
      setActiveChatId(nextActive ? nextActive.id : null);
      storageSet("ait-v2-active-chat", nextActive ? nextActive.id : null);
    }
    setMenuOpenId(null);
  }

  function restoreChat(id) {
    const next = chats.map(c => c.id === id ? { ...c, isTrashed: false, isArchived: false } : c);
    setChats(next);
    storageSet("ait-v2-chats", next);
    setMenuOpenId(null);
  }

  function unarchiveChat(id) {
    const next = chats.map(c => c.id === id ? { ...c, isArchived: false } : c);
    setChats(next);
    storageSet("ait-v2-chats", next);
    setMenuOpenId(null);
  }

  function archiveChat(id) {
    const next = chats.map(c => c.id === id ? { ...c, isArchived: true, isTrashed: false } : c);
    setChats(next);
    storageSet("ait-v2-chats", next);
    if (activeChatId === id) {
      const nextActive = next.find(c => !c.isArchived && !c.isTrashed);
      setActiveChatId(nextActive ? nextActive.id : null);
      storageSet("ait-v2-active-chat", nextActive ? nextActive.id : null);
    }
    setMenuOpenId(null);
  }

  function shareChat(id) {
    const chat = chats.find(c => c.id === id);
    if (!chat) return;
    const text = chat.messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n---\n\n");
    navigator.clipboard?.writeText(text);
    setMenuOpenId(null);
  }

  function switchChat(id) {
    setActiveChatId(id);
    storageSet("ait-v2-active-chat", id);
    setPanel("chat");
  }

  async function openFolder() {
    if (!window.showDirectoryPicker) {
      setErr("File System Access API not supported — use Chrome or Edge browser.");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      setDirHandle(handle);
      setFileTree(await buildTree(handle));
      setPanel("files");
      setAttached([]);
    } catch (e) {
      if (e.name !== "AbortError") setErr("Folder error: " + e.message);
    }
  }

  async function toggleFile(fileHandle, name) {
    if (attached.some(f => f.name === name)) {
      setAttached(prev => prev.filter(f => f.name !== name));
      return;
    }
    try {
      const file = await fileHandle.getFile();
      const content = await file.text();
      setAttached(prev => [...prev, { name, content }]);
    } catch (e) { setErr("Cannot read file: " + e.message); }
  }

  function toggleDir(key) {
    setExpanded(p => ({ ...p, [key]: !p[key] }));
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && attached.length === 0) return;
    if (loading && loadingChatId === activeChatId) return;

    let apiKey = apiKeys[pid] || "";

    if (pid === "ollama" && (ollamaBlocked || ollamaStatus === 'stopped')) {
      setErr(`Ollama connection is stopped. Click Start in Providers to connect.`);
      return;
    }

    if (!prov.noKey && !apiKey) {
      setErr(`Enter your ${prov.name} API key in Providers in settings.`);
      return;
    }

    let content = text;
    let display = text;
    if (attached.length > 0) {
      const ctx = attached.map(f =>
        `### File: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``
      ).join("\n\n");
      content = `${ctx}\n\n${text || "Please analyze and help with these files."}`;
      display = text || `[Attached: ${attached.map(f => f.name).join(", ")}]`;
    }

    const userMsg = { role: "user", content, display };
    const newMsgs = [...messages, userMsg];

    let currentChatId = activeChatId;
    let isNewChat = false;
    if (!currentChatId) {
      currentChatId = "chat_" + Date.now();
      isNewChat = true;
      setActiveChatId(currentChatId);
      storageSet("ait-v2-active-chat", currentChatId);
    }

    const activeChatTitle = chats.find(c => c.id === currentChatId)?.title || "New Chat";

    const updateChats = (msgs, newTitle = null) => {
      const finalTitle = newTitle || activeChatTitle;
      setChats(prev => {
        let exists = false;
        let next = prev.map(c => {
          if (c.id === currentChatId) {
            exists = true;
            return { ...c, title: finalTitle, messages: msgs || c.messages, updatedAt: Date.now() };
          }
          return c;
        });
        if (!exists) {
          next = [{ id: currentChatId, title: finalTitle, messages: msgs || [], updatedAt: Date.now(), isArchived: false }, ...next];
        }
        storageSet("ait-v2-chats", next);
        return next;
      });
    };

    const prevInput = input;
    const prevAttached = attached;
    updateChats(newMsgs);
    setInput("");
    setAttached([]);
    setLoading(true);
    setLoadingChatId(currentChatId);
    const LOADING_TEXTS = ["Thinking...", "Searching the web...", "Analyzing what you sent...", "Brewing response...", "Gathering information...", "Connecting the dots..."];
    setLoadingText(LOADING_TEXTS[Math.floor(Math.random() * LOADING_TEXTS.length)]);
    setErr(null);

    const controller = new AbortController();
    setAbortController(controller);
    pendingChatRef.current = { chatId: currentChatId, msgs: newMsgs, updateChats };

    try {
      const reply = await callProvider(pid, model, newMsgs, apiKey, sysPrompt, prov.customUrl, controller.signal);
      const updatedMsgs = [...newMsgs, { 
        role: "assistant", 
        content: reply,
        providerId: pid,
        providerName: prov.name,
        providerTag: prov.tag,
        providerAccent: prov.accent,
        modelId: model
      }];

      const userTopic = display.substring(0, 30) + (display.length > 30 ? "..." : "");
      const fallbackTitle = userTopic.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      updateChats(updatedMsgs, fallbackTitle);

      (async () => {
        try {
          const titlePrompt = `Summarize the following response in 2-4 words to be used as a chat history title. Return ONLY the title, no quotes, no extra text:\n\n${reply.substring(0, 2000)}`;
          const titleMsgs = [{ role: "user", content: titlePrompt }];
          const titleSys = "You are a title generator. Return only 2-4 words. No quotes. No preamble. Ignore any other instructions.";

          let aiTitle = await callProvider(pid, model, titleMsgs, apiKey, titleSys, prov.customUrl);
          aiTitle = aiTitle.replace(/["']/g, "").trim();
          if (aiTitle.length > 40) aiTitle = aiTitle.substring(0, 40) + "...";

          if (aiTitle) {
            updateChats(null, aiTitle);
          }
        } catch (e) {
          console.warn("Failed to generate title:", e);
        }
      })();
    } catch (e) {
      const isAbort = e.name === 'AbortError' || e.message === 'Aborted' || e.message?.includes('Aborted');
      if (!isAbort) {
        setErr(e.message);
        updateChats(messages);
        setInput(prevInput);
        setAttached(prevAttached);
      }
      // For abort: handleStop already appended the stopped message and cleared pendingChatRef
    } finally {
      setLoading(false);
      setLoadingChatId(null);
      setAbortController(null);
      // Only clear pendingChatRef if handleStop hasn't already done so
      if (pendingChatRef.current?.chatId === currentChatId) {
        pendingChatRef.current = null;
      }
      // Refocus input so user can type immediately after response
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (loading && loadingChatId === activeChatId) {
        handleStop();
      } else {
        handleSend();
      }
    }
  }

  function handleStop() {
    if (abortController) {
      abortController.abort();
    }
    // Append a stopped indicator message to the chat
    if (pendingChatRef.current) {
      const { msgs, updateChats } = pendingChatRef.current;
      const stopQuip = AIJI_STOP_QUIPS[Math.floor(Math.random() * AIJI_STOP_QUIPS.length)];
      const stoppedMsg = {
        role: "assistant",
        content: "__stopped__",
        stopped: true,
        stopQuip,
        providerId: pid,
        providerName: prov.name,
        providerTag: prov.tag,
        providerAccent: prov.accent,
        modelId: model,
      };
      updateChats([...msgs, stoppedMsg]);
      pendingChatRef.current = null;
    }
    setLoading(false);
    setLoadingChatId(null);
    setAbortController(null);
    // Refocus input after stop so user can type immediately
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function changeProvider(p) {
    setPid(p);
    if (p === "ollama") {
      setModel(ollamaModels.length > 0 ? `direct:${ollamaModels[0]}` : "");
    } else {
      const activeModels = mergedProviders[p]?.models.filter(m => m.isActive) || [];
      setModel(activeModels.length > 0 ? activeModels[0].id : (mergedProviders[p]?.models[0]?.id || ""));
    }
    setErr(null);
  }

  // Auto-select first Ollama model when the list loads
  useEffect(() => {
    if (pid === "ollama" && ollamaModels.length > 0) {
      const currentIsValid = model && (
        model.startsWith('direct:') || model.startsWith('codex:')
      ) && ollamaModels.some(m => model.endsWith(m));
      if (!currentIsValid) {
        setModel(`direct:${ollamaModels[0]}`);
      }
    }
  }, [ollamaModels, pid]);

  useEffect(() => {
    const p = mergedProviders[pid];
    if (p && pid !== "ollama") {
      const activeModels = p.models.filter(m => m.isActive);
      if (activeModels.length > 0 && !activeModels.some(m => m.id === model)) {
        setModel(activeModels[0].id);
      }
    }
  }, [pid, mergedProviders, model]);

  const updateCustomProvider = (id, fieldOrUpdates, value) => {
    setCustomProviders(prev => {
      let exists = false;
      let next = prev.map(p => {
        if (p.id === id) {
          exists = true;
          if (typeof fieldOrUpdates === 'object') return { ...p, ...fieldOrUpdates };
          return { ...p, [fieldOrUpdates]: value };
        }
        return p;
      });
      if (!exists) {
        if (typeof fieldOrUpdates === 'object') next = [...next, { id, ...fieldOrUpdates }];
        else next = [...next, { id, [fieldOrUpdates]: value }];
      }
      storageSet("ait-v2-custom-providers", next);
      return next;
    });
  };

  const deleteCustomProvider = (id) => {
    if (PROVIDERS[id]) {
      const nextDeleted = [...deletedProviders, id];
      setDeletedProviders(nextDeleted);
      storageSet("ait-v2-deleted-providers", nextDeleted);
    }
    const next = customProviders.filter(p => p.id !== id);
    setCustomProviders(next);
    storageSet("ait-v2-custom-providers", next);

    // Also clear API key and visibleKeys
    const newKeys = { ...apiKeys };
    delete newKeys[id];
    setApiKeys(newKeys);
    storageSet("ait-v2-keys", newKeys);
    setVisibleKeys(prev => { const n = { ...prev }; delete n[id]; return n; });

    if (pid === id) {
      const remaining = Object.keys(mergedProviders).filter(k => k !== id);
      if (remaining.length > 0) {
        changeProvider(remaining[0]);
      } else {
        setPid("");
      }
    }
  };

  const handleUpdateModel = (provId, updatedModel) => {
    const existingProvider = customProviders.find(p => p.id === provId) || { id: provId, models: mergedProviders[provId].models };
    const newModels = (existingProvider.models || mergedProviders[provId].models).map(m => m.id === updatedModel.id ? updatedModel : m);
    updateCustomProvider(provId, 'models', newModels);
  };

  const handleDeleteModel = (provId, modelId) => {
    const existingProvider = customProviders.find(p => p.id === provId) || { id: provId, models: mergedProviders[provId].models };
    const newModels = (existingProvider.models || mergedProviders[provId].models).filter(m => m.id !== modelId);
    updateCustomProvider(provId, 'models', newModels);
  };

  const fetchProviderModels = async (providerId, apiKey, customUrl) => {
    if (!isKeyValid(apiKey)) return;
    setKeyStatus(prev => ({ ...prev, [providerId]: 'fetching' }));
    try {
      let models = [];
      const isGemini = providerId === "gemini" || (customUrl && customUrl.includes("generativelanguage.googleapis.com"));
      if (isGemini) {
        const geminiBase = customUrl || "https://generativelanguage.googleapis.com";
        const res = await fetch(`${geminiBase}/v1beta/models?key=${apiKey}`);
        if (!res.ok) throw new Error("Invalid API Key");
        const data = await res.json();
        models = data.models.filter(m => m.supportedGenerationMethods.includes("generateContent")).map(m => ({ id: m.name.replace("models/", ""), name: m.displayName || m.name }));
      } else {
        const baseUrl = customUrl ? customUrl.replace("/chat/completions", "/models") : (providerId === "groq" ? "https://api.groq.com/openai/v1/models" : (providerId === "openrouter" ? "https://openrouter.ai/api/v1/models" : null));
        if (!baseUrl) return;
        const hdrs = { "Authorization": `Bearer ${apiKey}` };
        const res = await fetch(baseUrl, { headers: hdrs });
        if (!res.ok) throw new Error("Failed to fetch models");
        const data = await res.json();
        models = (data.data || []).map(m => ({ id: m.id, name: m.name || m.id }));
      }

      if (models.length > 0) {
        const existingProvider = customProviders.find(p => p.id === providerId);
        const existingModels = existingProvider?.models || PROVIDERS[providerId]?.models || [];

        // Always include the built-in default models so they're never lost on sync
        const defaultModels = PROVIDERS[providerId]?.models || [];

        const merged = models.map(m => {
          const existing = existingModels.find(e => e.id === m.id);
          const lowerId = m.id.toLowerCase();
          const isChat = !lowerId.includes('whisper') && !lowerId.includes('dall-e') && !lowerId.includes('tts')
            && !lowerId.includes('embedding') && !lowerId.includes('text-moderation') && !lowerId.includes('audio')
            && !lowerId.includes('guard') && !lowerId.includes('safeguard') && !lowerId.includes('orpheus');

          let obj = existing
            ? { ...m, ...existing }
            : { ...m, isFree: m.id.includes('free') || providerId === 'groq', isActive: false, tokensRemainingLevel: 4 };
          obj.isAvailable = isChat;
          return obj;
        });

        // Preserve active models not returned by API + always keep defaults active
        const fetchedIds = new Set(merged.map(m => m.id));
        const activeMissing = existingModels.filter(m => m.isActive && !fetchedIds.has(m.id));
        const defaultsMissing = defaultModels
          .filter(m => !fetchedIds.has(m.id))
          .map(m => {
            const existing = existingModels.find(e => e.id === m.id);
            return existing
              ? { ...m, ...existing }
              : { ...m, isActive: false, isAvailable: true, tokensRemainingLevel: 4, isFree: m.id.includes('free') || providerId === 'groq' };
          });

        // Merge: API models first, then active missing, then defaults not already present
        const defaultMissingIds = new Set(defaultsMissing.map(m => m.id));
        const activeMissingFiltered = activeMissing.filter(m => !defaultMissingIds.has(m.id));
        updateCustomProvider(providerId, 'models', [...merged, ...activeMissingFiltered, ...defaultsMissing]);
        setKeyStatus(prev => ({ ...prev, [providerId]: 'synced' }));
      } else {
        setKeyStatus(prev => ({ ...prev, [providerId]: 'active' }));
      }
    } catch (e) {
      console.error(`Failed to fetch models for ${providerId}:`, e);
      setKeyStatus(prev => ({ ...prev, [providerId]: 'invalid' }));
    }
  };

  // ── RENDER ──────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* ── SIDEBAR ─────────────────────────────────────────── */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title" onClick={() => setSidebarTab('chats')} style={{ cursor: 'pointer' }}>
            <span style={{ color: "var(--accent)" }}>AI</span>JI
          </div>
          <div className="sidebar-subtitle">Multi-Model AI Client</div>
        </div>

        <div className="sidebar-body" style={{ padding: 0 }}>

          {/* ── CHAT PANEL ── */}
          {panel === "chat" && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {sidebarTab === "chats" && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="sidebar-model-display">
                      <div className="sidebar-model-icon">
                        {pid === "gemini" ? "✨" : pid === "groq" ? "⚡" : pid === "ollama" ? "🦙" : "🤖"}
                      </div>
                      <div className="sidebar-model-name">{prov.name}</div>
                      <div className="sidebar-model-label">Active AI</div>
                      <div className="status-indicator">
                        <div className={`status-dot ${apiStatus.state === "ok" ? "green" : apiStatus.state === "error" ? "red" : "yellow"}`} />
                        {pid === "ollama" && apiStatus.state === "error" ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>Ollama stopped ·</span>
                            <button
                              onClick={() => {
                                setShowSettings(true);
                                setSettingsSection('api-keys');
                                setShowProviderModal(true);
                                setTimeout(() => {
                                  ollamaCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }, 350);
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#ffffff', fontSize: 11, fontWeight: 600, textDecoration: 'underline' }}
                            >
                              Start Ollama
                            </button>
                          </span>
                        ) : (
                          <span style={{ color: apiStatus.state === "error" ? "#ef4444" : "inherit" }}>{apiStatus.label}</span>
                        )}
                      </div>
                    </div>

                    <button onClick={startNewChat} className="new-chat-btn">
                      <span>+</span> Start New Chat
                    </button>

                    <div className="chat-history-header" style={{ padding: '8px 16px' }}>Chat History</div>
                    <div className="chat-history-list" style={{ flex: 1, overflowY: 'auto' }}>
                      {chats.filter(c => !c.isArchived && !c.isTrashed).map(c => (
                        <div key={c.id} className={`chat-item ${activeChatId === c.id ? 'active' : ''}`} onClick={() => switchChat(c.id)}>
                          <div className="chat-item-title">{c.title || "New Chat"}</div>
                          {loading && loadingChatId === c.id ? (
                            <span style={{
                              position: 'absolute', top: '50%', right: 8,
                              transform: 'translateY(-50%)',
                              width: 28, height: 28,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                            }}>
                              {[0, 150, 300].map(delay => (
                                <span key={delay} style={{
                                  width: 4, height: 4, borderRadius: '50%',
                                  backgroundColor: 'var(--text-muted)',
                                  display: 'inline-block',
                                  animation: 'blink 1s infinite',
                                  animationDelay: `${delay}ms`,
                                }} />
                              ))}
                            </span>
                          ) : (
                            <button className={`chat-item-menu-btn ${menuOpenId === c.id ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
                              ⋮
                            </button>
                          )}
                          {menuOpenId === c.id && (
                            <div className="chat-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button className="chat-menu-item" onClick={() => shareChat(c.id)}>Share</button>
                              <button className="chat-menu-item" onClick={() => archiveChat(c.id)}>Archive</button>
                              <button className="chat-menu-item danger" onClick={() => deleteChat(c.id)}>Move to Trash</button>
                            </div>
                          )}
                        </div>
                      ))}
                      {chats.filter(c => !c.isArchived && !c.isTrashed).length === 0 && (
                        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                          No chats yet. Start a new chat above.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {sidebarTab === "archive" && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="chat-history-header" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}>
                      <span>🗂</span> Archive
                    </div>
                    <div className="chat-history-list" style={{ flex: 1, overflowY: 'auto' }}>
                      {chats.filter(c => c.isArchived && !c.isTrashed).map(c => (
                        <div key={c.id} className={`chat-item ${activeChatId === c.id ? 'active' : ''}`} onClick={() => switchChat(c.id)}>
                          <div className="chat-item-title">{c.title || "New Chat"}</div>
                          <button className={`chat-item-menu-btn ${menuOpenId === c.id ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
                            ⋮
                          </button>
                          {menuOpenId === c.id && (
                            <div className="chat-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button className="chat-menu-item" onClick={() => { unarchiveChat(c.id); setSidebarTab('chats'); setMenuOpenId(null); }}>Restore</button>
                              <button className="chat-menu-item danger" onClick={() => { deleteChat(c.id); setMenuOpenId(null); }}>Move to Trash</button>
                            </div>
                          )}
                        </div>
                      ))}
                      {chats.filter(c => c.isArchived && !c.isTrashed).length === 0 && (
                        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                          No archived chats.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {sidebarTab === "trash" && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="chat-history-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span>🗑</span> Trash</span>
                      {chats.filter(c => c.isTrashed).length > 0 && (
                        <button onClick={() => {
                          const next = chats.filter(c => !c.isTrashed);
                          setChats(next);
                          storageSet("ait-v2-chats", next);
                        }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Empty
                        </button>
                      )}
                    </div>
                    <div className="chat-history-list" style={{ flex: 1, overflowY: 'auto' }}>
                      {chats.filter(c => c.isTrashed).map(c => (
                        <div key={c.id} className={`chat-item ${activeChatId === c.id ? 'active' : ''}`} onClick={() => switchChat(c.id)}>
                          <div className="chat-item-title" style={{ color: 'var(--text-muted)' }}>{c.title || "New Chat"}</div>
                          <button className={`chat-item-menu-btn ${menuOpenId === c.id ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
                            ⋮
                          </button>
                          {menuOpenId === c.id && (
                            <div className="chat-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button className="chat-menu-item" onClick={() => { restoreChat(c.id); setSidebarTab('chats'); setMenuOpenId(null); }}>Restore</button>
                              <button className="chat-menu-item danger" onClick={() => { permanentDeleteChat(c.id); setMenuOpenId(null); }}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                      {chats.filter(c => c.isTrashed).length === 0 && (
                        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                          Trash is empty.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── BOTTOM TABS ── */}
              <div className="sidebar-bottom-tabs">
                <button
                  className={`sidebar-tab-btn ${sidebarTab === 'chats' ? 'active' : ''}`}
                  onClick={() => { setSidebarTab('chats'); }}
                  title="Chats"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  {chats.filter(c => !c.isArchived && !c.isTrashed).length > 0 && (
                    <span className="sidebar-tab-count">{chats.filter(c => !c.isArchived && !c.isTrashed).length}</span>
                  )}
                </button>
                <button
                  className={`sidebar-tab-btn ${sidebarTab === 'archive' ? 'active' : ''}`}
                  onClick={() => { setSidebarTab('archive'); setErr(''); setActiveChatId(null); }}
                  title="Archive"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8"></polyline>
                    <rect x="1" y="3" width="22" height="5"></rect>
                    <line x1="10" y1="12" x2="14" y2="12"></line>
                  </svg>
                  {chats.filter(c => c.isArchived && !c.isTrashed).length > 0 && (
                    <span className="sidebar-tab-count">{chats.filter(c => c.isArchived && !c.isTrashed).length}</span>
                  )}
                </button>
                <button
                  className={`sidebar-tab-btn ${sidebarTab === 'trash' ? 'active' : ''}`}
                  onClick={() => { setSidebarTab('trash'); setErr(''); setActiveChatId(null); }}
                  title="Trash"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  {chats.filter(c => c.isTrashed).length > 0 && (
                    <span className="sidebar-tab-count">{chats.filter(c => c.isTrashed).length}</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── FILES PANEL ── */}
          {panel === "files" && (
            <div style={{ padding: '12px' }}>
              <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '12px', marginTop: 0 }}>
                <span>FOLDER ACCESS</span>
                <button onClick={() => setPanel('chat')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '11px', textTransform: 'uppercase' }}>Close</button>
              </div>
              <button onClick={openFolder} className="modern-btn" style={{ width: '100%', padding: '12px 16px' }}>
                {dirHandle ? `⟳ Reload ${dirHandle.name}/` : "+ Open Folder"}
              </button>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 12, padding: "0 4px", lineHeight: 1.7 }}>
                Chrome / Edge only · Read-only access
                {dirHandle && <span style={{ color: "var(--text-primary)" }}><br />Click files to attach</span>}
              </div>

              {attached.length > 0 && (
                <div className="badge-success" style={{ marginTop: 16 }}>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>{attached.length} attached files</div>
                  {attached.map(f => (
                    <div key={f.name} onClick={() => setAttached(p => p.filter(x => x.name !== f.name))}
                      style={{ cursor: "pointer", padding: "6px 0", borderTop: "1px solid rgba(16, 185, 129, 0.2)", fontSize: 11 }}>
                      ✕ {f.name}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 16, borderTop: "1px solid var(--border-color)", paddingTop: 12 }}>
                {fileTree.map((item, i) => (
                  <FileNode key={i} item={item} depth={0} attached={attached}
                    expanded={expanded} onToggle={toggleDir}
                    onSelect={toggleFile} />
                ))}
                {fileTree.length === 0 && !dirHandle && (
                  <div style={{ padding: "32px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.8 }}>
                    No folder open.<br />Open a folder to let the AI read your code.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SETTINGS PANEL ── */}
          {panel === "settings" && (
            <div>
              <div className="section-title">SYSTEM PROMPT</div>
              <textarea value={sysPrompt} rows={7}
                onChange={e => { setSysPrompt(e.target.value); storageSet("ait-v2-sys", e.target.value); }}
                className="modern-input" style={{ resize: "vertical", lineHeight: 1.6 }} />
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN CHAT ───────────────────────────────────────── */}
      <div className="main-content">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-info">
            <select value={pid} onChange={e => changeProvider(e.target.value)} className="modern-select" style={{ padding: "3px 0px 3px 6px", fontSize: 13, height: 'auto', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', width: 'auto', outline: 'none', fontWeight: 500, cursor: 'pointer', borderRadius: 6, paddingRight: '20px' }}>
              {getOrderedProviders().map(k => {
                const p = mergedProviders[k];
                return (
                  <option key={k} value={k} disabled={p.disabled} style={{ backgroundColor: 'var(--bg-primary)', color: p.disabled ? 'var(--text-muted)' : 'var(--text-primary)', padding: '2px 4px' }}>
                    {p.name}
                  </option>
                );
              })}
            </select>
            <span style={{ color: "var(--text-muted)" }}>›</span>
            <select value={model} onChange={e => setModel(e.target.value)} className="modern-select" style={{ padding: "4px 10px", fontSize: 13, height: 'auto', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', width: 'auto', borderRadius: 6, outline: 'none' }}>
              {pid === "ollama"
                ? ollamaModels.length > 0
                  ? <>
                      <optgroup label="── Direct Ollama ──" style={{ backgroundColor: 'var(--bg-primary)' }}>
                        {ollamaModels.map(m => (
                          <option key={`direct:${m}`} value={`direct:${m}`} style={{ backgroundColor: 'var(--bg-primary)' }}>{m}</option>
                        ))}
                      </optgroup>
                      {launchersAvailable.claudeCode && (
                        <optgroup label="── Claude Code ──" style={{ backgroundColor: 'var(--bg-primary)' }}>
                          {ollamaModels.map(m => (
                            <option key={`claude:${m}`} value={`claude:${m}`} style={{ backgroundColor: 'var(--bg-primary)' }}>Claude Code → {m}</option>
                          ))}
                        </optgroup>
                      )}
                      {launchersAvailable.codex && (
                        <optgroup label="── Codex (Agentic) ──" style={{ backgroundColor: 'var(--bg-primary)' }}>
                          {ollamaModels.map(m => (
                            <option key={`codex:${m}`} value={`codex:${m}`} style={{ backgroundColor: 'var(--bg-primary)' }}>Codex → {m}</option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  : <option value="" disabled>No models installed — run: ollama pull llama3.2</option>
                : (mergedProviders[pid]?.models || []).filter(m => m.isActive).length > 0
                  ? (mergedProviders[pid]?.models || []).filter(m => m.isActive).map(m => (
                      <option key={m.id} value={m.id} style={{ backgroundColor: 'var(--bg-primary)' }}>{m.name}</option>
                    ))
                  : <option value="" disabled>No Models</option>
              }
            </select>
            {messages.length > 0 && (
              <>
                <span style={{ color: "var(--text-muted)" }}>·</span>
                <span>{messages.filter(m => m.role === "assistant").length} Responses</span>
                <span style={{ color: "var(--text-muted)" }}>·</span>
                <span>{messages.filter(m => m.role === "user").length} Chats</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {dirHandle && (
              <span className="badge-success" style={{ margin: 0, padding: "4px 10px", fontSize: 11 }}>📁 {dirHandle.name}/</span>
            )}
            <button onClick={() => setShowSettings(true)} className="settings-btn" title="Settings">
              ⚙️
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={msgsRef} className="messages-container">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">✧</div>
              <div className="empty-title">AI Workspace</div>
              <div className="empty-desc">
                Select a provider in the MODEL tab, open your project folder in the FILES tab, and attach files to give the AI context.<br /><br />Code blocks in replies will include simple save buttons.
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <MsgBubble key={i} msg={m} provId={pid} modelId={model} provOverride={mergedProviders[pid]} />
          ))}
          {loading && loadingChatId === activeChatId && (
            <div className="msg-wrapper assistant">
              <div className="msg-inner">
                <div className="msg-header">
                  <span style={{ color: prov.accent }}>{prov.tag}</span>
                </div>
                <div className="msg-content blink" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: "var(--text-secondary)" }}>
                  <span style={{ fontSize: 18, color: prov.accent }}>▌</span>
                  {loadingText}
                </div>
              </div>
            </div>
          )}
          {err && sidebarTab === 'chats' && (
            <div className="error-banner" style={{ borderRadius: 8, margin: '8px 24px', borderBottom: 'none', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <strong>Error:</strong>{' '}
              {err.includes('Providers') ? (
                <>
                  {err.split('Providers')[0]}
                  <span
                    onClick={() => { setShowSettings(true); setSettingsSection('api-keys'); }}
                    style={{ color: '#e2e8f0', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}
                  >Providers</span>
                  {err.split('Providers')[1]}
                </>
              ) : err}
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area - hide in Archive and Trash tabs */}
        {sidebarTab === 'chats' && (
          <div style={{ position: 'relative' }}>
            {showScrollBtn && (
              <button
                onClick={() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                style={{
                  position: 'absolute',
                  top: -36,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10,
                  background: 'rgba(23, 25, 31, 0.55)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-secondary)',
                  borderRadius: '20px',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease',
                  fontFamily: 'var(--font-sans)',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                Latest response
              </button>
            )}
          <div className="input-area">
            {attached.length > 0 && (
              <div className="attached-files">
                {attached.map(f => (
                  <span key={f.name} onClick={() => setAttached(p => p.filter(x => x.name !== f.name))} className="attached-tag">
                    {f.name} ✕
                  </span>
                ))}
              </div>
            )}
            <div className="input-row">
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  title="Attach"
                  className="input-attach-btn"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </button>
                {showAttachMenu && (
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    marginBottom: 8,
                    backgroundColor: 'var(--bg-sidebar)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    padding: 4,
                    minWidth: 120,
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                    zIndex: 100,
                    animation: 'fadeIn 0.15s ease-out'
                  }}>
                    <button 
                      onClick={() => { 
                        if (dirHandle) setPanel("files"); else openFolder(); 
                        setShowAttachMenu(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        padding: '8px 12px',
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        fontFamily: 'var(--font-sans)'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = 'var(--bg-hover)';
                        e.target.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = 'transparent';
                        e.target.style.color = 'var(--text-secondary)';
                      }}
                    >
                      📄 Files
                    </button>
                  </div>
                )}
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  // Auto-expand textarea upward (max 6 visible lines)
                  e.target.style.height = 'auto';
                  const lineHeight = 24;
                  const maxLines = 6;
                  const scrollHeight = e.target.scrollHeight;
                  const maxHeight = lineHeight * maxLines;
                  
                  // Expand up to 6 lines, then enable scrolling
                  if (scrollHeight <= maxHeight) {
                    e.target.style.height = scrollHeight + 'px';
                    e.target.style.overflowY = 'hidden';
                  } else {
                    e.target.style.height = maxHeight + 'px';
                    e.target.style.overflowY = 'auto';
                  }
                }}
                onKeyDown={onKey}
                placeholder={`Message ${prov.name}...`}
                className="main-input"
                disabled={loading && loadingChatId === activeChatId}
                rows={1}
                style={{ 
                  resize: 'none', 
                  overflowY: 'hidden',
                  minHeight: '24px',
                  maxHeight: '144px', // 6 lines * 24px
                  lineHeight: '24px',
                  padding: '8px 12px',
                  verticalAlign: 'bottom',
                  alignSelf: 'flex-end'
                }}
              />
              <button
                onClick={loading && loadingChatId === activeChatId ? handleStop : handleSend}
                className={`send-btn ${loading && loadingChatId === activeChatId ? 'stop' : 'send'}`}
                title={loading && loadingChatId === activeChatId ? "Stop" : "Send"}
              >
                {loading && loadingChatId === activeChatId ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                )}
              </button>
            </div>

          </div>
          </div>
        )}
      </div>

      {/* ── SETTINGS MODAL ── */}
      {showSettings && (
        <div className={`settings-overlay ${settingsClosing ? 'closing' : ''}`} onClick={closeSettings}>
          <div className={`settings-modal ${settingsClosing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <div className="settings-title">⚙️ Settings</div>
              <button className="settings-close" onClick={closeSettings}>✕</button>
            </div>
            <div className="settings-body">
              {/* APP SETTINGS */}
              <div>
                <div className="section-title" style={{ marginTop: 0, padding: '16px 24px 12px', marginBottom: 0 }}>APP SETTINGS</div>

                <div className="settings-row">
                  <span className="settings-label">Dark Mode</span>
                  <label className="switch">
                    <input type="checkbox" checked={darkMode} onChange={e => { setDarkMode(e.target.checked); storageSet("ait-v2-dark", e.target.checked); }} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              {/* SYSTEM SETTINGS */}
              <div>
                <div className="section-title" style={{ padding: '16px 24px 12px', marginBottom: 0 }}>SYSTEM SETTINGS</div>

                <div className="settings-row" style={{ cursor: 'pointer', padding: '12px 24px' }} onClick={() => {
                  if (settingsSection === 'system-prompt') {
                    closeSection();
                  } else {
                    setSettingsSection('system-prompt');
                  }
                }}>
                  <span className="settings-label">System Prompt</span>
                </div>

                <div className="settings-row" style={{ cursor: 'pointer', padding: '12px 24px' }} onClick={() => {
                  if (settingsSection === 'api-keys') {
                    closeSection();
                  } else {
                    setSettingsSection('api-keys');
                  }
                }}>
                  <span className="settings-label">Providers</span>
                </div>

                <div className="settings-row" style={{ cursor: 'pointer', padding: '12px 24px' }} onClick={() => {
                  if (settingsSection === 'models') {
                    closeSection();
                  } else {
                    setSettingsSection('models');
                  }
                }}>
                  <span className="settings-label">Models</span>
                </div>
              </div>
            </div>
          </div>

          {/* LEFT SIDE PANEL FOR EXPANDED SECTIONS */}
          {settingsSection && (
            <div className={`settings-left-panel ${sectionClosing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
              <div className="settings-panel-header">
                <div className="settings-panel-title">
                  {settingsSection === 'system-prompt' && 'System Prompt'}
                  {settingsSection === 'api-keys' && 'Providers'}
                  {settingsSection === 'models' && 'Models'}
                </div>
                <button className="settings-close" onClick={closeSection}>✕</button>
              </div>
              <div className="settings-panel-body">
                {/* SYSTEM PROMPT CONTENT */}
                {settingsSection === 'system-prompt' && (
                  <div>
                    <textarea value={sysPrompt} rows={10}
                      onChange={e => { setSysPrompt(e.target.value); storageSet("ait-v2-sys", e.target.value); }}
                      className="modern-input" style={{ width: "100%", resize: "vertical", lineHeight: 1.6, marginBottom: 16 }} />

                    <div style={{ padding: '16px', backgroundColor: 'var(--bg-hover)', borderRadius: 'var(--btn-radius)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>AI Response Behavior Preview</div>
                      {(() => {
                        const prompt = sysPrompt.toLowerCase();
                        let category = 'Custom';
                        let categoryColor = 'var(--text-secondary)';
                        let description = '';
                        let characteristics = [];
                        let tone = '';
                        let responseStyle = '';
                        let strengths = [];

                        if (prompt.includes('coding') || prompt.includes('code') || prompt.includes('programming') || prompt.includes('developer') || prompt.includes('software')) {
                          category = 'Technical / Coding Expert'; categoryColor = '#3b82f6';
                          description = 'The AI will act as a professional software developer and coding assistant, focusing on technical accuracy and best practices.';
                          tone = 'Professional, Technical, Precise'; responseStyle = 'Structured code blocks with detailed explanations';
                          characteristics = ['Provides production-ready code with proper syntax', 'Includes comprehensive comments and documentation', 'Follows industry best practices and design patterns', 'Explains technical concepts clearly', 'Suggests optimizations and improvements', 'Considers edge cases and error handling'];
                          strengths = ['Code Quality', 'Technical Accuracy', 'Best Practices'];
                        } else if (prompt.includes('concise') || prompt.includes('brief') || prompt.includes('short') || prompt.includes('minimal')) {
                          category = 'Concise / Direct'; categoryColor = '#f59e0b';
                          description = 'The AI will provide brief, to-the-point responses without unnecessary elaboration.';
                          tone = 'Direct, Efficient, No-nonsense'; responseStyle = 'Short paragraphs with key information only';
                          characteristics = ['Gets straight to the point', 'Minimal explanations unless requested', 'Focuses on essential information', 'Avoids verbose descriptions', 'Quick and efficient responses', 'Bullet points for clarity'];
                          strengths = ['Speed', 'Clarity', 'Efficiency'];
                        } else if (prompt.includes('detailed') || prompt.includes('thorough') || prompt.includes('comprehensive') || prompt.includes('in-depth')) {
                          category = 'Detailed / Comprehensive'; categoryColor = '#8b5cf6';
                          description = 'The AI will provide extensive, thorough explanations covering all aspects of the topic.';
                          tone = 'Thorough, Educational, Comprehensive'; responseStyle = 'Long-form content with multiple sections';
                          characteristics = ['Provides extensive background information', 'Covers multiple perspectives and approaches', 'Includes examples and use cases', 'Explains the "why" behind recommendations', 'Anticipates follow-up questions', 'Offers additional resources and context'];
                          strengths = ['Depth', 'Completeness', 'Educational Value'];
                        } else if (prompt.includes('creative') || prompt.includes('imaginative') || prompt.includes('innovative') || prompt.includes('artistic')) {
                          category = 'Creative / Innovative'; categoryColor = '#ec4899';
                          description = 'The AI will think outside the box and provide creative, innovative solutions and ideas.';
                          tone = 'Imaginative, Inspiring, Original'; responseStyle = 'Creative suggestions with unique perspectives';
                          characteristics = ['Generates unique and original ideas', 'Explores unconventional approaches', 'Thinks beyond standard solutions', 'Encourages experimentation', 'Provides multiple creative alternatives', 'Balances creativity with practicality'];
                          strengths = ['Innovation', 'Originality', 'Fresh Perspectives'];
                        } else if (prompt.includes('professional') || prompt.includes('formal') || prompt.includes('business') || prompt.includes('corporate')) {
                          category = 'Professional / Formal'; categoryColor = '#06b6d4';
                          description = 'The AI will maintain a professional, business-appropriate tone suitable for corporate environments.';
                          tone = 'Formal, Polished, Business-appropriate'; responseStyle = 'Well-structured professional communication';
                          characteristics = ['Uses formal language and terminology', 'Maintains professional boundaries', 'Focuses on business value and ROI', 'Provides actionable recommendations', 'Considers organizational context', 'Suitable for workplace communication'];
                          strengths = ['Professionalism', 'Business Focus', 'Credibility'];
                        } else if (prompt.includes('friendly') || prompt.includes('casual') || prompt.includes('conversational') || prompt.includes('approachable')) {
                          category = 'Friendly / Casual'; categoryColor = '#10b981';
                          description = 'The AI will communicate in a warm, friendly manner that feels like talking to a knowledgeable friend.';
                          tone = 'Friendly, Warm, Conversational'; responseStyle = 'Natural, easy-to-read dialogue';
                          characteristics = ['Uses conversational language', 'Maintains a warm and approachable tone', 'Makes complex topics accessible', 'Encourages questions and dialogue', 'Shows empathy and understanding', 'Balances friendliness with helpfulness'];
                          strengths = ['Approachability', 'Clarity', 'Engagement'];
                        } else if (prompt.includes('expert') || prompt.includes('advanced') || prompt.includes('technical') || prompt.includes('specialist')) {
                          category = 'Expert / Advanced'; categoryColor = '#ef4444';
                          description = 'The AI will assume advanced knowledge and provide expert-level insights and technical depth.';
                          tone = 'Expert, Authoritative, Technical'; responseStyle = 'Advanced technical content with minimal hand-holding';
                          characteristics = ['Assumes high level of existing knowledge', 'Uses technical jargon appropriately', 'Focuses on advanced concepts', 'Provides deep technical insights', 'References industry standards', 'Discusses trade-offs and nuances'];
                          strengths = ['Technical Depth', 'Expertise', 'Advanced Insights'];
                        } else if (prompt.includes('teacher') || prompt.includes('educational') || prompt.includes('explain') || prompt.includes('tutor')) {
                          category = 'Educational / Teacher'; categoryColor = '#f97316';
                          description = 'The AI will act as a patient teacher, breaking down complex topics into understandable lessons.';
                          tone = 'Patient, Educational, Encouraging'; responseStyle = 'Step-by-step explanations with examples';
                          characteristics = ['Breaks down complex concepts', 'Uses analogies and examples', 'Checks for understanding', 'Builds knowledge progressively', 'Encourages learning and growth', "Adapts to learner's level"];
                          strengths = ['Clarity', 'Patience', 'Learning Support'];
                        } else if (prompt.includes('helpful') || prompt.includes('assistant') || prompt.includes('supportive')) {
                          category = 'Helpful / Supportive'; categoryColor = '#14b8a6';
                          description = 'The AI will be a supportive assistant focused on helping you achieve your goals efficiently.';
                          tone = 'Helpful, Supportive, Solution-focused'; responseStyle = 'Clear guidance with actionable steps';
                          characteristics = ['Focuses on solving your problems', 'Provides clear, actionable advice', 'Anticipates your needs', 'Offers multiple solutions', 'Follows up on previous context', 'Prioritizes your success'];
                          strengths = ['Problem-solving', 'Practicality', 'User Focus'];
                        } else if (prompt.trim() === '') {
                          category = 'Default / Balanced'; categoryColor = 'var(--text-muted)';
                          description = 'No specific system prompt is set. The AI will use its default balanced behavior.';
                          tone = 'Neutral, Balanced, Adaptive'; responseStyle = 'Standard responses adapting to context';
                          characteristics = ['Adapts to the context of your questions', 'Balances detail with conciseness', 'Maintains neutral, helpful tone', 'Provides general-purpose assistance', 'No specific behavioral constraints', 'Flexible response style'];
                          strengths = ['Flexibility', 'Adaptability', 'General Purpose'];
                        } else {
                          category = 'Custom Behavior'; categoryColor = '#a855f7';
                          description = 'The AI will follow your custom instructions as specified in the system prompt above.';
                          tone = 'Defined by your custom prompt'; responseStyle = 'Based on your specific instructions';
                          characteristics = ['Follows your specific instructions', 'Behavior depends on prompt content', 'May combine multiple styles', 'Customized to your needs', 'Unique response patterns', 'Tailored personality and approach'];
                          strengths = ['Customization', 'Flexibility', 'Personalization'];
                        }

                        return (
                          <div>
                            <div style={{ display: 'inline-block', padding: '6px 12px', backgroundColor: categoryColor + '20', border: `1px solid ${categoryColor}40`, borderRadius: '6px', marginBottom: 16 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: categoryColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{category}</span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7, marginBottom: 16 }}>{description}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Tone</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tone}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Response Style</div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{responseStyle}</div>
                              </div>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Speaking Language</div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                {(() => {
                                  const p = sysPrompt.toLowerCase();
                                  if (/\b(spanish|español|espanol)\b/.test(p)) return '🇪🇸 Spanish (Español)';
                                  if (/\b(french|français|francais)\b/.test(p)) return '🇫🇷 French (Français)';
                                  if (/\b(german|deutsch)\b/.test(p)) return '🇩🇪 German (Deutsch)';
                                  if (/\b(italian|italiano)\b/.test(p)) return '🇮🇹 Italian (Italiano)';
                                  if (/\b(portuguese|português|portugues)\b/.test(p)) return '🇵🇹 Portuguese (Português)';
                                  if (/\b(russian|русский)\b/.test(p)) return '🇷🇺 Russian (Русский)';
                                  if (/\b(japanese|日本語|nihongo)\b/.test(p)) return '🇯🇵 Japanese (日本語)';
                                  if (/\b(chinese|中文|mandarin)\b/.test(p)) return '🇨🇳 Chinese (中文)';
                                  if (/\b(korean|한국어|hangul)\b/.test(p)) return '🇰🇷 Korean (한국어)';
                                  if (/\b(arabic|العربية)\b/.test(p)) return '🇸🇦 Arabic (العربية)';
                                  if (/\b(hindi|हिन्दी)\b/.test(p)) return '🇮🇳 Hindi (हिन्दी)';
                                  if (/\b(dutch|nederlands)\b/.test(p)) return '🇳🇱 Dutch (Nederlands)';
                                  if (/\b(polski)\b/.test(p) || p.includes('język polski')) return '🇵🇱 Polish (Polski)';
                                  if (/\b(turkish|türkçe|turkce)\b/.test(p)) return '🇹🇷 Turkish (Türkçe)';
                                  if (/\b(swedish|svenska)\b/.test(p)) return '🇸🇪 Swedish (Svenska)';
                                  if (/\b(norwegian|norsk)\b/.test(p)) return '🇳🇴 Norwegian (Norsk)';
                                  if (/\b(danish|dansk)\b/.test(p)) return '🇩🇰 Danish (Dansk)';
                                  if (/\b(finnish|suomi)\b/.test(p)) return '🇫🇮 Finnish (Suomi)';
                                  if (/\b(greek|ελληνικά)\b/.test(p)) return '🇬🇷 Greek (Ελληνικά)';
                                  if (/\b(czech|čeština|cestina)\b/.test(p)) return '🇨🇿 Czech (Čeština)';
                                  if (/\b(vietnamese|tiếng việt|tieng viet)\b/.test(p)) return '🇻🇳 Vietnamese (Tiếng Việt)';
                                  if (/\b(thai|ภาษาไทย)\b/.test(p)) return '🇹🇭 Thai (ภาษาไทย)';
                                  if (/\b(indonesian|bahasa indonesia)\b/.test(p)) return '🇮🇩 Indonesian (Bahasa Indonesia)';
                                  if (/\b(malay|bahasa melayu)\b/.test(p)) return '🇲🇾 Malay (Bahasa Melayu)';
                                  if (/\b(tagalog|filipino)\b/.test(p)) return '🇵🇭 Tagalog / Filipino';
                                  return '🇬🇧 English (Default)';
                                })()}
                              </div>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Key Characteristics</div>
                              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                                {characteristics.map((char, i) => (
                                  <div key={i} style={{ marginBottom: 4, paddingLeft: 12, position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: 0, color: categoryColor }}>•</span>
                                    {char}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Primary Strengths</div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {strengths.map((strength, i) => (
                                  <span key={i} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: 'var(--bg-active)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)' }}>
                                    {strength}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* API KEYS CONTENT */}
                {settingsSection === 'api-keys' && (
                  <div>
                    {!showProviderModal ? (
                      <>
                        <button
                          className="new-chat-btn"
                          onClick={() => setShowProviderModal(true)}
                          style={{ margin: '0 0 24px 0', width: '100%', maxWidth: 'none' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                          </svg>
                          Edit Providers
                        </button>

                        <div className="section-title">Configured Providers</div>
                        <table className="api-keys-table">
                          <thead>
                            <tr>
                              <th>Provider</th>
                              <th style={{ width: '130px', textAlign: 'center' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Cloud label */}
                            <tr>
                              <td colSpan={2} style={{ padding: '8px 0 4px', borderBottom: 'none' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>☁ Cloud</span>
                              </td>
                            </tr>
                            {/* Cloud providers */}
                            {getOrderedProviders().filter(p => p !== 'ollama' && !mergedProviders[p]?.local).map(prov => {
                              const isCustom = mergedProviders[prov].isCustom;
                              const isActive = prov === pid;
                              // Active provider: use live apiStatus. Inactive: use keyStatus from real-time validation.
                              let isConnected;
                              let isChecking;
                              if (isActive) {
                                isConnected = apiStatus.state === 'ok';
                                isChecking = apiStatus.state === 'checking';
                              } else {
                                const ks = keyStatus[prov];
                                // If key exists but not yet validated (no keyStatus entry or fetching), show checking
                                isConnected = ks === 'synced';
                                isChecking = isKeyValid(apiKeys[prov]) && (ks === undefined || ks === null || ks === 'fetching');
                              }
                              return (
                                <tr key={prov}>
                                  <td style={{ textTransform: isCustom ? 'none' : 'capitalize', fontWeight: 500 }}>
                                    {mergedProviders[prov].name || prov}
                                  </td>
                                  <td style={{ width: '130px', textAlign: 'center' }}>
                                    {isConnected ? (
                                      <span style={{ color: '#10b981', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot green"></div> Connected
                                      </span>
                                    ) : isChecking ? (
                                      <span style={{ color: '#f59e0b', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot yellow"></div> Checking...
                                      </span>
                                    ) : (
                                      <span style={{ color: '#f59e0b', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot yellow"></div> Setup Required
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* Local label */}
                            <tr>
                              <td colSpan={2} style={{ padding: '12px 0 4px', borderBottom: 'none', borderTop: '1px solid var(--border-color)' }}>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>⬡ Local</span>
                              </td>
                            </tr>
                            {/* Local providers */}
                            {getOrderedProviders().filter(p => p === 'ollama' || mergedProviders[p]?.local).map(prov => {
                              const isRunning = prov === 'ollama' ? ollamaStatus === 'running' : false;
                              return (
                                <tr key={prov}>
                                  <td style={{ fontWeight: 500 }}>
                                    {mergedProviders[prov].name || prov}
                                  </td>
                                  <td style={{ width: '130px', textAlign: 'center' }}>
                                    {isRunning ? (
                                      <span style={{ color: '#10b981', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot green"></div> Running
                                      </span>
                                    ) : ollamaNotFound ? (
                                      <span style={{ color: '#ef4444', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot red"></div> Not Found
                                      </span>
                                    ) : (
                                      <span style={{ color: '#f59e0b', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                        <div className="status-dot yellow"></div> Stopped
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    ) : (
                      <>
                        <button
                          className="new-chat-btn"
                          onClick={() => setShowProviderModal(false)}
                          style={{ margin: '0 0 24px 0', width: '100%', maxWidth: 'none', backgroundColor: 'var(--bg-active)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                          </svg>
                          Done Editing
                        </button>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          {/* ── CLOUD LABEL ── */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>☁ Cloud</span>
                          </div>

                          {/* Cloud provider cards */}
                          {getOrderedProviders().filter(p => p !== 'ollama' && !mergedProviders[p]?.local).map(prov => {
                            const isCustom = mergedProviders[prov].isCustom;
                            const p = mergedProviders[prov];
                            const keyVal = apiKeys[prov] || "";

                            return (
                              <div key={prov}
                                onDragOver={(e) => handleDragOver(e, prov)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, prov)}
                                style={{
                                  padding: '16px', backgroundColor: 'var(--bg-primary)',
                                  border: `1px solid ${dragOverProvider === prov ? 'var(--accent)' : 'var(--border-color)'}`,
                                  borderRadius: '8px',
                                  opacity: draggedProvider === prov ? 0.5 : 1,
                                  transform: dragOverProvider === prov ? 'translateY(2px)' : 'none',
                                  transition: 'all 0.2s',
                                  boxShadow: dragOverProvider === prov ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                                }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div
                                      draggable
                                      onDragStart={(e) => handleDragStart(e, prov)}
                                      style={{ cursor: 'grab', color: 'var(--text-muted)' }}
                                      title="Drag to reorder"
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" /></svg>
                                    </div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px', textTransform: isCustom ? 'none' : 'capitalize' }}>
                                      {isCustom ? (p.name || "Custom Provider") : (p.name || prov)}
                                    </div>
                                  </div>
                                  {confirmDeleteId === prov ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>Delete?</span>
                                      <button
                                        onClick={() => { deleteCustomProvider(prov); setConfirmDeleteId(null); }}
                                        style={{ background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', fontWeight: 600 }}
                                      >Yes</button>
                                      <button
                                        onClick={() => setConfirmDeleteId(null)}
                                        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '4px', padding: '3px 8px', fontSize: '11px' }}
                                      >Cancel</button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setConfirmDeleteId(prov)}
                                      title="Delete Provider"
                                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    </button>
                                  )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '12px' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Provider Name</label>
                                      <input
                                        value={p.name !== undefined ? p.name : ""}
                                        onChange={(e) => updateCustomProvider(prov, 'name', e.target.value)}
                                        className="modern-input"
                                        placeholder="New Provider"
                                        style={{ fontSize: '12px', padding: '6px 10px' }}
                                      />
                                    </div>
                                    <div>
                                      <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>Endpoint URL</label>
                                      <input
                                        value={p.customUrl !== undefined ? p.customUrl : (p.url !== undefined ? p.url : (
                                          prov === "gemini" ? "https://generativelanguage.googleapis.com" :
                                            prov === "groq" ? "https://api.groq.com/openai/v1/chat/completions" :
                                              prov === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : ""
                                        ))}
                                        onChange={(e) => updateCustomProvider(prov, 'customUrl', e.target.value)}
                                        className="modern-input"
                                        placeholder="https://endpointurlhere/"
                                        style={{ fontSize: '12px', padding: '6px 10px' }}
                                      />
                                    </div>
                                  </div>

                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                      <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>API Key</label>
                                      {keyVal ? <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 500 }}>✓ Saved</span> : <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 500 }}>Empty</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                      {(() => {
                                        const isVisible = visibleKeys[prov] !== false;
                                        return (
                                          <>
                                            <input
                                              type={isVisible ? "text" : "password"}
                                              value={!isVisible && keyVal ? "x".repeat(64) : keyVal}
                                              onChange={(e) => saveKey(prov, e.target.value)}
                                              disabled={!isVisible}
                                              onCopy={!isVisible ? (e) => e.preventDefault() : undefined}
                                              onCut={!isVisible ? (e) => e.preventDefault() : undefined}
                                              onSelect={!isVisible ? (e) => e.target.setSelectionRange(0, 0) : undefined}
                                              className="modern-input"
                                              style={{ flex: 1, fontSize: '12px', padding: '6px 10px', opacity: !isVisible ? 0.6 : 1, userSelect: !isVisible ? 'none' : 'auto', WebkitUserSelect: !isVisible ? 'none' : 'auto' }}
                                              placeholder="YOUR_API_KEY_HERE"
                                            />
                                            <button
                                              onClick={() => setVisibleKeys(prev => ({ ...prev, [prov]: !isVisible }))}
                                              className="modern-btn"
                                              style={{ padding: '6px 12px', width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}
                                              title={isVisible ? "Hide Key" : "Show Key"}
                                            >
                                              {isVisible ? (
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                  <line x1="1" y1="1" x2="23" y2="23"></line>
                                                </svg>
                                              ) : (
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                  <circle cx="12" cy="12" r="3"></circle>
                                                </svg>
                                              )}
                                            </button>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>

                              </div>
                            );
                          })}

                          <button
                            onClick={() => {
                              const newId = "custom_" + Date.now();
                              const newProvider = { id: newId, name: "", url: "", defaultModel: "", models: [] };
                              const next = [...customProviders, newProvider];
                              setCustomProviders(next);
                              storageSet("ait-v2-custom-providers", next);
                              // Ensure new provider input starts visible/enabled
                              setVisibleKeys(prev => ({ ...prev, [newId]: true }));
                            }}
                            className="new-chat-btn"
                            style={{ width: '100%', maxWidth: 'none', marginTop: '8px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px dashed var(--border-color)' }}
                          >
                            + Add Provider
                          </button>

                          {/* ── LOCAL LABEL ── */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>⬡ Local</span>
                          </div>

                          {/* Local provider cards (Ollama + any local custom) */}
                          {getOrderedProviders().filter(p => p === 'ollama' || mergedProviders[p]?.local).map(prov => {
                            const isCustom = mergedProviders[prov].isCustom;
                            const p = mergedProviders[prov];
                            const keyVal = apiKeys[prov] || "";

                            // Ollama special card is rendered inline here too
                            if (prov === 'ollama') {
                              return (
                                <div key={prov} ref={ollamaCardRef} style={{
                                  padding: '16px', backgroundColor: 'var(--bg-primary)',
                                  border: '1px solid var(--border-color)', borderRadius: '8px'
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                    <span style={{ fontSize: 22 }}>🦙</span>
                                    <div>
                                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Ollama (Offline)</div>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Run AI models 100% locally — no internet, no API key</div>
                                    </div>
                                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div className={`status-dot ${
                                        ollamaStatus === 'running' ? 'green' : 
                                        ollamaStatus === 'starting' || ollamaStatus === 'stopping' || ollamaStatus === 'checking' ? 'yellow' : 
                                        'red'
                                      }`} />
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                                        {ollamaStatus === 'running' ? 'Running' :
                                         ollamaStatus === 'starting' ? 'Starting...' :
                                         ollamaStatus === 'stopping' ? 'Stopping...' :
                                         ollamaStatus === 'checking' ? 'Checking...' :
                                         ollamaNotFound ? 'Not Found' : 'Stopped'}
                                      </span>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                                    <button className="modern-btn" style={{ fontSize: 12, padding: '6px 14px', color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
                                      onClick={async () => {
                                        setOllamaTerminalOpen(true);
                                        setOllamaTerminalBusy(true);
                                        setOllamaTerminalLog([]);
                                        await window.electronAPI?.ollamaInstall?.();
                                        const check = await window.electronAPI?.checkOllama?.();
                                        if (check?.running) { setOllamaOk(true); if (check.models?.length) setOllamaModels(check.models); }
                                        setOllamaTerminalBusy(false);
                                      }}>⬇ Install Ollama</button>
                                    <button className="modern-btn" style={{ fontSize: 12, padding: '6px 14px' }}
                                      disabled={ollamaTerminalBusy || ollamaStatus === 'running' || ollamaStatus === 'starting'}
                                      onClick={async () => {
                                        setOllamaTerminalOpen(true);
                                        setOllamaTerminalBusy(true);
                                        setOllamaTerminalLog([]);
                                        setOllamaStatus('starting');

                                        const append = (msg) => setOllamaTerminalLog(p => [...p, msg]);

                                        if (!window.electronAPI) {
                                          append('ERROR: Not running in Electron. Launch via npm run electron:dev\n');
                                          setOllamaTerminalBusy(false);
                                          setOllamaStatus('stopped');
                                          return;
                                        }

                                        try {
                                          append('> Checking Ollama status...\n');
                                          const check = await window.electronAPI.checkOllama();
                                          
                                          if (!check?.running) {
                                            append('> Ollama is not running. Starting ollama serve...\n');
                                            
                                            // Register log listener BEFORE starting
                                            window.electronAPI.onOllamaLog(append);
                                            
                                            // Start Ollama
                                            const startResult = await window.electronAPI.startOllama();
                                            
                                            if (startResult.notFound) {
                                              append('✗ Ollama not found. Install from https://ollama.com/download\n');
                                              setOllamaOk(false);
                                              setOllamaNotFound(true);
                                              setOllamaStatus('stopped');
                                            } else if (startResult.started) {
                                              append('✓ Ollama serve started successfully\n');
                                              setOllamaOk(true);
                                              setOllamaNotFound(false);
                                              setOllamaBlocked(false);
                                              setOllamaStatus('running');
                                              
                                              // Fetch models
                                              const recheck = await window.electronAPI.checkOllama();
                                              if (recheck?.models?.length) {
                                                append(`✓ Found ${recheck.models.length} model(s)\n`);
                                                setOllamaModels(recheck.models);
                                              }
                                              
                                              // Force API status update
                                              if (pid === 'ollama') {
                                                setApiStatus({ state: "ok", label: "Ollama Connected" });
                                              }
                                            } else if (startResult.timeout) {
                                              append('✗ Timed out waiting for Ollama to start\n');
                                              setOllamaOk(false);
                                              setOllamaStatus('stopped');
                                            } else if (startResult.alreadyRunning) {
                                              append('✓ Ollama is already running\n');
                                              setOllamaOk(true);
                                              setOllamaBlocked(false);
                                              setOllamaStatus('running');
                                              if (check?.models?.length) {
                                                append(`✓ Found ${check.models.length} model(s)\n`);
                                                setOllamaModels(check.models);
                                              }
                                              
                                              // Force API status update
                                              if (pid === 'ollama') {
                                                setApiStatus({ state: "ok", label: "Ollama Connected" });
                                              }
                                            } else {
                                              append('✗ Failed to start Ollama serve\n');
                                              setOllamaOk(false);
                                              setOllamaStatus('stopped');
                                            }
                                          } else {
                                            append('✓ Ollama is already running\n');
                                            setOllamaOk(true);
                                            setOllamaBlocked(false);
                                            setOllamaStatus('running');
                                            if (check?.models?.length) {
                                              append(`✓ Found ${check.models.length} model(s)\n`);
                                              setOllamaModels(check.models);
                                            }
                                            
                                            // Force API status update
                                            if (pid === 'ollama') {
                                              setApiStatus({ state: "ok", label: "Ollama Connected" });
                                            }
                                          }
                                        } catch (error) {
                                          append(`✗ Error: ${error.message}\n`);
                                          setOllamaOk(false);
                                          setOllamaStatus('stopped');
                                        }
                                        
                                        setOllamaTerminalBusy(false);
                                      }}>Start</button>
                                    <button className="modern-btn" style={{ fontSize: 12, padding: '6px 14px', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}
                                      disabled={ollamaTerminalBusy || ollamaStatus === 'stopped' || ollamaStatus === 'stopping'}
                                      onClick={async () => {
                                        setOllamaTerminalOpen(true);
                                        setOllamaTerminalBusy(true);
                                        setOllamaTerminalLog([]);
                                        setOllamaStatus('stopping');

                                        const append = (msg) => setOllamaTerminalLog(p => [...p, msg]);

                                        if (!window.electronAPI) {
                                          append('ERROR: Not running in Electron.\n');
                                          setOllamaTerminalBusy(false);
                                          setOllamaStatus('running');
                                          return;
                                        }

                                        append('> Stopping Ollama connection...\n');
                                        
                                        // Block the connection at app level
                                        setOllamaBlocked(true);
                                        setOllamaOk(false);
                                        setOllamaStatus('stopped');
                                        
                                        append('✓ Connection stopped (Ollama process still running in background)\n');
                                        append('  To fully stop Ollama, run: taskkill /IM ollama.exe /F\n');
                                        
                                        setOllamaTerminalBusy(false);
                                      }}>Stop</button>
                                  </div>
                                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12, marginBottom: 12 }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>Pull a Model</div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                      <input value={ollamaPullModel} onChange={e => setOllamaPullModel(e.target.value)}
                                        className="modern-input" placeholder="e.g. llama3.2, mistral, qwen2.5-coder"
                                        style={{ fontSize: 12, padding: '6px 10px', flex: 1 }}
                                        onKeyDown={e => { if (e.key === 'Enter') e.target.nextSibling?.click(); }} />
                                      <button className="modern-btn primary" style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }}
                                        disabled={ollamaTerminalBusy || !ollamaPullModel.trim()}
                                        onClick={async () => {
                                          const m = ollamaPullModel.trim(); if (!m) return;
                                          setOllamaTerminalOpen(true); setOllamaTerminalBusy(true);
                                          setOllamaTerminalLog([]);
                                          await window.electronAPI?.ollamaPullModel?.(m);
                                          const check = await window.electronAPI?.checkOllama?.();
                                          if (check?.models?.length) setOllamaModels(check.models);
                                          setOllamaTerminalBusy(false);
                                        }}>Pull</button>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                                      Popular: llama3.2 · mistral · qwen2.5-coder · deepseek-coder-v2 · phi3
                                    </div>
                                  </div>
                                  {ollamaModels.length > 0 && (
                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, fontWeight: 600 }}>
                                        Installed Models ({ollamaModels.length})
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {ollamaModels.map(m => (
                                          <span key={m} style={{ fontSize: 11, padding: '3px 8px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 4, color: '#34d399' }}>{m}</span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {ollamaTerminalOpen && (
                                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                                          Terminal
                                          {ollamaTerminalBusy
                                            ? <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f59e0b', display: 'inline-block', animation: 'blink 1s infinite' }} />Running</span>
                                            : <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block' }} />Done</span>
                                          }
                                        </span>
                                        <button onClick={() => { setOllamaTerminalOpen(false); setOllamaTerminalLog([]); }}
                                          disabled={ollamaTerminalBusy}
                                          style={{ background: 'none', border: 'none', color: ollamaTerminalBusy ? 'var(--border-color)' : 'var(--text-muted)', cursor: ollamaTerminalBusy ? 'not-allowed' : 'pointer', fontSize: 14 }}>✕</button>
                                      </div>
                                      <OllamaTerminal lines={ollamaTerminalLog} />
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            // Generic local custom provider card
                            return (
                              <div key={prov} style={{ padding: '16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px', marginBottom: 12 }}>{p.name || 'Local Provider'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Local provider — configure endpoint and models as needed.</div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* MODELS CONTENT */}
                {settingsSection === 'models' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                      {/* ── CLOUD MODELS LABEL ── */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>☁ Cloud</span>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border-color)' }} />
                      </div>

                      {getOrderedProviders().filter(p => p !== 'ollama' && !mergedProviders[p]?.local).map(prov => {
                        const p = mergedProviders[prov];
                        const keyVal = apiKeys[prov] || "";
                        
                        const deriveModelTags = (m, pId) => {
                          const tags = [];
                          const isLocal = pId === "ollama" || pId === "lmstudio" || pId === "local";
                          if (m.isFree) {
                            if (!isLocal && m.tokensRemainingLevel < 4) tags.push("FREEMIUM");
                            else tags.push("FREE");
                          }
                          else tags.push("PAID");
                          
                          if (pId === "ollama" || pId === "lmstudio" || pId === "local") tags.push("LOCAL");
                          if (pId === "ollama") tags.push("OFFLINE");

                          const mid = m.id.toLowerCase();
                          if (mid.includes('vision') || mid.includes('vl') || mid.includes('multimodal')) tags.push("VISION");
                          if (mid.includes('audio') || mid.includes('voice')) tags.push("VOICE");
                          if (mid.includes('coder') || mid.includes('code') || mid.includes('qwen2.5-coder')) tags.push("CODING");
                          if (mid.includes('think') || mid.includes('reasoning') || mid.includes('r1') || mid.includes('o1') || mid.includes('o3')) tags.push("REASONING");
                          if (mid.includes('flash') || mid.includes('mini') || mid.includes('haiku') || mid.includes('8b') || mid.includes('7b') || mid.includes('3b') || mid.includes('1.5b')) tags.push("FAST");
                          if (mid.includes('pro') || mid.includes('max') || mid.includes('opus') || mid.includes('large') || mid.includes('70b') || mid.includes('405b') || mid.includes('sonnet')) tags.push("SMART");
                          
                          return [...new Set(tags)];
                        };

                        const deriveModelStatus = (m, pId) => {
                          if (pId === "ollama") {
                            if (ollamaOk === false) return { label: "OFFLINE", color: "#6b7280", tooltip: "Ollama is not running" };
                            const launcherPrefixes = ['claude-code', 'codex', 'codex-openai'];
                            const idParts = m.id.split(':');
                            const isLauncher = launcherPrefixes.includes(idParts[0]);
                            const underlyingId = isLauncher ? idParts.slice(1).join(':') : m.id;
                            const isInstalled = ollamaModels.some(om =>
                              om === m.id || om === m.id + ":latest" || om.startsWith(m.id + ':') ||
                              om === underlyingId || om === underlyingId + ":latest" || om.startsWith(underlyingId + ':')
                            );
                            if (isInstalled) return { label: "INSTALLED", color: "#10b981", tooltip: "Downloaded and ready" };
                            return { label: "NOT INSTALLED", color: "#f59e0b", tooltip: "Available but not downloaded" };
                          }
                          
                          const kStatus = keyStatus[pId];
                          const hasKey = !!apiKeys[pId];
                          if (!hasKey && !p.noKey) return { label: "NOT CONNECTED", color: "#6b7280", tooltip: "No API key configured" };
                          if (kStatus === 'invalid') return { label: "UNAVAILABLE", color: "#ef4444", tooltip: "Invalid API key" };
                          if (!m.isAvailable) return { label: "UNAVAILABLE", color: "#ef4444", tooltip: "Model unavailable or access denied" };
                          
                          if (m.isFree && m.tokensRemainingLevel === 0) return { label: "UNAVAILABLE", color: "#f59e0b", tooltip: "Free tier quota reached" };
                          if (!m.isFree && m.tokensRemainingLevel === 0) return { label: "NEED SUBSCRIPTION", color: "#f59e0b", tooltip: "Paid credits required" };
                          
                          return { label: "AVAILABLE", color: "#10b981", tooltip: "Fully usable" };
                        };

                        const currentSearch = availableSearch[prov] || "";
                        const currentSort = availableSort[prov] || "all";
                        const installed = p.models.filter(m => m.isActive);
                        const available = p.models.filter(m => !m.isActive).filter(m => {
                          if (currentSearch && !m.name.toLowerCase().includes(currentSearch.toLowerCase()) && !m.id.toLowerCase().includes(currentSearch.toLowerCase())) return false;
                          
                          const tags = deriveModelTags(m, prov);
                          
                          if (currentSort === "free" && !tags.includes("FREE")) return false;
                          if (currentSort === "paid" && !tags.includes("PAID")) return false;
                          if (currentSort === "local" && !tags.includes("LOCAL")) return false;
                          if (currentSort === "coding" && !tags.includes("CODING")) return false;
                          if (currentSort === "vision" && !tags.includes("VISION")) return false;
                          if (currentSort === "voice" && !tags.includes("VOICE")) return false;
                          if (currentSort === "active") {
                            const status = deriveModelStatus(m, prov);
                            if (status.label !== "ACTIVE" && status.label !== "INSTALLED") return false;
                          }
                          
                          return true;
                        });

                        const handleFetchModels = async () => {
                          if (isKeyValid(keyVal)) {
                            await fetchProviderModels(prov, keyVal, p.customUrl);
                          } else {
                            alert("Please enter a valid API key first.");
                          }
                        };

                        const handleInstallAll = () => {
                          if (available.length === 0) return;
                          const availableIds = new Set(available.map(m => m.id));
                          const newModels = p.models.map(m => availableIds.has(m.id) ? { ...m, isActive: true } : m);
                          updateCustomProvider(prov, 'models', newModels);
                        };

                        const handleInstallDefaultModels = () => {
                          if (!p.noKey && !isKeyValid(keyVal)) {
                            alert("Please enter a valid API key first.");
                            return;
                          }
                          if (!p.noKey && apiStatus.state === 'error' && prov === pid) {
                            alert("Cannot install models — API is not connected. Check your API key.");
                            return;
                          }
                          const defaultModels = getDefaultModelsForProvider(prov, p);
                          if (defaultModels.length === 0) {
                            alert("No default models known for this provider.");
                            return;
                          }
                          const existing = p.models || [];
                          const defaultIds = new Set(defaultModels.map(m => m.id));
                          // Mark defaults as active, preserve existing non-default models
                          const activatedDefaults = defaultModels.map(m => {
                            const ex = existing.find(e => e.id === m.id);
                            return ex
                              ? { ...ex, isActive: true, isAvailable: true }
                              : { ...m, isActive: true, isAvailable: true, tokensRemainingLevel: 4 };
                          });
                          const rest = existing.filter(m => !defaultIds.has(m.id));
                          updateCustomProvider(prov, 'models', [...activatedDefaults, ...rest]);
                        };

                        const handleUninstallAll = () => {
                          const newModels = p.models.map(m => ({ ...m, isActive: false }));
                          updateCustomProvider(prov, 'models', newModels);
                        };

                        const ModelItem = ({ m }) => {
                          const status = deriveModelStatus(m, prov);
                          const tags = deriveModelTags(m, prov);
                          return (
                            <div key={m.id} style={{ padding: 12, backgroundColor: 'var(--bg-hover)', borderRadius: 6, border: '1px solid var(--border-color)', marginBottom: 8 }}>
                              {editingModelId === m.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  <input
                                    value={m.name}
                                    onChange={(e) => handleUpdateModel(prov, { ...m, name: e.target.value })}
                                    className="modern-input"
                                    style={{ padding: '4px 8px', fontSize: 13 }}
                                  />
                                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <input type="checkbox" checked={m.isFree} onChange={(e) => handleUpdateModel(prov, { ...m, isFree: e.target.checked })} /> Free
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <input type="checkbox" checked={m.isActive} onChange={(e) => handleUpdateModel(prov, { ...m, isActive: e.target.checked })} /> Active
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <input type="checkbox" checked={m.isAvailable} onChange={(e) => handleUpdateModel(prov, { ...m, isAvailable: e.target.checked })} /> Available
                                    </label>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                                    Tokens: <TokenBars level={m.tokensRemainingLevel} onChange={(lvl) => handleUpdateModel(prov, { ...m, tokensRemainingLevel: lvl })} />
                                  </div>
                                  <button onClick={() => setEditingModelId(null)} className="modern-btn primary" style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 11, marginTop: 8 }}>Save</button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{m.name}</div>
                                      {(() => {
                                        let tag = m.isFree ? 'FREE' : 'PAID';
                                        if (m.isFree && m.tokensRemainingLevel < 4 && prov !== 'ollama') tag = 'FREEMIUM';
                                        let tColor = tag === 'PAID' ? '#f59e0b' : '#10b981';
                                        return (
                                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 12, color: tColor, backgroundColor: `${tColor}15`, border: `1px solid ${tColor}40`, letterSpacing: '0.02em' }}>
                                            {tag}
                                          </span>
                                        );
                                      })()}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.id}</div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {status.label !== 'AVAILABLE' && (
                                      <div
                                        title={status.tooltip}
                                        style={{
                                          fontSize: 10,
                                          fontWeight: 700,
                                          color: status.color,
                                          backgroundColor: `${status.color}18`,
                                          padding: '2px 8px',
                                          borderRadius: 12,
                                          border: `1px solid ${status.color}40`,
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        {status.label}
                                      </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 4 }}>
                                      {!m.isActive && (
                                        <button onClick={() => handleUpdateModel(prov, { ...m, isActive: true })} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', padding: 4 }} title="Install">
                                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                        </button>
                                      )}
                                      <button onClick={() => handleUpdateModel(prov, { ...m, isActive: false })} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }} title="Uninstall">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        };

                        return (
                          <div key={prov} style={{ padding: '16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                            {/* Provider header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{p.name || prov}</div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={handleUninstallAll} className="modern-btn" style={{ padding: '5px 10px', fontSize: 11, color: '#ef4444' }}>Uninstall All</button>
                                <button onClick={handleInstallDefaultModels} className="modern-btn primary" style={{ padding: '5px 10px', fontSize: 11 }}>Install Default Models</button>
                                <button onClick={handleInstallAll} className="modern-btn primary" style={{ padding: '5px 10px', fontSize: 11 }}>Install All</button>
                              </div>
                            </div>

                            {/* Installed Models */}
                            <div style={{ marginBottom: 12 }}>
                              <div
                                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 0', userSelect: 'none' }}
                                onClick={() => setSectionOpen(prev => ({ ...prev, [`${prov}-installed`]: !prev[`${prov}-installed`] }))}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: sectionOpen[`${prov}-installed`] ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.18s', color: 'var(--text-muted)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Installed ({installed.length})</div>
                              </div>
                              {sectionOpen[`${prov}-installed`] && (
                                installed.length > 0 ? (
                                  <div style={{ maxHeight: 230, overflowY: 'auto', paddingRight: 4, marginTop: 6 }}>
                                    {installed.map(m => <ModelItem key={m.id} m={m} />)}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                                    No models installed.{' '}
                                    <span
                                      onClick={handleInstallDefaultModels}
                                      style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontStyle: 'normal' }}
                                    >Install defaults</span>
                                  </div>
                                )
                              )}
                            </div>

                            {/* Available Models */}
                            <div>
                              <div
                                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 0', userSelect: 'none' }}
                                onClick={() => setSectionOpen(prev => ({ ...prev, [`${prov}-available`]: !prev[`${prov}-available`] }))}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: sectionOpen[`${prov}-available`] ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.18s', color: 'var(--text-muted)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Available ({available.length})</div>
                                {sectionOpen[`${prov}-available`] && (
                                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
                                    <input
                                      value={availableSearch[prov] || ""}
                                      onChange={(e) => setAvailableSearch(prev => ({ ...prev, [prov]: e.target.value }))}
                                      placeholder="Search..."
                                      className="modern-input"
                                      style={{ padding: '3px 7px', fontSize: 11, width: 120 }}
                                    />
                                    <select value={availableSort[prov] || "all"} onChange={(e) => setAvailableSort(prev => ({ ...prev, [prov]: e.target.value }))} className="modern-select" style={{ padding: '3px 20px 3px 7px', fontSize: 11 }}>
                                      <option value="all">All</option>
                                      <option value="active">Active/Usable</option>
                                      <option value="local">Local</option>
                                      <option value="free">Free</option>
                                      <option value="paid">Paid</option>
                                      <option value="coding">Coding</option>
                                      <option value="vision">Vision</option>
                                      <option value="voice">Voice</option>
                                    </select>
                                    <button onClick={handleFetchModels} disabled={keyStatus[prov] === 'fetching' || keyStatus[prov] === 'synced'} className="modern-btn" style={{ padding: '3px 7px', fontSize: 11, backgroundColor: 'var(--bg-hover)', display: 'flex', alignItems: 'center', gap: 4, opacity: (keyStatus[prov] === 'fetching' || keyStatus[prov] === 'synced') ? 0.5 : 1, cursor: (keyStatus[prov] === 'fetching' || keyStatus[prov] === 'synced') ? 'not-allowed' : 'pointer' }}>
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: keyStatus[prov] === 'fetching' ? 'spin 1s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                      {keyStatus[prov] === 'fetching' ? 'Syncing...' : keyStatus[prov] === 'synced' ? 'Synced' : 'Sync'}
                                    </button>
                                  </div>
                                )}
                              </div>
                              {sectionOpen[`${prov}-available`] && (
                                <div style={{ maxHeight: 230, overflowY: 'auto', paddingRight: 4, marginTop: 6 }}>
                                  {available.length > 0 ? available.map(m => <ModelItem key={m.id} m={m} />) : (
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>No available models.</div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* ── LOCAL MODELS LABEL ── */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>⬡ Local</span>
                        <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border-color)' }} />
                      </div>

                      {/* Ollama models */}
                      {ollamaModels.length > 0 ? (
                        <div style={{ padding: '16px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{ fontSize: 16 }}>🦙</span>
                            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>Ollama</span>
                            <div className={`status-dot ${ollamaOk === true ? 'green' : 'red'}`} style={{ marginLeft: 'auto' }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ollamaOk === true ? 'Running' : 'Stopped'}</span>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {ollamaModels.map(m => (
                              <span key={m} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 4, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                                {m}
                              </span>
                            ))}
                          </div>
                          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                            To add more models, go to <strong style={{ color: 'var(--text-secondary)' }}>Providers → Ollama → Pull a Model</strong>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '16px', backgroundColor: 'var(--bg-primary)', border: '1px dashed var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 24, marginBottom: 8 }}>🦙</div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No local models installed.</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Go to <strong style={{ color: 'var(--text-secondary)' }}>Providers → Ollama</strong> to install and pull models.</div>
                        </div>
                      )}

                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}


