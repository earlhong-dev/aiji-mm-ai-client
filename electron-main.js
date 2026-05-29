const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

let mainWindow;
let ollamaServeProc = null;
let logTailInterval = null;
let logFilePos = 0;

// Persistent storage
let _storageCache = null;

function getStoragePath() {
  const dir = path.join(app.getPath('userData'), 'Aiji');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'storage.json');
}

function loadStorage() {
  if (_storageCache) return _storageCache;
  try {
    const raw = fs.readFileSync(getStoragePath(), 'utf8');
    _storageCache = JSON.parse(raw);
  } catch {
    _storageCache = {};
  }
  return _storageCache;
}

function saveStorage() {
  try {
    fs.writeFileSync(getStoragePath(), JSON.stringify(_storageCache), 'utf8');
  } catch (e) {
    console.error('Storage write error:', e.message);
  }
}

ipcMain.handle('storage-get', (_, key) => {
  const store = loadStorage();
  return store[key] !== undefined ? store[key] : null;
});

ipcMain.handle('storage-set', (_, key, value) => {
  const store = loadStorage();
  if (value === null || value === undefined) {
    delete store[key];
  } else {
    store[key] = value;
  }
  saveStorage();
  return true;
});

// Send to renderer
function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
function log(line) { send('ollama-log', line); }

// Ollama log file path
function getOllamaLogFile() {
  return path.join(os.homedir(), 'AppData', 'Local', 'Ollama', 'server.log');
}

// Tail log file
function startLogTail(showExisting) {
  stopLogTail();
  const logFile = getOllamaLogFile();

  try {
    const stat = fs.statSync(logFile);
    if (showExisting) {
      // Show last 3 KB of existing content immediately
      logFilePos = Math.max(0, stat.size - 3072);
      if (logFilePos < stat.size) {
        const fd = fs.openSync(logFile, 'r');
        const len = stat.size - logFilePos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, logFilePos);
        fs.closeSync(fd);
        logFilePos = stat.size;
        log(buf.toString('utf8'));
      }
    } else {
      // Start from current end — only show new lines
      logFilePos = stat.size;
    }
  } catch {
    logFilePos = 0;
  }

  // Poll every 300ms for new content
  logTailInterval = setInterval(() => {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size > logFilePos) {
        const fd = fs.openSync(logFile, 'r');
        const len = stat.size - logFilePos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, logFilePos);
        fs.closeSync(fd);
        logFilePos = stat.size;
        const text = buf.toString('utf8');
        if (text.trim()) log(text);
      }
    } catch { }
  }, 300);
}

function stopLogTail() {
  if (logTailInterval) {
    clearInterval(logTailInterval);
    logTailInterval = null;
  }
}

// Find ollama.exe
function findOllama() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
    'C:\\Program Files (x86)\\Ollama\\ollama.exe',
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { }
  }
  try {
    const r = spawnSync('where', ['ollama'], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout) {
      const p = r.stdout.trim().split(/\r?\n/)[0].trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch { }
  return null;
}

// HTTP health check
async function isOllamaRunning() {
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 2000);
    const r = await fetch('http://localhost:11434/', { signal: c.signal });
    return r.ok || r.status === 404;
  } catch { return false; }
}

// Disk model scan
function getInstalledModels() {
  const base = path.join(os.homedir(), '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library');
  if (!fs.existsSync(base)) return [];
  const models = [];
  try {
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const tag of fs.readdirSync(dir))
        models.push(tag === 'latest' ? name : `${name}:${tag}`);
    }
  } catch { }
  return models.sort();
}

// Kill all ollama processes
function killOllama() {
  stopLogTail();
  if (ollamaServeProc) {
    try { ollamaServeProc.kill('SIGTERM'); } catch { }
    try { ollamaServeProc.kill('SIGKILL'); } catch { }
    ollamaServeProc = null;
  }
  try { spawnSync('taskkill', ['/F', '/IM', 'ollama.exe', '/T'], { timeout: 5000 }); } catch { }
}

