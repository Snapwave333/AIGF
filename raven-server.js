// Raven AI Assistant - Main Server
// Integrates Ollama LLM, Google APIs, VTuber Avatar, Piper TTS, and Wardrobe System

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@libsql/client';

// Raven-specific modules
import { OllamaClient } from './lib/ollama-client.js';
import { GoogleTools } from './lib/google-tools.js';
import { AvatarManager } from './lib/avatar-manager.js';
import { PiperTTS } from './lib/piper-tts.js';
import {
  RAVEN_SYSTEM_PROMPT,
  buildSystemPromptWithTools,
  getRandomResponse
} from './config/raven-personality.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CONFIGURATION =====
const config = {
  port: process.env.PORT || 3000,
  llmProvider: process.env.LLM_PROVIDER || 'ollama',
  ttsProvider: process.env.TTS_PROVIDER || 'piper',
  ravenName: process.env.RAVEN_NAME || 'Raven',
  userName: process.env.RAVEN_USER_NAME || 'User'
};

// ===== DATABASE SETUP =====
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
let db;

if (tursoUrl && tursoToken) {
  db = createClient({ url: tursoUrl, authToken: tursoToken });
  (async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          caller_id TEXT,
          status TEXT,
          start_ts INTEGER,
          end_ts INTEGER,
          metadata TEXT
        );
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          role TEXT,
          content TEXT,
          ts INTEGER,
          tool_calls TEXT
        );
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS raven_state (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );
      `);
      console.log('Database tables initialized');
    } catch (e) {
      console.error('DB init error', e);
    }
  })();
}

// ===== SERVICE INITIALIZATION =====

// Ollama Client
const ollama = new OllamaClient(
  process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  process.env.OLLAMA_MODEL || 'llama3:8b'
);

// Google Gemini (fallback/alternative)
let gemini = null;
if (process.env.GEMINI_API_KEY) {
  gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    .getGenerativeModel({ model: 'gemini-1.5-flash' });
}

// Google Tools
const googleTools = new GoogleTools(
  process.env.GOOGLE_CREDENTIALS_PATH || './credentials/google_credentials.json',
  process.env.GOOGLE_TOKEN_PATH || './credentials/google_token.json'
);

// Avatar Manager
const avatarManager = new AvatarManager({
  modelPath: process.env.AVATAR_MODEL_PATH || './assets/avatars/raven.vrm',
  wardrobePath: process.env.AVATAR_WARDROBE_PATH || './assets/wardrobe',
  vtuberApp: process.env.VTUBER_APP || 'vseeFace',
  virtualAudioDevice: process.env.VIRTUAL_AUDIO_DEVICE || 'CABLE Input'
});

// Piper TTS
const piperTTS = new PiperTTS({
  modelPath: process.env.PIPER_MODEL_PATH || './models/en_US-lessac-medium.onnx',
  configPath: process.env.PIPER_CONFIG_PATH || './models/en_US-lessac-medium.onnx.json',
  outputDir: './temp/audio',
  virtualAudioDevice: process.env.VIRTUAL_AUDIO_DEVICE || 'CABLE Input'
});

// Initialize services
(async () => {
  try {
    await avatarManager.initialize();
    console.log('Avatar manager initialized');
  } catch (e) {
    console.warn('Avatar manager init warning:', e.message);
  }

  try {
    await piperTTS.initialize();
    console.log('Piper TTS initialized:', piperTTS.getStatus().initialized);
  } catch (e) {
    console.warn('Piper TTS init warning:', e.message);
  }

  try {
    const googleInit = await googleTools.initialize();
    console.log('Google Tools initialized:', googleInit);
  } catch (e) {
    console.warn('Google Tools init warning:', e.message);
  }

  // Check Ollama health
  const ollamaHealthy = await ollama.isHealthy();
  console.log('Ollama available:', ollamaHealthy);
})();

// ===== EXPRESS APP =====
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Static files
app.use('/', express.static(path.join(__dirname, 'public')));

// ===== UTILITY FUNCTIONS =====
function cryptoRandom() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function saveRavenState(key, value) {
  if (!db) return;
  try {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO raven_state (key, value, updated_at) VALUES (?, ?, ?)',
      args: [key, JSON.stringify(value), Date.now()]
    });
  } catch (e) {
    console.warn('State save warning:', e.message);
  }
}

async function getRavenState(key) {
  if (!db) return null;
  try {
    const { rows } = await db.execute({
      sql: 'SELECT value FROM raven_state WHERE key = ?',
      args: [key]
    });
    return rows[0] ? JSON.parse(rows[0].value) : null;
  } catch (e) {
    console.warn('State read warning:', e.message);
    return null;
  }
}

// ===== API ENDPOINTS =====

// Health check
app.get('/api/health', async (_req, res) => {
  const ollamaHealthy = await ollama.isHealthy();

  res.json({
    ok: true,
    ts: Date.now(),
    services: {
      ollama: ollamaHealthy,
      gemini: !!gemini,
      googleTools: googleTools.getStatus().initialized,
      piperTTS: piperTTS.getStatus().initialized,
      avatar: avatarManager.getStatus().initialized,
      database: !!db
    },
    config: {
      llmProvider: config.llmProvider,
      ttsProvider: config.ttsProvider
    }
  });
});

// ===== LLM ENDPOINTS =====

// Main chat endpoint with Raven personality
app.post('/api/raven/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const sid = sessionId || cryptoRandom();

    // Get conversation history
    let history = [];
    if (db) {
      try {
        const { rows } = await db.execute({
          sql: 'SELECT role, content FROM messages WHERE session_id = ? ORDER BY ts DESC LIMIT 10',
          args: [sid]
        });
        history = rows.reverse();
      } catch (e) {
        console.warn('History fetch warning:', e.message);
      }
    }

    // Build messages with system prompt
    const messages = [
      { role: 'system', content: buildSystemPromptWithTools(['check_calendar', 'read_emails', 'search_drive', 'change_outfit', 'get_wardrobe']) }
    ];

    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }

    messages.push({ role: 'user', content: message });

    let responseText = '';
    let toolCalls = [];

    // Try Ollama first, fallback to Gemini
    if (config.llmProvider === 'ollama' || config.llmProvider === 'both') {
      try {
        const ollamaHealthy = await ollama.isHealthy();
        if (ollamaHealthy) {
          const response = await ollama.chat(messages);
          responseText = response.message.content;
          toolCalls = ollama.parseToolCalls(responseText);
        } else {
          throw new Error('Ollama not available');
        }
      } catch (e) {
        console.warn('Ollama error, falling back:', e.message);
        if (gemini) {
          const contextText = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
          const geminiResponse = await gemini.generateContent(contextText);
          responseText = geminiResponse.response.text();
        } else {
          throw new Error('No LLM available');
        }
      }
    } else if (config.llmProvider === 'gemini' && gemini) {
      const contextText = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
      const geminiResponse = await gemini.generateContent(contextText);
      responseText = geminiResponse.response.text();
    } else {
      return res.status(500).json({ error: 'No LLM configured' });
    }

    // Process tool calls if any
    const toolResults = [];
    for (const call of toolCalls) {
      const result = await executeRavenTool(call.tool, call.params || {});
      toolResults.push({ tool: call.tool, result });
    }

    // Update avatar expression based on response
    const expression = avatarManager.inferExpressionFromText(responseText);
    avatarManager.setExpression(expression);

    // Save to database
    if (db) {
      const now = Date.now();
      try {
        await db.execute({ sql: 'INSERT OR IGNORE INTO sessions (id, status, start_ts) VALUES (?, ?, ?)', args: [sid, 'active', now] });
        await db.execute({
          sql: 'INSERT INTO messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)',
          args: [cryptoRandom(), sid, 'user', message, now]
        });
        await db.execute({
          sql: 'INSERT INTO messages (id, session_id, role, content, ts, tool_calls) VALUES (?, ?, ?, ?, ?, ?)',
          args: [cryptoRandom(), sid, 'assistant', responseText, now + 1, JSON.stringify(toolCalls)]
        });
      } catch (e) {
        console.warn('DB write warning:', e.message);
      }
    }

    res.json({
      text: responseText,
      sessionId: sid,
      expression,
      toolCalls,
      toolResults,
      avatar: avatarManager.getStatus()
    });
  } catch (err) {
    console.error('Raven chat error:', err);
    res.status(500).json({
      error: 'Chat processing failed',
      ravenSays: getRandomResponse('error')
    });
  }
});

// Execute Raven tool calls
async function executeRavenTool(toolName, params) {
  try {
    switch (toolName) {
      case 'check_calendar':
        if (!googleTools.getStatus().initialized) {
          return { error: 'Google Calendar not configured' };
        }
        return await googleTools.getUpcomingEvents(params.days || 7);

      case 'read_emails':
        if (!googleTools.getStatus().initialized) {
          return { error: 'Gmail not configured' };
        }
        return await googleTools.getUnreadEmails(params.count || 10);

      case 'search_drive':
        if (!googleTools.getStatus().initialized) {
          return { error: 'Google Drive not configured' };
        }
        return await googleTools.searchDrive(params.query || '');

      case 'change_outfit':
        return await avatarManager.changeOutfit(params.outfit_name);

      case 'get_wardrobe':
        return avatarManager.listOutfits();

      case 'get_current_outfit':
        return { outfit: avatarManager.getCurrentOutfit() };

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

// ===== TTS ENDPOINTS =====

// Piper TTS (local)
app.post('/api/tts/piper', async (req, res) => {
  try {
    const { text, mood } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    if (!piperTTS.getStatus().initialized) {
      return res.status(503).json({ error: 'Piper TTS not available. Check installation.' });
    }

    // Adjust voice for mood
    if (mood) {
      piperTTS.adjustForMood(mood);
    }

    const result = await piperTTS.synthesizeToBuffer(text);

    // Notify avatar that speaking is starting
    avatarManager.setSpeaking(true);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Raven-Audio-Duration', result.buffer.length / (22050 * 2)); // Approximate duration
    res.send(result.buffer);

    // Reset speaking state after estimated duration
    setTimeout(() => {
      avatarManager.setSpeaking(false);
    }, (result.buffer.length / (22050 * 2)) * 1000 + 500);
  } catch (err) {
    console.error('Piper TTS error:', err);
    res.status(500).json({ error: 'TTS processing failed' });
  }
});

// ElevenLabs TTS (cloud)
app.post('/api/tts/elevenlabs', async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenKey) return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' });

    const vid = voiceId || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': elevenKey,
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.3, similarity_boost: 0.7 }
      })
    });

    if (!r.ok) {
      const msg = await r.text();
      return res.status(r.status).json({ error: msg });
    }

    avatarManager.setSpeaking(true);
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);

    // Estimate speaking duration based on text length
    setTimeout(() => {
      avatarManager.setSpeaking(false);
    }, text.length * 80 + 500);
  } catch (err) {
    console.error('ElevenLabs TTS error:', err);
    res.status(500).json({ error: 'TTS processing failed' });
  }
});

// ===== GOOGLE INTEGRATION ENDPOINTS =====

// Google auth URL
app.get('/api/google/auth-url', (req, res) => {
  try {
    const url = googleTools.getAuthUrl();
    res.json({ url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google auth callback
app.post('/api/google/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Missing authorization code' });

    await googleTools.exchangeCodeForToken(code);
    await googleTools.initialize();

    res.json({
      ok: true,
      message: 'Google authorization successful',
      status: googleTools.getStatus()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calendar events
app.get('/api/google/calendar', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const events = await googleTools.getUpcomingEvents(days);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gmail
app.get('/api/google/emails', async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const emails = await googleTools.getUnreadEmails(count);
    res.json({ emails });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Drive search
app.get('/api/google/drive/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

    const files = await googleTools.searchDrive(q);
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Google status
app.get('/api/google/status', (req, res) => {
  res.json(googleTools.getStatus());
});

// ===== AVATAR ENDPOINTS =====

// Avatar status
app.get('/api/avatar/status', (req, res) => {
  res.json(avatarManager.getStatus());
});

// Set expression
app.post('/api/avatar/expression', (req, res) => {
  const { expression } = req.body;
  if (!expression) return res.status(400).json({ error: 'Missing expression' });

  const result = avatarManager.setExpression(expression);
  res.json(result);
});

// Get setup instructions
app.get('/api/avatar/setup', (req, res) => {
  res.json({
    instructions: avatarManager.getSetupInstructions(),
    config: avatarManager.getVSeeFaceConfig()
  });
});

// ===== WARDROBE ENDPOINTS =====

// List outfits
app.get('/api/wardrobe/outfits', (req, res) => {
  res.json({ outfits: avatarManager.listOutfits() });
});

// Change outfit
app.post('/api/wardrobe/change', async (req, res) => {
  try {
    const { outfit } = req.body;
    if (!outfit) return res.status(400).json({ error: 'Missing outfit name' });

    const result = await avatarManager.changeOutfit(outfit);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get current outfit
app.get('/api/wardrobe/current', (req, res) => {
  res.json({ outfit: avatarManager.getCurrentOutfit() });
});

// Wardrobe status
app.get('/api/wardrobe/status', (req, res) => {
  res.json(avatarManager.wardrobe.getStatus());
});

// ===== SESSION MANAGEMENT (from original server) =====

app.get('/api/sessions', async (_req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' });
  try {
    const { rows } = await db.execute(`
      SELECT s.id, s.status, s.start_ts, s.end_ts,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
      FROM sessions s
      ORDER BY s.start_ts DESC
      LIMIT 50
    `);
    res.json({ sessions: rows });
  } catch (e) {
    console.error('Sessions list error', e);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' });
  const { id } = req.params;
  try {
    const { rows } = await db.execute({
      sql: 'SELECT role, content, ts, tool_calls FROM messages WHERE session_id = ? ORDER BY ts ASC',
      args: [id]
    });
    res.json({ messages: rows });
  } catch (e) {
    console.error('Session messages error', e);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

app.post('/api/sessions/:id/end', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' });
  const { id } = req.params;
  try {
    const now = Date.now();
    await db.execute({ sql: 'UPDATE sessions SET status = ?, end_ts = ? WHERE id = ?', args: ['ended', now, id] });
    res.json({ ok: true });
  } catch (e) {
    console.error('End session error', e);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// ===== OLLAMA MANAGEMENT =====

app.get('/api/ollama/models', async (req, res) => {
  try {
    const models = await ollama.listModels();
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ollama/health', async (req, res) => {
  const healthy = await ollama.isHealthy();
  res.json({ healthy, baseUrl: ollama.baseUrl, model: ollama.model });
});

// ===== SYSTEM STATUS =====

app.get('/api/system/status', async (req, res) => {
  const ollamaHealthy = await ollama.isHealthy();

  res.json({
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    services: {
      ollama: {
        available: ollamaHealthy,
        model: ollama.model,
        baseUrl: ollama.baseUrl
      },
      gemini: {
        available: !!gemini
      },
      googleTools: googleTools.getStatus(),
      piperTTS: piperTTS.getStatus(),
      avatar: avatarManager.getStatus(),
      database: {
        available: !!db,
        url: tursoUrl ? 'configured' : 'not configured'
      }
    },
    config
  });
});

// Setup instructions
app.get('/api/system/setup', (req, res) => {
  res.json({
    avatar: avatarManager.getSetupInstructions(),
    tts: piperTTS.getSetupInstructions(),
    google: googleTools.getStatus(),
    environment: fs.existsSync('.env') ? 'configured' : 'not configured (see .env.example)'
  });
});

// ===== START SERVER =====

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    RAVEN AI ASSISTANT                        ║
║                                                               ║
║  Server running on http://localhost:${PORT}                       ║
║                                                               ║
║  Dashboard: http://localhost:${PORT}/dashboard.html               ║
║  API Health: http://localhost:${PORT}/api/health                  ║
║  System Status: http://localhost:${PORT}/api/system/status        ║
║                                                               ║
║  "Oh. You've awakened me. How... wonderful."                  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
