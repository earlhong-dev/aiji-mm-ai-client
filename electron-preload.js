const { contextBridge, ipcRenderer } = require('electron');

// Persistent log callback
let _logCb = null;
const _logQueue = [];

// Register listener once at module load
ipcRenderer.on('ollama-log', (_, msg) => {
  if (_logCb) {
    _logCb(msg);
  } else {
    _logQueue.push(msg);
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  validateKey:         (provId, keyValue, customUrl) => ipcRenderer.invoke('validate-key', { provId, keyValue, customUrl }),
  chatCompletion:      (pid, url, headers, body)     => ipcRenderer.invoke('chat-completion', { pid, url, headers, body }),
  checkOllama:         ()                            => ipcRenderer.invoke('check-ollama'),
  getOllamaModels:     ()                            => ipcRenderer.invoke('ollama-get-models'),
  startOllama:         ()                            => ipcRenderer.invoke('ollama-start'),
  stopOllama:          ()                            => ipcRenderer.invoke('ollama-stop'),
  ollamaInstall:       ()                            => ipcRenderer.invoke('ollama-install'),
  ollamaPullModel:     (model)                       => ipcRenderer.invoke('ollama-pull-model', { model }),
  ollamaApi:           (data)                        => ipcRenderer.invoke('ollama-api', data),
  checkLaunchers:      ()                            => ipcRenderer.invoke('check-launchers'),
  launcherApi:         (data)                        => ipcRenderer.invoke('launcher-api', data),
  launchClaudeTerminal:(data)                        => ipcRenderer.invoke('launch-claude-terminal', data),

  // Persistent storage
  storageGet:          (key)        => ipcRenderer.invoke('storage-get', key),
  storageSet:          (key, value) => ipcRenderer.invoke('storage-set', key, value),
  storageGetPath:      ()           => ipcRenderer.invoke('storage-get-path'),

  // Register callback
  onOllamaLog: (cb) => {
    _logCb = cb;
    while (_logQueue.length > 0) {
      cb(_logQueue.shift());
    }
    return () => { _logCb = null; };
  },
});
