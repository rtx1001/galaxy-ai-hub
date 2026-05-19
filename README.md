# Galaxy AI Hub

Galaxy AI Hub is a local-first desktop AI companion app built with Tauri, React, TypeScript, and Rust.

The goal is simple: make a personal AI that feels natural to talk to, can use local tools, can speak with character voices, can generate images locally, and can extend into places like Telegram without turning into a cloud-only chatbot.

> Early private test build. The code is moving quickly while the assistant workflow, local model setup, voice, image generation, and automation features are being refined.

## What It Does

- Chat with local GGUF language models through a desktop app.
- Use character profiles with avatar, personality, voice, memory, and behavior settings.
- Switch between user profiles and assistant profiles.
- Speak replies with local voice synthesis.
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
- **Voice:** local OmniVoice voice synthesis runtime (600+ langugages)
- **Image generation:** local image runtime managed by the app
- **Integrations:** Telegram, Google-related tooling, local workspace folders

## Current Local Model Set

These are the models used by the current private test setup. They are local runtime files, not files committed to this repository.

| Part | Current model/files | Purpose |
| --- | --- | --- |
| LLM brain | `gemma4/model.gguf` | Main chat, reasoning, profile behavior, and tool planning |
| Image model | `Qwen-Rapid-NSFW-v23_Q4_K.gguf` | Local text-to-image and image-edit generation |
| Image text encoder | `Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf` | Prompt/image understanding for the image runtime |
| Image projector | `Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf` | Multimodal projection for the image runtime |
| Image VAE | `qwen_image_vae.safetensors` | Image decode/encode support |
| Voice model | `omnivoice-base-Q8_0.gguf` | Local character speech model |
| Voice tokenizer | `omnivoice-tokenizer-Q8_0.gguf` | Tokenizer used by the local voice runtime |
| Voice helper | `faster-whisper-tiny` cache | Lightweight transcription/helper model for voice sample prep |

Current local paths used during development:

```text
LLM models:
  C:\Users\Admin\AppData\Roaming\Jan\data\llamacpp\models

Image runtime models:
  assistant-runtime\sdcpp\models\qwen-edit

Voice runtime models:
  assistant-runtime\voice-tts\models

Bundled llama.cpp engine:
  src-tauri\engine
```

Other local LLM folders tested during development include:

```text
Gemma-4-E2B-Uncensored-HauhauCS-Aggressive-Q6_K_P
gemma-4-E4B-it-Q6_K
Jan-v3.5-4B-Q4_K_XL
qwen35
Qwen3_6-27B-Uncensored-HauhauCS-Balanced-IQ2_M
```

The app should treat this section as the current test baseline, not as a permanent hard requirement. The installer should be able to replace these with newer recommended models later.

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
- voice model files
- generated images/audio
- local app settings
- Google tokens
- Telegram bot token
- logs
- build caches
- bundled engine binaries

This keeps the repository light and avoids leaking personal credentials.

## First-Time Setup Plan

The app is meant to become simple for new users: install the app, choose a PC tier, then let Galaxy AI Hub download the right companion parts step by step.

Planned first-run flow:

1. **Detect hardware:** RAM, VRAM, GPU name, CPU, and available disk space.
2. **Choose PC tier automatically:** light, balanced, or high-end, with an override for advanced users.
3. **Download the Brain:** one recommended GGUF LLM for the selected tier.
4. **Download the Voice:** local speech files and sample-prep helpers.
5. **Download the Image Studio:** the recommended image model package for the selected tier.
6. **Verify files:** size checks, optional checksums, and a simple test load.
7. **Write metadata:** generate `model.yml` for LLM folders and simple manifests for image/voice files.
8. **Pick or create a character:** avatar, name, personality, voice, context size, and reply size.
9. **Start chatting:** no manual folder digging unless the user wants advanced control.

Until that installer flow is finished, models are added manually.

Recommended first-run presets:

| Tier | Target PC | Brain | Image Studio | Voice |
| --- | --- | --- | --- | --- |
| Light | 16 GB RAM, low VRAM or CPU-first | Gemma 4 E2B Q4/Q5 | optional or lower resolution | local Q8 voice, swap when needed |
| Balanced | 32 GB RAM, 8-12 GB VRAM | Gemma 4 E4B Q5/Q6 | Qwen image edit Q4 at 1024 px | keep voice loaded when VRAM allows |
| High | 64 GB RAM, 12+ GB VRAM | larger Gemma/Qwen GGUF | Qwen image edit Q4 at 1024-1536 px | keep brain and voice ready together |

Downloader behavior should be friendly and boring:

- show downloads as companion parts, such as Brain, Voice, Image Studio, and Tools
- resume interrupted downloads
- avoid downloading duplicate files
- keep heavy files outside Git
- prefer app-managed folders so users do not need to understand model layouts
- keep everything local after download
- explain disk usage before downloading large model packages

## Adding LLM Models

Galaxy AI Hub uses llama.cpp-compatible GGUF models. Download any multimodal GGUF LLM models into a folder, for example:

```text
C:\models
```

A simple model folder should look like this:

```text
models/
  gemma-4-E2B-it-Q6_K/
    model.gguf
    mmproj.gguf          optional, only for multimodal models
    model.yml
```

Example `model.yml`:

```yml
embedding: false
mmproj_path: /models/gemma-4-E2B-it-Q6_K/mmproj.gguf
model_path: /models/gemma-4-E2B-it-Q6_K/model.gguf
name: gemma-4-E2B-it-Q6_K
size_bytes: 8065300448
```

Recommended starting models:

- **Light PCs:** Gemma 4 E2B GGUF
- **Balanced PCs:** Gemma 4 E4B GGUF

For most users, start with a Q4, Q5, or Q6 quant. Q4 is smaller and lighter. Q5/Q6 usually sound smarter if your PC has enough RAM/VRAM.

## One-Shot Voice Clones

The voice system can use short reference samples to speak with a selected character voice.

Good sample rules:

- Use a clean voice clip around 8 seconds.
- One speaker only.
- No background music.
- No heavy echo or noise.
- Trim at natural word endings.
- Use normalized volume.
- Mono 22050 Hz works well for the current sample pipeline.

In the app:

1. Open the character profile.
2. Choose a voice folder.
3. Pick or preview a voice sample.
4. Save the character.
5. Use the speaker button or enable auto speech.

The app prepares samples so they are easier for the local voice runtime to reuse.

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

This project cares a lot about Unicode text handling because the assistant is expected to speak and reason naturally across languages such as Vietnamese, English, and more.

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
