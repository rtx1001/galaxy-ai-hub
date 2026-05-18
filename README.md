# Galaxy AI Hub

Galaxy AI Hub is a local-first desktop AI companion app built with Tauri, React, TypeScript, and Rust.

The goal is simple: make a personal AI that feels natural to talk to, can use local tools, can speak with character voices, can generate images locally, and can extend into places like Telegram without turning into a cloud-only chatbot.

> Early private test build. The code is moving quickly while the assistant workflow, local model setup, voice, image generation, and automation features are being refined.

## What It Does

- Chat with local GGUF language models through a desktop app.
- Use character profiles with avatar, personality, voice, memory, and behavior settings.
- Switch between user profiles and assistant profiles.
- Speak replies with local OmniVoice voice synthesis.
- Play both sides of a conversation when auto speech is enabled.
- Generate images locally through the app's Image Studio flow.
- Send and receive Telegram messages through the same assistant logic.
- Use tools for weather, workspace media, Google Calendar/Gmail-style actions, image generation, voice, and automation.
- Show thinking/tool activity in the app while keeping Telegram replies cleaner.
- Keep heavy models and personal runtime data out of Git.

## Why This Exists

Most AI apps feel split into pieces:

- one app for chat
- one tool for local models
- another for voice
- another for image generation
- another for Telegram or automation

Galaxy AI Hub tries to bring those pieces into one companion-style desktop app while still staying local-first and hackable.

The design target is closer to a personal AI workstation than a normal chatbot window.

## Current Stack

- **Desktop shell:** Tauri 2
- **Frontend:** React 19, TypeScript, Vite
- **Backend:** Rust
- **Local LLM:** llama.cpp-compatible GGUF models
- **Voice:** OmniVoice local runtime
- **Image generation:** local image runtime managed by the app
- **Integrations:** Telegram, Google-related tooling, local workspace folders

## Project Layout

```text
src/                    React UI
src/components/         Chat, tool cards, monitor, shared UI
src-tauri/src/          Rust backend, agent runtime, tools, voice, models
src-tauri/python/       Voice/runtime helper scripts
characters/             Character profile templates and soul files
scripts/                Maintenance checks
Logo/                   Project logo assets
```

## Not Stored In Git

The repo intentionally ignores large or private local files:

- downloaded LLM models
- image generation models
- OmniVoice model files
- generated images/audio
- local app settings
- Google tokens
- Telegram bot token
- logs
- build caches
- bundled engine binaries

This keeps the repository light and avoids leaking personal credentials.

## Development

Install dependencies:

```powershell
npm install
```

Run the frontend:

```powershell
npm run dev
```

Run the Tauri app:

```powershell
npm run tauri dev
```

Build:

```powershell
npm run build
```

Encoding check:

```powershell
npm run check:encoding
```

## Notes

This project cares a lot about Unicode text handling because the assistant is expected to speak and reason naturally across languages such as Vietnamese, English, Thai, and more.

Heavy runtime files are expected to be downloaded or prepared separately. Future installer work should make that setup much easier for new users.

## Status

Private experimental build.

Main areas still being improved:

- installer and first-run model setup
- tool-call reliability
- Telegram approval and permissions
- local image generation quality
- voice/runtime memory management
- cleaner release packaging

