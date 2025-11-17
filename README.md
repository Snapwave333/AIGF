# Raven AI Assistant

A full-stack, embodied AI assistant with VTuber avatar support, local LLM integration, text-to-speech, and Google service integrations.

## Overview

Raven is a personal AI assistant with a distinctive personality - intelligent, sarcastic, and deadpan. She can:

- **Chat** with a consistent personality using local LLM (Ollama) or Google Gemini
- **Speak** using local TTS (Piper) or ElevenLabs
- **Embody** a VTuber avatar with expressions and outfit changes
- **Access** your Google Calendar, Gmail, and Drive
- **Manage** a wardrobe of VRM outfits and accessories

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (React-like UI)            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Express.js Server                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Ollama  │  │  Google  │  │  Avatar  │  │  Piper   │   │
│  │  Client  │  │   Tools  │  │  Manager │  │   TTS    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
    ▼                     ▼                     ▼
┌──────────┐      ┌──────────────┐      ┌──────────────┐
│  Ollama  │      │    Google    │      │   Turso DB   │
│  (Local) │      │    APIs      │      │   (Persist)  │
└──────────┘      └──────────────┘      └──────────────┘
```

## Quick Start

### 1. Prerequisites

- Node.js 18+
- [Ollama](https://ollama.ai) (for local LLM)
- [Piper TTS](https://github.com/rhasspy/piper) (optional, for local TTS)
- [VSeeFace](https://www.vseeface.icu/) (optional, for VTuber avatar)

### 2. Installation

```bash
# Clone and install dependencies
git clone <your-repo>
cd AIGF
npm install

# Copy environment template
cp .env.example .env
```

### 3. Configure Environment

Edit `.env` with your settings:

```env
# LLM Provider
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3:8b

# TTS Provider
TTS_PROVIDER=piper
PIPER_MODEL_PATH=./models/en_US-lessac-medium.onnx

# Optional: Google APIs
GOOGLE_CREDENTIALS_PATH=./credentials/google_credentials.json

# Optional: Database (Turso)
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_token
```

### 4. Start the Server

```bash
npm start
```

Visit: http://localhost:3000/dashboard.html

## Module Overview

### The Brain: LLM Integration

Raven uses Ollama for local, private AI responses. Falls back to Google Gemini if configured.

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3:8b
```

### The Personality: Raven's Character

Raven's personality is defined in `config/raven-personality.js`:

- Intelligent and competent
- Sarcastic and deadpan
- Never uses exclamation marks
- Responds with dry wit

Example responses:
- "Checking your schedule. You seem... busy. How dreadful."
- "Fine. I'll sift through your digital noise."
- "There. It's done. You're welcome, I suppose."

### The Voice: Text-to-Speech

Two options:

**Piper (Local, Recommended)**
```bash
# Download Piper
# https://github.com/rhasspy/piper/releases

# Download a voice model
# Place in ./models/
# Recommended: en_US-lessac-medium (clear, neutral voice)
```

**ElevenLabs (Cloud)**
```env
ELEVENLABS_API_KEY=your_key
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### The Body: VTuber Avatar

**VRM Model**
- Place your VRM model in `./assets/avatars/`
- Free models available at [VRoid Hub](https://hub.vroid.com/) or [Booth.pm](https://booth.pm/)

**VSeeFace Setup**
1. Install VSeeFace
2. Install virtual audio cable (VB-Audio on Windows, BlackHole on macOS)
3. Configure VSeeFace to use virtual audio input
4. Route Piper TTS output to virtual audio cable

### The Hands: Google Integrations

Access Calendar, Gmail, and Drive:

1. Create project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Calendar, Gmail, and Drive APIs
3. Create OAuth 2.0 credentials (Desktop app)
4. Download `credentials.json` to `./credentials/`
5. Authorize via dashboard

### The Closet: Wardrobe System

Raven can change outfits autonomously:

```
./assets/wardrobe/
├── outfits/          # VRM outfit files
│   ├── casual_dark.vrm
│   ├── formal_elegant.vrm
│   └── punk_goth.vrm
├── accessories/      # Accessories
└── presets/          # Saved combinations
```

Name files with tags: `outfit_casual_dark_summer.vrm`
Tags: casual, formal, punk, goth, dark, light, summer, winter, etc.

## API Endpoints

### Chat
```bash
POST /api/raven/chat
{
  "message": "What's on my calendar?",
  "sessionId": "optional-session-id"
}
```

### TTS
```bash
# Piper (local)
POST /api/tts/piper
{ "text": "Hello world", "mood": "bored" }

