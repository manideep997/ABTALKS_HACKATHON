'use strict';

require('dotenv').config();

// ─── Validation ───────────────────────────────────────────────────────────────

const REQUIRED_FOR_LIVE_MODE = ['OPENROUTER_API_KEY', 'GEMINI_MODEL'];
const allowMock = process.env.ALLOW_MOCK_MODE === 'true';

if (!allowMock) {
  for (const key of REQUIRED_FOR_LIVE_MODE) {
    if (!process.env[key]) {
      console.error(
        `[CONFIG ERROR] Missing required environment variable: ${key}.\n` +
          `Set it in .env, or set ALLOW_MOCK_MODE=true to run in transparent mock mode.`
      );
      process.exit(1);
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),

  // LLM — OpenRouter proxy (OpenAI-compatible), routes to Gemini
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || null,
  GEMINI_MODEL: process.env.GEMINI_MODEL || null,

  // Mock mode — transparent only, never silent
  ALLOW_MOCK_MODE: allowMock,

  // Scheduler
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || '*/30 * * * *',

  // Persona identity — locked for this build
  PERSONA: {
    id: 'sable',
    name: 'Sable',
    domain: 'AI & LLM Security Research',
    voiceNotes:
      'Skeptical, precise, and technically authoritative. ' +
      'Covers LLM vulnerabilities, prompt injection, model supply-chain risks, ' +
      'and sandbox safety. Cites sources. Explains implications. Never hypes.',
  },
};
