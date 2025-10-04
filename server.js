// server.js
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fetch from 'node-fetch'
import path from 'path'
import { fileURLToPath } from 'url'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { createClient } from '@libsql/client'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// DB setup (Turso/libSQL)
const tursoUrl = process.env.TURSO_DATABASE_URL
const tursoToken = process.env.TURSO_AUTH_TOKEN
let db
if (tursoUrl && tursoToken) {
  db = createClient({ url: tursoUrl, authToken: tursoToken })
  ;(async () => {
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          caller_id TEXT,
          status TEXT,
          start_ts INTEGER,
          end_ts INTEGER
        );
      `)
      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          role TEXT,
          content TEXT,
          ts INTEGER
        );
      `)
    } catch (e) {
      console.error('DB init error', e)
    }
  })()
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

// Static
app.use('/', express.static(path.join(__dirname, 'public')))

// LLM endpoint using Gemini with optional session context
app.post('/api/llm', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' })

    const geminiApiKey = process.env.GEMINI_API_KEY
    if (!geminiApiKey) return res.status(500).json({ error: 'Missing GEMINI_API_KEY' })

    let context = ''
    if (db && sessionId) {
      try {
        const { rows } = await db.execute({
          sql: 'SELECT role, content FROM messages WHERE session_id = ? ORDER BY ts DESC LIMIT 8',
          args: [sessionId]
        })
        context = rows.reverse().map(r => `${r.role}: ${r.content}`).join('\n')
      } catch (e) {
        console.warn('DB read warning', e)
      }
    }

    const genai = new GoogleGenerativeAI(geminiApiKey)
    const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const response = await model.generateContent([context ? `Context:\n${context}` : '', prompt].filter(Boolean).join('\n\n'))
    const text = response.response.text()

    if (db && sessionId) {
      const now = Date.now()
      try {
        await db.execute({ sql: 'INSERT OR IGNORE INTO sessions (id, status, start_ts) VALUES (?, ?, ?)', args: [sessionId, 'active', now] })
        await db.execute({ sql: 'INSERT INTO messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)', args: [cryptoRandom(), sessionId, 'user', prompt, now] })
        await db.execute({ sql: 'INSERT INTO messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)', args: [cryptoRandom(), sessionId, 'assistant', text, now + 1] })
      } catch (e) {
        console.warn('DB write warning', e)
      }
    }

    res.json({ text })
  } catch (err) {
    console.error('LLM error', err)
    res.status(500).json({ error: 'LLM processing failed' })
  }
})

function cryptoRandom() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ElevenLabs TTS proxy
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceId } = req.body
    if (!text) return res.status(400).json({ error: 'Missing text' })

    const elevenKey = process.env.ELEVENLABS_API_KEY
    if (!elevenKey) return res.status(500).json({ error: 'Missing ELEVENLABS_API_KEY' })

    const vid = voiceId || '21m00Tcm4TlvDq8ikWAM'
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`

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
    })

    if (!r.ok) {
      const msg = await r.text()
      return res.status(r.status).json({ error: msg })
    }

    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(buf)
  } catch (err) {
    console.error('TTS error', err)
    res.status(500).json({ error: 'TTS processing failed' })
  }
})

// Vapi webhook stub
app.post('/api/vapi-webhook', async (req, res) => {
  try {
    const { type, data } = req.body || {}
    console.log('Vapi event:', type)

    function safeStringify(obj) {
      try {
        return JSON.stringify(obj, (k, v) => (typeof v === 'string' && /key|token|authorization/i.test(k) ? '[redacted]' : v))
      } catch (_) {
        return String(obj)
      }
    }

    const sid = (data && (data.sessionId || data.callId || (data.session && data.session.id) || (data.call && data.call.id)))
      || req.body?.sessionId
      || req.query?.sessionId

    if (db && sid) {
      const now = Date.now()
      try {
        await db.execute({ sql: 'INSERT OR IGNORE INTO sessions (id, status, start_ts) VALUES (?, ?, ?)', args: [sid, 'active', now] })

        if (type === 'call.started' || type === 'session.started') {
          await db.execute({ sql: 'UPDATE sessions SET status = ?, start_ts = ? WHERE id = ?', args: ['active', now, sid] })
        } else if (type === 'call.ended' || type === 'session.ended') {
          await db.execute({ sql: 'UPDATE sessions SET status = ?, end_ts = ? WHERE id = ?', args: ['ended', now, sid] })
        } else if (type === 'transcript' || type === 'message') {
          const text = (data && (data.text || data.message || data.content || '')) || ''
          const role = (data && (data.role || (type === 'transcript' ? 'user' : 'assistant'))) || 'user'
          await db.execute({ sql: 'INSERT INTO messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)', args: [cryptoRandom(), sid, role, text, now] })
        } else {
          await db.execute({ sql: 'INSERT INTO messages (id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?)', args: [cryptoRandom(), sid, 'event', `${type}: ${safeStringify(data)}`, now] })
        }
      } catch (e) {
        console.warn('Webhook DB write warning', e)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('Webhook error', err)
    res.status(500).json({ error: 'Webhook failed' })
  }
})

// Sessions API: list sessions
app.get('/api/sessions', async (_req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' })
  try {
    const { rows } = await db.execute(`
      SELECT s.id, s.status, s.start_ts, s.end_ts,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
      FROM sessions s
      ORDER BY s.start_ts DESC
      LIMIT 50
    `)
    res.json({ sessions: rows })
  } catch (e) {
    console.error('Sessions list error', e)
    res.status(500).json({ error: 'Failed to list sessions' })
  }
})

// Sessions API: get messages for a session
app.get('/api/sessions/:id/messages', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' })
  const { id } = req.params
  try {
    const { rows } = await db.execute({
      sql: 'SELECT role, content, ts FROM messages WHERE session_id = ? ORDER BY ts ASC',
      args: [id]
    })
    res.json({ messages: rows })
  } catch (e) {
    console.error('Session messages error', e)
    res.status(500).json({ error: 'Failed to get messages' })
  }
})

// Sessions API: end session
app.post('/api/sessions/:id/end', async (req, res) => {
  if (!db) return res.status(400).json({ error: 'DB not configured' })
  const { id } = req.params
  try {
    const now = Date.now()
    await db.execute({ sql: 'UPDATE sessions SET status = ?, end_ts = ? WHERE id = ?', args: ['ended', now, id] })
    res.json({ ok: true })
  } catch (e) {
    console.error('End session error', e)
    res.status(500).json({ error: 'Failed to end session' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})