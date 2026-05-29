# ✨ Aiji — Multi-Model AI Client

<div align="center">

<img src="build/icon.ico" alt="Aiji Logo" width="120" height="120">

![Version](https://img.shields.io/badge/version-1.0.0-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Built with](https://img.shields.io/badge/built%20with-Electron%20%2B%20React-black?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-9cf?style=flat-square)

A **modern, open-source AI client** that lets you seamlessly switch between multiple AI providers—all in one elegant desktop application.

[🚀 Quick Start](#-quick-start) • [📖 Features](#-features) • [🔧 Configuration](#-configuration) • [❓ FAQ](#-faq)

</div>

---

## 🎯 About

**Aiji** is a desktop application that unifies access to cutting-edge AI models from multiple providers. No vendor lock-in, no subscriptions needed for offline models—just pick your AI and start chatting.

Whether you want cutting-edge cloud models or privacy-focused offline AI, Aiji has you covered.

---

## ✨ Features

- 🔄 **Multi-Provider Support** — Switch between Gemini, Groq, OpenRouter, and Ollama with one click
- 🚀 **Zero Setup Offline Mode** — Run Ollama locally with no API keys required
- ⚡ **Lightning-Fast Inference** — Optimized for responsive conversations
- 🎨 **Modern, Intuitive UI** — Clean interface with markdown rendering
- 💾 **Conversation History** — Keep track of your chats
- 🔐 **Privacy First** — Full offline support with Ollama, or use your own API keys
- 📱 **Cross-Platform** — Windows, macOS, and Linux support

---

## 🚀 Quick Start

### 1️⃣ **Download & Install**

Download the latest installer from the [Releases](releases/) section:
- **Windows**: `Aiji Setup 1.0.0.exe`
- **macOS/Linux**: Coming soon

### 2️⃣ **Choose Your Provider**

#### Option A: Free Cloud Models (Requires API Key)
- **Groq** (5000+ tokens/min free) — [Get API Key](https://console.groq.com)
- **Google Gemini** (2M context tokens) — [Get API Key](https://aistudio.google.com/apikey)
- **OpenRouter** (100+ models) — [Get API Key](https://openrouter.ai/keys)

#### Option B: Run Offline (100% Free)
```bash
# Install Ollama
# https://ollama.com/download

# Pull a model
ollama pull llama3.2
ollama pull mistral

# Ollama runs on http://localhost:11434
# Select "Ollama (Offline)" in Aiji and you're good to go!
```

### 3️⃣ **Start Chatting**

1. Launch Aiji
2. Select your preferred AI provider
3. Choose a model
4. Start your conversation!

---

## 🔌 Supported Providers

| Provider | Best For | Setup | Cost |
|----------|----------|-------|------|
| **Ollama** | Privacy, offline use | Local install | Free |
| **Groq** | Speed, free tier | API key | Free tier available |
| **Google Gemini** | Long context, quality | API key | Free tier available |
| **OpenRouter** | Model variety | API key | Mixed (free & paid) |

### Popular Models

**Ollama (Offline - Free)**
- Llama 3.2 (12B)
- Mistral 7B
- Neural Chat

**Groq (Fast & Free)**
- Llama 3.3 70B
- GPT-4 Open Source 120B
- Qwen3 32B

**Google Gemini (Long Context)**
- Gemini 2.5 Flash (1M tokens)
- Gemini 2.5 Pro (2M tokens)

**OpenRouter (100+ Models)**
- DeepSeek V4 Flash
- Qwen3 235B
- Claude 3 Opus

---

## ⚙️ Configuration

### Adding API Keys

1. **Go to Settings** (gear icon in-app)
2. **Select Your Provider**
3. **Paste Your API Key**
4. **Save & Test Connection**

### Managing Models

- Models auto-populate from your API keys
- For Ollama, ensure it's running locally at `http://localhost:11434`
- Customize model lists in settings

### Environment Setup

Create a `.env` file in the project root (for development):

```env
VITE_API_KEY_GEMINI=your_gemini_key_here
VITE_API_KEY_GROQ=your_groq_key_here
VITE_API_KEY_OPENROUTER=your_openrouter_key_here
```

---

## 🛠️ Development

### Prerequisites
- **Node.js** 18+ 
- **npm** or **yarn**
- **Ollama** (optional, for offline testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-repo/aiji.git
cd aiji

# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build the app
npm run electron:build
```

### Project Structure

```
aiji/
├── ai-tool.jsx           # Main React component
├── electron-main.js      # Electron main process
├── electron-preload.js   # IPC preload script
├── electron-builder.js   # Build configuration
├── vite.config.js        # Vite configuration
├── package.json          # Dependencies
└── build/                # Built assets
```

### Available Scripts

```bash
npm run dev              # Start Vite dev server
npm run build            # Build frontend assets
npm run preview          # Preview production build
npm run electron:dev     # Run Electron in dev mode
npm run electron:build   # Build packaged app
npm run package          # Build and package (Windows installer)
```

---

## 🔧 Troubleshooting

### **429 Rate Limit Error**

**Problem**: `Error: 429 Rate Limit - model is temporarily rate-limited`

**Solution**:
1. Switch to a different model (free tier has lower limits)
2. Wait 1-2 minutes and try again
3. Upgrade to a paid API key for higher limits
4. Use Ollama for unlimited offline access

### **404 Model Not Found**

**Problem**: `Error: 404 - No endpoints found for [model]`

**Solution**:
1. Verify the model exists on the provider's website
2. Check model ID spelling (case-sensitive)
3. Ensure your API key is valid
4. Try a different model from the provider

### **Connection Refused (Ollama)**

**Problem**: `Error: Connection refused - localhost:11434`

**Solution**:
```bash
# Make sure Ollama is running
ollama serve

# Or restart Ollama
# macOS: brew services restart ollama
# Linux: sudo systemctl restart ollama
```

### **Blank Screen on Launch**

**Solution**:
1. Check DevTools: `Ctrl+Shift+I`
2. Clear cache: `npm run build`
3. Reinstall dependencies: `rm -rf node_modules && npm install`

---

## 🔐 Privacy & Security

- **Offline Mode**: All data stays local when using Ollama
- **API Keys**: Stored locally, never sent to Aiji servers (we have none!)
- **No Telemetry**: Zero tracking or data collection
- **Open Source**: Code is transparent and auditable

---

## 📊 Tech Stack

- **Frontend**: React 18.3 + Vite
- **Desktop**: Electron 42.2
- **Styling**: Modern CSS with React
- **Markdown**: react-markdown + remark-gfm
- **Build**: electron-builder

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the **MIT License** — see the LICENSE file for details.

---

## 💬 Support

- 📧 **Questions?** Open an issue on GitHub
- 🐛 **Found a bug?** Report it with detailed steps to reproduce
- 💡 **Feature request?** We'd love to hear your ideas!

---

<div align="center">

**Made with ❤️ by Earl**

[⬆ Back to Top](#-aiji--multi-model-ai-client)

</div>