// Silent start (app launch)
async function startOllamaSilent() {
  if (await isOllamaRunning()) return { alreadyRunning: true };
  const bin = findOllama();
  if (!bin) return { notFound: true };
  const p = spawn(bin, ['serve'], {
    detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...process.env },
  });
  p.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isOllamaRunning()) return { started: true };
  }
  return { started: false };
}

// Window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const idx = path.join(__dirname, 'dist', 'index.html');
    fs.existsSync(idx)
      ? mainWindow.loadFile(idx)
      : mainWindow.loadURL('data:text/html,<h1>Run npm run build first</h1>');
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startOllamaSilent().catch(console.error);
  createWindow();
});
app.on('window-all-closed', () => {
  killOllama();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});

// IPC handlers
ipcMain.handle('storage-get-path', () => getStoragePath());

ipcMain.handle('check-ollama', async () => {
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 5000);
    const r = await fetch('http://localhost:11434/api/tags', { signal: c.signal });
    if (!r.ok) throw new Error();
    const d = await r.json();
    return { running: true, models: (d.models || []).map(m => m.name) };
  } catch {
    return { running: false, models: getInstalledModels() };
  }
});

ipcMain.handle('ollama-get-models', async () => {
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 3000);
    const r = await fetch('http://localhost:11434/api/tags', { signal: c.signal });
    if (r.ok) return (await r.json()).models.map(m => m.name);
  } catch { }
  return getInstalledModels();
});

ipcMain.handle('ollama-start', async () => {
  const bin = findOllama();
  const logFile = getOllamaLogFile();

  log(`> ollama serve\n`);
  log(`[binary] ${bin || 'NOT FOUND'}\n`);
  log(`[logfile] ${logFile}\n`);

  if (!bin) {
    log('ERROR: ollama.exe not found. Install from https://ollama.com/download\n');
    return { notFound: true };
  }

  // If already running, just show the live log
  if (await isOllamaRunning()) {
    log('Ollama is already running on http://localhost:11434\n');
    log('Showing live server log:\n\n');
    startLogTail(true); // show existing + new lines
    return { alreadyRunning: true };
  }

  // Kill any stale process
  if (ollamaServeProc) {
    try { ollamaServeProc.kill(); } catch { }
    ollamaServeProc = null;
    await new Promise(r => setTimeout(r, 300));
  }

  log('Spawning ollama serve...\n');

  // Start tailing BEFORE spawn so we catch startup lines
  startLogTail(false);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (r) => { if (!resolved) { resolved = true; resolve(r); } };

    ollamaServeProc = spawn(bin, ['serve'], {
      detached: false,
      windowsHide: true,
      stdio: 'ignore', // ollama writes to log file, not stdio
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_ORIGINS: '*' },
    });

    log(`[pid] ${ollamaServeProc.pid}\n`);

    ollamaServeProc.on('error', (e) => {
      log(`ERROR spawning: ${e.message}\n`);
      stopLogTail();
      done({ error: e.message });
    });

    ollamaServeProc.on('close', (code) => {
      log(`\n[process exited code=${code}]\n`);
      ollamaServeProc = null;
      stopLogTail();
      done({ exited: true, code });
    });

    // Poll HTTP until ready
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (await isOllamaRunning()) {
        clearInterval(poll);
        log('\n✓ Ollama ready on http://localhost:11434\n');
        done({ started: true });
      } else if (attempts >= 40) {
        clearInterval(poll);
        log('\n⚠ Timed out after 20s\n');
        done({ started: false, timeout: true });
      }
    }, 500);
  });
});

