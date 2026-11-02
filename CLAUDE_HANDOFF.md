# Claude handoff: J.A.R.V.I.S. desktop assistant

This bundle contains the current source, the supplied dashboard reference image, dependency lockfile, setup notes, and a ready-to-upload handoff summary. No API keys or `.env` file with secrets are included. The portable Windows app bundle is delivered separately as `JARVIS-Assistant-Windows.zip`.

## User's goal

Build a polished Jarvis-inspired desktop assistant around the supplied dark navy/cyan dashboard. User chose Gemini for text chat and Fish Audio for voice. They asked for hands-free listening instead of push-to-talk and now want to continue the work with Claude.

## Current implementation

- Electron desktop shell with the dashboard reference layout in `public/index.html` and `public/styles.css`.
- Node server and Gemini adapter in `server.js`; chat endpoint: `POST /api/chat`.
- Gemini REST `generateContent`, configured with `GEMINI_API_KEY` and `GEMINI_MODEL` (example default `gemini-3.8-flash`).
- Fish Audio ASR endpoint: `POST /api/voice/asr`; requests use `transcribe-1-pro` and browser-recorded WebM/Opus audio.
- Fish Audio TTS endpoint: `POST /api/voice/tts`; default `FISH_TTS_MODEL=s2.1-pro-free`, optional `FISH_VOICE_ID`.
- Hands-free listening uses browser `getUserMedia` + Web Audio level detection locally. It starts on first speech, ends after about 950 ms of silence, and caps each utterance at 20 seconds / 8 MB. Silence is not uploaded. There is no wake word: detected nearby speech is sent to Fish Audio for transcription.
- The mic button is an on/off toggle with a persistent visual indicator. Hands-free and spoken-reply choices are saved to `preferences.json` in the app's user-data folder. If hands-free was enabled, it resumes when the app is next launched. The app does not add itself to Windows startup.
- A separate top-right toggle controls Fish Audio spoken replies.
- Electron microphone permissions are restricted to audio-only access from the app's exact loopback origin.
- Conversation context is held in renderer memory only; it is not written to disk.
- API keys are read server-side from the app's `.env`, opened through **J.A.R.V.I.S. → Open configuration folder**. No API keys are embedded in source or the app bundle.
- Weather, calendar, telemetry, files, web search, desktop controls, app launching, startup launch, and persistent memory are still unavailable.

## Files

- `main.cjs` — Electron window, loopback server startup, configuration location, microphone permission boundary.
- `server.js` — API routes, configuration loading, Gemini, Fish ASR/TTS adapters, saved boolean preferences.
- `public/app.js` — chat orchestration, continuous hands-free audio detection, mic states, playback.
- `public/index.html` / `public/styles.css` — dashboard UI.
- `.env.example` — placeholders only.
- `reference/dashboard-reference.png` — user's target interface reference.

## Run / build

With Node.js 18+ installed:

```powershell
npm install
npm run app
```

To build a portable Windows app folder:

```powershell
npx electron-builder --win dir
```

This folder was packaged successfully and zipped separately. `npm run dist` is configured for a Windows installer; in this restricted build environment its NSIS compiler could not be spawned.

Set keys in the app configuration file (menu: **J.A.R.V.I.S. → Open configuration folder**) and restart:

```dotenv
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash
FISH_API_KEY=your_fish_audio_key
FISH_TTS_MODEL=s2.1-pro-free
FISH_VOICE_ID=
```

Keep real keys private; do not paste them into Claude or commit `.env`.

## Verification state and next work

- Electron portable directory packaging completed and the Windows app ZIP was produced.
- The app window did not remain open in the constrained authoring environment.
- No tests were run, and no provider calls or microphone session were verified because real keys and a user microphone session were not available.
- First priorities for continuation: inspect and run the app on the user's Windows desktop; verify Gemini chat and Fish ASR/TTS with the user's keys; test hands-free VAD in a quiet and noisy room, including playback feedback; tune the threshold and silence timeout; confirm the Windows microphone permission prompt and persisted preferences; consider an optional wake word because current mode sends any detected nearby speech to Fish Audio.
- The app does not have an installer certificate or custom icon.

## Official provider references

- Gemini API key setup: https://ai.google.dev/gemini-api/docs/api-key
- Gemini model catalog: https://ai.google.dev/gemini-api/docs/models
- Fish Audio API key page: https://fish.audio/app/api-keys
- Fish Audio ASR: https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text
- Fish Audio TTS: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- Electron permission API: https://www.electronjs.org/docs/latest/api/session
