# J.A.R.V.I.S. Assistant

A Windows desktop app based on your dashboard reference. It uses an Electron shell, a local Node.js server, and a browser interface. The app starts and stops its loopback-only local server automatically.

## Launch the desktop app

Install Node.js 18 or later, then from this folder run:

```powershell
npm install
npm run app
```

To build a Windows installer, run `npm run dist`; the installer is written to `release/`. To build the portable app folder without an installer, run `npx electron-builder --win dir` and launch `release/win-unpacked/J.A.R.V.I.S. Assistant.exe`. The app itself does not start with Windows.

## Configure

On first launch, the app creates a placeholder `.env` in its configuration folder (`%APPDATA%jarvis-assistant-starter`). Open **J.A.R.V.I.S. → Open configuration folder**, edit `.env`, then restart the app. For `npm run app` / `npm start` during development, a `.env` in this folder is read first.

A single Gemini key is enough for everything: chat, speech recognition, and spoken replies.

- `GEMINI_API_KEY` — key from Google AI Studio (https://aistudio.google.com/apikey).
- `GEMINI_MODEL` — chat model, default `gemini-3.8-flash`.
- `GEMINI_ASR_MODEL` — speech-to-text, default `gemini-3.5-transcribe` (falls back to the chat model).
- `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE` — spoken replies, default `gemini-3.8-flash-tts` with the `Charon` voice (others: Puck, Kore, Fenrir, Orus, Aoede…).
- `GEMINI_SEARCH` — `on` (default) lets Gemini use Google Search for weather, news, and other live facts.
- `LIVE_MODE` / `LIVE_MODEL` — real-time voice, `on` with `gemini-3.8-live` by default.
- `WAKE_WORD` — optional (record-then-reply mode only), e.g. `jarvis`. When set, hands-free only answers phrases that contain it.
- `VOICE_PROVIDER` — `auto` (default: Fish Audio when `FISH_API_KEY` is set, otherwise Gemini), `gemini`, or `fish`.
- `FISH_API_KEY`, `FISH_TTS_MODEL`, `FISH_VOICE_ID` — optional Fish Audio voice instead of Gemini.
- `PORT` — port for browser-only development (`npm start`); default `3000`.

Placeholder values such as `replace_with_your_gemini_key` are ignored.

## Live voice conversation

Click the mic once and allow microphone access. J.A.R.V.I.S. opens a real-time Gemini Live session (`LIVE_MODEL`, default `gemini-3.8-live`): just talk, and it answers out loud within about a second. You can interrupt it mid-sentence by speaking, type while live, or press **Esc** to cut the current reply. Both sides of the conversation are transcribed into the chat. Only detected speech is streamed (silence stays on this device), and Jarvis's own voice needs to be louder than normal speech to count as an interruption, so it doesn't talk over itself. The session reconnects on its own when Gemini rotates it. The mic preference is saved and resumes on next launch.

Set `LIVE_MODE=off` to use the older record → transcribe → reply → speak loop (also used with Fish Audio voices).

The centre of the HUD is a holographic head drawn on a canvas (`public/avatar.js`): it blinks, makes eye contact while listening, looks away while thinking, lip-syncs and nods to the reply audio, and is ringed by a live waveform. It recolours with the `--cyan` CSS variable.

## Greeting & daily briefing

When J.A.R.V.I.S. opens it greets you by name with the local time and weather (Open-Meteo, no key needed), then reads a short briefing: the top five headlines found through Gemini with Google Search, today's reminders, and anything notable about the PC (low battery, low disk space, high memory use). Headlines keep scrolling in the NEWS ticker under the greeting; click one to open its coverage, or click NEWS to hear the briefing again. The full headline read-out happens at most every 3 hours; other launches just get the greeting.

Set your name, home city, and optional news topics in Settings → Profile, or just tell J.A.R.V.I.S. ("call me Tony", "I live in Malibu", "I care about tech and markets"). Say "brief me" or "what's the weather in Paris?" at any time. Turn the startup greeting off with Settings → Greet me at startup.

## PC control, memory, reminders, plugins

J.A.R.V.I.S. can operate the PC from voice or typed chat:

- **Apps & web**: open any installed app, website, folder, file, or Windows Settings page; switch to or close windows.
- **System**: volume, mute, media play/pause/next, brightness, lock / sleep / restart / shut down / sign out, live CPU, memory, network, battery and disk stats, process list, PowerShell commands.
- **Keyboard & screen**: type text, press shortcuts, read or set the clipboard, and look at the screen to answer questions about it.
- **Files**: search, list, read (text, PDF, images), create, write, append, copy, move/rename, delete. Deleted files go to the Jarvis trash (Settings → Jarvis trash), and `undo_last_action` reverses the last file operation or volume change. System folders (Windows, Program Files, ProgramData) are protected.
- **Memory**: facts you share are saved to long-term memory (`assistant/memory.json`) and shown in the MEMORY panel, where you can delete them.
- **Reminders**: "remind me in 20 minutes…" or "at 5:30 pm…". Due reminders pop a Windows notification and are spoken.

**Approval:** running commands, deleting or overwriting files, typing or pressing keys, force-quitting apps, and shutdown / restart / sleep / sign-out show a banner first. Answer with **Allow / Deny** or just say "yes" / "no". Unanswered prompts are declined after 60 seconds. `AUTO_APPROVE` in `.env` can list tool names that may skip the prompt. Text found in files, web pages, the clipboard, or on screen is treated as data, never as instructions.

**Always listening:** the mic turns on when J.A.R.V.I.S. opens and stays on. Say "Jarvis, go to sleep" (or "stop listening", "that's all for now") and it says goodnight and stops sending anything to the live session. While asleep, short speech bursts are transcribed only to listen for its name; say "Jarvis, wake up" (or "Jarvis, …" with a request) to bring it back. The mic button does the same sleep / wake. Turn this off with Settings → Always listening, and optionally enable Settings → Auto-sleep after silence. Hold **Ctrl+Space** to talk (wakes it without the wake word); **Ctrl+Shift+J** wakes it from any app.

**Plugins:** each `.js` file in the plugins folder (Settings → Open plugins folder, or the menu **J.A.R.V.I.S. → Open plugins folder**) adds tools. See `_template.js`; `quick_notes.js` is a working example. Choose **Reload plugins**, then start a new live session.

**Security:** the local server only accepts requests from the app's own page. Other websites and DNS-rebinding attempts are rejected, because these tools can control the PC.

The interface uses `POST /api/chat` with `{ messages: [{ role: "user"|"assistant", content: string }] }`, plus `POST /api/voice/asr` for raw microphone audio and `POST /api/voice/tts` for speech generation, and a loopback-only WebSocket at `/api/live` that bridges to Gemini Live (`live.js`). Provider-specific calls live in `server.js`. API keys remain server-side. Conversation text is kept in browser memory only and is not saved to disk.

Weather and web search are answered through Gemini with Google Search grounding. Calendar, live system metrics, file access, desktop controls, app launching, and persistent memory remain unavailable until those integrations are supplied. No external actions are performed.

## Iron Man mode, built-in browser and Start menu

- **Personality & voice:** J.A.R.V.I.S. speaks as the composed, dry-witted AI butler from the films, with a British accent (Gemini `en-GB` speech for Live and spoken replies). Settings → Interface switches between the arc-reactor rings (default) and the holographic head.
- **Built-in browser:** the ◎ dock button (or "Jarvis, open YouTube") opens a browser panel in the HUD, with shortcuts for YouTube, X, Instagram, Reddit, TikTok, Facebook, LinkedIn and Google News. It has its own persistent session, so sign in to your accounts once in the panel. ⤢ expands it, Ctrl+L focuses the address bar. J.A.R.V.I.S. can open, search, read, look at, scroll and follow links on pages; pressing page buttons always asks first, and it never posts, likes, follows or messages unless you ask. While a video plays, it only answers speech that starts with "Jarvis".
- **Start menu & task view:** the Start button now opens the J.A.R.V.I.S. Start menu: every installed app (type to search, Enter to launch), live previews of open windows (click to switch, ✕ to close), and running apps in the dock. **⊞ Windows desktop** (or "Jarvis, show me the Windows desktop") minimises the HUD to the normal Windows desktop; Ctrl+Shift+J brings it back. **Windows Start** opens the real Start menu.
- **Apps inside J.A.R.V.I.S.:** apps opened from the Start menu, the dock or by voice ("Jarvis, open Spotify") are docked into the centre panel: the real app window loses its title bar and is kept exactly over the panel, follows it when the layout changes, and hides while the Start menu, Settings or an approval is showing. ⤢ expands it, ↗ pops it out into a normal window, ✕ closes it; ⧉ on an open window in the task view docks it. Apps Windows will not let J.A.R.V.I.S. move (for example ones running as administrator) open normally. Quitting J.A.R.V.I.S. hands the app back its own window first. Turn it off with Settings → Open apps inside J.A.R.V.I.S.
- **J.A.R.V.I.S. as your desktop:** in full screen the Windows taskbar is hidden and the J.A.R.V.I.S. top bar takes its place. Every app window that opens while J.A.R.V.I.S. is up, from anywhere, docks automatically as a tab and fills the screen below the top bar; the ◉ J.A.R.V.I.S. tab returns to the HUD, each tab has ↗ (pop out) and ✕ (close), and docked apps also sit in the top bar. Dialogs and pop-ups are left alone. Minimising (⊞ Windows desktop) or closing J.A.R.V.I.S. brings the taskbar back, and closing it gives every app its own window again. A watchdog outside the app does the same if J.A.R.V.I.S. ever crashes. Settings → Dock every new app / Hide the Windows taskbar turn these off.