ipcMain.handle('ollama-stop', async () => {
  stopLogTail();
  log('> Stopping Ollama...\n');

  if (ollamaServeProc) {
    log(`[kill] managed PID ${ollamaServeProc.pid}\n`);
    try { ollamaServeProc.kill('SIGTERM'); } catch { }
    ollamaServeProc = null;
  }

  // Kill the tray app process too
  log('> taskkill /F /IM ollama.exe /T\n');
  const tk = spawnSync('taskkill', ['/F', '/IM', 'ollama.exe', '/T'], {
    encoding: 'utf8', timeout: 6000,
  });
  const out = ((tk.stdout || '') + (tk.stderr || '')).trim();
  if (out) log(out + '\n');

  await new Promise(r => setTimeout(r, 1500));
  const stillUp = await isOllamaRunning();
  log(stillUp ? '⚠ Still responding (external process?)\n' : '✓ Ollama stopped.\n');

  return { stopped: !stillUp };
});

ipcMain.handle('ollama-pull-model', async (_, { model }) => {
  const bin = findOllama();
  if (!bin) { log('ERROR: Ollama not found.\n'); return { error: 'not installed' }; }

  if (!await isOllamaRunning()) {
    log('Starting Ollama first...\n');
    await startOllamaSilent();
    await new Promise(r => setTimeout(r, 2000));
    if (!await isOllamaRunning()) { log('ERROR: Could not start Ollama.\n'); return { error: 'not running' }; }
  }

  log(`> ollama pull ${model}\n`);

  return new Promise((resolve) => {
    const proc = spawn(bin, ['pull', model], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => log(d));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', d => log(d));
    proc.on('close', code => {
      log(code === 0 ? `\n✓ "${model}" ready!\n` : `\n✗ Pull failed (exit ${code})\n`);
      resolve({ code });
    });
    proc.on('error', e => { log(`ERROR: ${e.message}\n`); resolve({ error: e.message }); });
  });
});

ipcMain.handle('ollama-install', async () => {
  if (findOllama()) { log('✓ Ollama already installed.\n'); return { alreadyInstalled: true }; }

  log('Downloading OllamaSetup.exe...\n');
  const installerPath = path.join(os.tmpdir(), 'OllamaSetup.exe');

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(installerPath);
    let downloaded = 0;
    const download = (url, hops = 0) => {
      if (hops > 10) { reject(new Error('Too many redirects')); return; }
      https.get(url, res => {
        if (res.statusCode === 301 || res.statusCode === 302) { download(res.headers.location, hops + 1); return; }
        res.on('data', chunk => { downloaded += chunk.length; log(`  ${(downloaded / 1024 / 1024).toFixed(1)} MB...\r`); });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', e => { fs.unlink(installerPath, () => {}); reject(e); });
    };
    download('https://ollama.com/download/OllamaSetup.exe');
  });

  log('\nRunning installer...\n');
  return new Promise((resolve) => {
    const proc = spawn(installerPath, ['/S'], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8'); proc.stdout.on('data', d => log(d));
    proc.stderr.setEncoding('utf8'); proc.stderr.on('data', d => log(d));
    proc.on('close', async code => {
      if (code === 0) {
        log('✓ Installed!\n');
        await startOllamaSilent();
        log(await isOllamaRunning() ? '✓ Running.\n' : '⚠ Use Start Serve.\n');
        resolve({ installed: true });
      } else { log(`✗ Failed (exit ${code})\n`); resolve({ error: `exit ${code}` }); }
    });
    proc.on('error', e => { log(`ERROR: ${e.message}\n`); resolve({ error: e.message }); });
  });
});

ipcMain.handle('ollama-api', async (_, { model, messages, systemPrompt }) => {
  if (!await isOllamaRunning()) {
    const r = await startOllamaSilent();
    if (r.notFound) throw new Error('Ollama not installed. Download from ollama.com/download');
    if (!await isOllamaRunning()) throw new Error('Ollama failed to start. Use Start Serve in Providers.');
  }
  const attempt = async (retry = 0) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 300000);
    try {
      const r = await fetch('http://localhost:11434/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal,
        body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))] }),
      });
      clearTimeout(t);
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        if (r.status === 404) throw new Error(`Model "${model}" not installed. Run: ollama pull ${model}`);
        throw new Error(`Ollama HTTP ${r.status}: ${body || r.statusText}`);
      }
      return (await r.json()).message.content;
    } catch (e) {
      clearTimeout(t);
      if (retry < 2 && (e.name === 'AbortError' || e.message.includes('fetch'))) {
        await new Promise(r => setTimeout(r, 1000)); return attempt(retry + 1);
      }
      throw e;
    }
  };
  return attempt();
});

