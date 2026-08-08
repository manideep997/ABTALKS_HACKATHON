'use strict';

// Load and validate environment + persona config first — exits if keys missing
const config = require('./config');

const express = require('express');
const cors = require('cors');
const path = require('path');
const OpenAI = require('openai');
const { getDb } = require('./db/database');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Routes (loaded after DB + config are valid) ──────────────────────────────
const apiRouter = require('./routes/api');
app.use('/api/agent', apiRouter);
app.get('/health', (_req, res) => res.json({ status: 'ok', persona: config.PERSONA.name }));

// ─── Startup Sequence ─────────────────────────────────────────────────────────
async function start() {
  // 1. Initialize database (creates tables if they don't exist)
  getDb();

  // 2. Mandatory startup log — proves in-process always-on runtime
  console.log('[INIT] Scheduler started — process is always-on');

  // 3. OpenRouter reachability ping
  if (!config.ALLOW_MOCK_MODE) {
    try {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.OPENROUTER_API_KEY,
        defaultHeaders: {
          'HTTP-Referer': 'https://sable-agent.railway.app',
          'X-Title': 'Sable - Autonomous AI Security Researcher',
        },
      });

      // Minimal completion call
      const completion = await client.chat.completions.create({
        model: config.GEMINI_MODEL,
        messages: [{ role: 'user', content: 'Say the single word: ready' }],
        max_tokens: 50,
      });
      const reply = completion.choices[0]?.message?.content?.trim() || '';
      console.log(`[INIT] Gemini model "${config.GEMINI_MODEL}" reachable via OpenRouter — response: "${reply}"`);
    } catch (err) {
      console.error(
        `[INIT ERROR] Gemini model "${config.GEMINI_MODEL}" is NOT reachable via OpenRouter.\n` +
          `Reason: ${err.message}\n` +
          `Check GEMINI_MODEL and OPENROUTER_API_KEY in .env before running the scheduler.`
      );
      process.exitCode = 1;
    }
  } else {
    console.warn('\n********************************************************************************');
    console.warn('[WARNING] ALLOW_MOCK_MODE=true — ALL posts will be fake/templated.');
    console.warn('This should never be true in a real test or the final submission.');
    console.warn('********************************************************************************\n');
  }

  // 4. Bind port
  app.listen(config.PORT, () => {
    console.log(`[INIT] Sable server listening on http://localhost:${config.PORT}`);
  });
}

start();
