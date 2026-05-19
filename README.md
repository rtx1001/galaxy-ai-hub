<p align="center">
  <img src="Logo/logo_GAH_full.png" alt="Galaxy AI Hub" width="420" />
</p>

# Galaxy AI Hub

Galaxy AI Hub is a local-first desktop AI companion app.

It is built for chatting with a personal AI character that can remember context, automations, speak with a selected voice, use tools, local workspace management, generate images, and connect to Telegram while keeping the main AI work on your own PC.

> Early private test build. The app is still changing quickly while model setup, tool use, voice, image generation, Telegram, and automation are being refined.

## What It Can Do

- Chat with local GGUF language models.
- Use multiple assistant characters with avatar, personality, memory, and voice.
- Use multiple user profiles.
- Speak replies with local voice synthesis.
- Auto-play both sides of a conversation when auto speech is enabled.
- Generate images locally from text, user images, character avatars, or both user + character references.
- Send and receive Telegram messages through the same assistant logic.
- Use tools for weather, local media, Google-related actions, image generation, voice, and automation.
- Show thinking and tool activity inside the app.
- Keep private settings, tokens, generated media, and heavy models outside Git.

## Current Models

These are the current local test models used by this build. They are not stored in the GitHub repository.

| Part | Current model/files | Used for |
| --- | --- | --- |
| Brain | `HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive` | Chat, reasoning, personality, tool use |
| Image Studio | `Qwen-Rapid-NSFW-v23_Q4_K.gguf` | Text-to-image and image editing |
| Image text encoder | `Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf` | Understanding image prompts |
| Image projector | `Qwen2.5-VL-7B-Instruct.mmproj-Q8_0.gguf` | Multimodal image support |
| Image VAE | `qwen_image_vae.safetensors` | Image encode/decode |
| Voice | `omnivoice-base-Q8_0.gguf` | Local character speech |
| Voice tokenizer | `omnivoice-tokenizer-Q8_0.gguf` | Voice runtime tokenizer |
| Voice helper | `faster-whisper-tiny` | Voice sample preparation |

Recommended LLM direction for testing:

- **Light PC:** Gemma 4 E2B GGUF, Q4 or Q5.
- **Balanced PC:** Gemma 4 E4B GGUF, Q5 or Q6.
- **Alternative:** Qwen GGUF instruct models.

## Expected PC Specs

Galaxy AI Hub can run at different levels depending on the model size.

| Tier | Suggested specs | Expected experience |
| --- | --- | --- |
| Light | 16 GB RAM, 4-6 GB VRAM or CPU mode | Chat first, voice/image may swap models more often |
| Balanced | 32 GB RAM, 8-12 GB VRAM | Good local chat, voice, and 1024px image generation |
| High | 64 GB RAM, 12+ GB VRAM | Smoother model switching, larger context, better multitasking |

The app should always prefer the LLM first. If there is enough VRAM, voice can stay loaded too. If not, the app swaps models only when needed.

## First Startup Setup

The goal is that new users should not need to manually hunt for model files.

First-start setup:

1. Detect the PC hardware.
2. Pick a recommended model tier automatically.
3. Download the Brain model.
4. Download the Voice model.
5. Download the Image Studio model package.
6. Verify the files.
7. Generate simple model metadata.
8. Let the user create or choose a character.
9. Start chatting.

Advanced users will still be able to choose their own GGUF models and folders.

## Portable Build

For new users, the simplest release format is planned to be a portable Windows zip:

1. Download `GalaxyAIHub-portable.zip`.
2. Extract it anywhere, such as `D:\GalaxyAIHub`.
3. Run `Galaxy AI Hub.exe`.
4. Let the first startup setup download the selected local models.

Create the portable package:

```powershell
npm run package:portable
```

The portable zip includes the app, starter voice samples, and the small local image runtime. It does not include the large LLM/image/voice model files. Those are downloaded during first startup.

## Development

Install dependencies:

```powershell
npm install
```

Run the desktop app:

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

## What Is Not Stored In Git

The repository does not include heavy or private runtime data:

- LLM models
- image generation models
- voice models
- generated images/audio
- local settings
- Google tokens
- Telegram bot token
- logs
- build caches
- bundled runtime binaries

## Status

Private experimental build for local AI companion testing.
