# Verification Checklist

Before building, verify these features still work:

## Core Chat Features
- [ ] Send a message to any provider
- [ ] Receive AI response
- [ ] Input auto-focuses after response
- [ ] Stop button works during generation
- [ ] Stop quips display correctly

## Chat Management
- [ ] Start new chat
- [ ] Switch between chats
- [ ] Archive chat
- [ ] Restore from archive
- [ ] Delete to trash
- [ ] Restore from trash
- [ ] Permanent delete
- [ ] Share chat (copy to clipboard)

## Provider Management
- [ ] Switch providers from dropdown
- [ ] Edit Providers button opens modal
- [ ] Add custom provider
- [ ] Install default models
- [ ] Edit provider name/URL
- [ ] Delete provider
- [ ] Drag to reorder providers
- [ ] API key validation on save

## Model Management
- [ ] Switch models from dropdown
- [ ] Toggle model active/inactive
- [ ] Edit model name
- [ ] Token quota bars display
- [ ] Free/paid badges show correctly

## Ollama Features
- [ ] Check Ollama status
- [ ] Start Ollama serve
- [ ] Stop Ollama serve
- [ ] Pull model
- [ ] Install Ollama (if not installed)
- [ ] Terminal log displays
- [ ] Direct Ollama models work
- [ ] Codex launcher works (if installed)
- [ ] Claude Code launcher works (if installed)

## File Attachment
- [ ] Open folder picker
- [ ] Browse file tree
- [ ] Attach files
- [ ] Detach files
- [ ] Attached files sent with message
- [ ] Folder name shows in topbar

## Settings
- [ ] Open settings modal
- [ ] Toggle dark mode
- [ ] Edit system prompt
- [ ] System prompt saves
- [ ] Settings close animation works

## UI/UX
- [ ] Sidebar tabs (Chats/Archive/Trash) work
- [ ] Chat menu (3 dots) opens
- [ ] Scroll to bottom button appears
- [ ] API status indicator updates
- [ ] Provider status dots (green/red/yellow)
- [ ] Loading spinner during generation
- [ ] Error messages display
- [ ] Markdown renders correctly
- [ ] Code blocks have copy/save buttons

## Build Test
```bash
npm run package
```

Expected output:
- Single NSIS installer in `release/` folder
- Size: ~80-120 MB (down from 1.2GB)
- No portable build
- Maximum compression applied

## Installation Test
1. Run the installer
2. Launch the app
3. Test core features above
4. Check app data location: `%APPDATA%\Aiji\storage.json`
5. Verify uninstall removes app data

## Performance
- [ ] App launches quickly
- [ ] No console errors
- [ ] Smooth animations
- [ ] Fast provider switching
- [ ] Fast model switching