# ElevenLabs
POST /api/tts/elevenlabs
{ "text": "Hello world" }
```

### Google
```bash
GET /api/google/calendar?days=7
GET /api/google/emails?count=10
GET /api/google/drive/search?q=report
```

### Avatar
```bash
GET /api/avatar/status
POST /api/avatar/expression
{ "expression": "annoyed" }
```

### Wardrobe
```bash
GET /api/wardrobe/outfits
POST /api/wardrobe/change
{ "outfit": "punk_goth" }
```

### System
```bash
GET /api/health
GET /api/system/status
GET /api/system/setup
```

## Project Structure

```
AIGF/
├── raven-server.js           # Main server (new)
├── server.js                 # Legacy server
├── package.json
├── .env.example              # Environment template
├── config/
│   └── raven-personality.js  # Raven's character definition
├── lib/
│   ├── ollama-client.js      # Local LLM client
│   ├── google-tools.js       # Google API integrations
│   ├── avatar-manager.js     # VTuber avatar control
│   ├── wardrobe-manager.js   # Outfit management
│   └── piper-tts.js          # Local TTS
├── public/
│   ├── index.html            # Legacy test UI
│   └── dashboard.html        # New dashboard (main UI)
├── assets/
│   ├── avatars/              # VRM models
│   └── wardrobe/             # Outfits & accessories
├── models/                   # TTS voice models
├── credentials/              # Google OAuth credentials
└── temp/
    └── audio/                # Generated audio files
```

## Customization

### Modify Raven's Personality

Edit `config/raven-personality.js`:

```javascript
export const RAVEN_SYSTEM_PROMPT = `
  Your custom personality here...
`;
```

### Add Custom Tools

In `raven-server.js`, add to `executeRavenTool()`:

```javascript
case 'your_tool':
  return await yourToolFunction(params);
```

Update `RAVEN_TOOL_DESCRIPTIONS` in the personality config.

## Development

```bash
# Run in development
npm run dev

# Legacy server (original implementation)
npm run start:legacy
```

## Roadmap

- [ ] WebSocket support for real-time updates
- [ ] Voice recognition input (STT)
- [ ] OSC integration for direct VTuber control
- [ ] Custom emotion detection from text
- [ ] Multi-language support
- [ ] Discord/Twitch integration
- [ ] Scheduled tasks and reminders

## Troubleshooting

**Ollama not responding**
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags
# Start Ollama service
ollama serve
```

**Piper TTS not working**
- Ensure Piper is in your PATH
- Download voice model (.onnx and .onnx.json files)
- Check model path in .env

**Google APIs not authorized**
- Create OAuth credentials in Google Cloud Console
- Enable required APIs (Calendar, Gmail, Drive)
- Place credentials.json in ./credentials/

**VSeeFace not receiving audio**
- Install virtual audio cable
- Configure Piper to output to virtual cable
- Set VSeeFace input to virtual cable

## Credits

- Ollama - Local LLM runtime
- Piper - Local TTS engine
- VSeeFace - VTuber software
- Google APIs - Calendar, Gmail, Drive integrations
- Express.js - Web framework
- Turso - Database persistence

## License

MIT License

---

*"Oh. You've read the documentation. How... thorough of you. Now go set something up. If you must."* - Raven