ipcMain.handle('check-launchers', async () => {
  const check = cmd => { try { spawnSync(cmd, ['--version'], { timeout: 5000 }); return true; } catch { return false; } };
  return { codex: check('codex'), claudeCode: check('claude') };
});

ipcMain.handle('launch-claude-terminal', (_, { model }) => {
  spawn('cmd', ['/k', `claude --model ${model}`], { detached: true, windowsHide: false, stdio: 'ignore', shell: false }).unref();
  return { launched: true };
});

ipcMain.handle('launcher-api', async (_, { launcher, model, messages, systemPrompt }) => {
  if (!await isOllamaRunning()) {
    const r = await startOllamaSilent();
    if (r.notFound) throw new Error('Ollama not installed.');
    if (!await isOllamaRunning()) throw new Error('Ollama failed to start.');
  }
  if (launcher !== 'codex') throw new Error(`Unknown launcher: ${launcher}`);
  const history = messages.slice(0, -1).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
  const last = messages[messages.length - 1].content;
  const prompt = `${history ? history + '\n\n' : ''}${last}`;
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['--oss', '--local-provider', 'ollama', '-m', model, 'exec', '--skip-git-repo-check', '-'], {
      shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OLLAMA_API_BASE: 'http://localhost:11434' }, cwd: os.homedir(),
    });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); reject(new Error('Codex timed out.')); }, 300000);
    proc.stdin.write(prompt); proc.stdin.end();
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', () => {
      clearTimeout(timer); if (timedOut) return;
      const clean = out.replace(/^[\s\S]*?--------\n[\s\S]*?--------\n/m, '').trim();
      if (clean) resolve(clean); else if (err) reject(new Error(`Codex: ${err.trim()}`)); else reject(new Error('Codex returned no output.'));
    });
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Codex: ${e.message}`)); });
  });
});

ipcMain.handle('validate-key', async (_, { provId, keyValue, customUrl }) => {
  const sf = async (url, opts = {}) => {
    try {
      const c = new AbortController(); setTimeout(() => c.abort(), 10000);
      const r = await fetch(url, { ...opts, signal: c.signal });
      return { ok: r.ok, status: r.status, body: await r.text().catch(() => ''), blocked: false };
    } catch (e) { return { ok: false, status: 0, body: e.message, blocked: true }; }
  };
  const interp = ({ ok, status, body, blocked }) => {
    if (blocked) return { valid: null, msg: 'no connection (Network Error)' };
    if (ok) return { valid: true, msg: null };
    if (status === 429) return { valid: true, msg: null };
    if (status === 401 || status === 403) return { valid: false, msg: body.toLowerCase().includes('expir') ? 'Expired Key' : 'Invalid Key' };
    return { valid: null, msg: `Status ${status}` };
  };
  try {
    if (provId === 'gemini') return interp(await sf(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyValue}`));
    if (provId === 'groq') return interp(await sf('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${keyValue}` } }));
    if (provId === 'openrouter') {
      const r = interp(await sf('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${keyValue}`, 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'AI Tool' } }));
      if (r.valid !== null) return r;
      return interp(await sf('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${keyValue}` } }));
    }
    const ep = (customUrl || 'https://api.openai.com/v1/chat/completions').replace(/\/chat\/completions\/?$/, '/models');
    return interp(await sf(ep, { headers: { Authorization: `Bearer ${keyValue}` } }));
  } catch { return { valid: null, msg: 'Network Error' }; }
});

ipcMain.handle('chat-completion', async (_, { url, headers, body }) => {
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) { throw new Error('Network Error: ' + e.message); }
});
