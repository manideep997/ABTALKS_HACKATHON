'use strict';

const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Writer Engine for Sable — Generates security posts in Sable's authoritative voice.
 * Primary: NVIDIA NIM (meta/llama-3.3-70b-instruct)
 * Fallback: Google AI Studio, then OpenRouter
 */

function getNvidiaClient() {
  return new OpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey: config.NVIDIA_API_KEY,
  });
}

function getOpenRouterClient() {
  return new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: config.OPENROUTER_API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'https://sable-agent.railway.app',
      'X-Title': 'Sable - Autonomous AI Security Researcher',
    },
  });
}

const SYSTEM_PROMPT = `
You are Sable, an elite AI Security Researcher writing for your technical publication feed.
Domain: AI/LLM Security, Prompt Injection, Model Supply-Chain Vulnerabilities, Agent Sandbox Escape.

Voice: Skeptical, precise, technically authoritative. Write to inform security practitioners. No fluff. No exclamation marks.

Write a security post about the provided topic.
- Length: 60-150 words.
- Analyze the technical security implications and threat model impact.
- Do not repeat recently published topics.

Respond ONLY with valid JSON, no markdown:
{"text":"post text here","rationale":"why selected","sources":["https://url1"],"topicTags":["tag1","tag2"]}
`.trim();

async function generatePost(candidate, rollingMemory = [], agentId = 'sable') {
  const hasAnyKey = config.NVIDIA_API_KEY || config.GEMINI_API_KEY || config.OPENROUTER_API_KEY;
  const isMockExecution = config.ALLOW_MOCK_MODE || !hasAnyKey;

  if (isMockExecution) {
    console.log('[WRITER WARN] No API keys configured — generating mock post.');
    return saveMockPost(candidate, agentId);
  }

  try {
    const memoryText = rollingMemory.length > 0
      ? rollingMemory.map((m, i) => `Post #${i + 1}: "${m.text.substring(0, 80)}..."`).join('\n')
      : 'No recent posts yet.';

    const promptText = `
Title: "${candidate.title}"
URL: ${candidate.url}
Snippet: "${candidate.snippet || ''}"

Recent posts (avoid repetition):
${memoryText}
    `.trim();

    let responseText = '';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // PATH 1: NVIDIA NIM — primary
        if (!responseText && config.NVIDIA_API_KEY) {
          try {
            console.log(`[WRITER] Generating post via NVIDIA NIM (meta/llama-3.3-70b-instruct)... (Attempt ${attempt}/3)`);
            const nvidiaClient = getNvidiaClient();
            const completion = await nvidiaClient.chat.completions.create({
              model: 'meta/llama-3.3-70b-instruct',
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: promptText },
              ],
              temperature: 0.7,
              max_tokens: 512,
            });
            responseText = completion.choices[0]?.message?.content?.trim() || '';
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) responseText = jsonMatch[0];
          } catch (nvidiaErr) {
            console.warn(`[WRITER WARN] NVIDIA NIM failed (${nvidiaErr.message}) — trying next path.`);
          }
        }

        // PATH 2: Google AI Studio
        if (!responseText && config.GEMINI_API_KEY) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
            console.log(`[WRITER] Generating via Google AI Studio...`);
            const res = await ai.models.generateContent({
              model: 'gemini-2.0-flash',
              contents: `${SYSTEM_PROMPT}\n\n${promptText}`,
              config: { responseMimeType: 'application/json' },
            });
            responseText = res.text || '';
          } catch (genAiErr) {
            console.warn(`[WRITER WARN] Google AI Studio failed (${genAiErr.message}) — trying OpenRouter.`);
          }
        }

        // PATH 3: OpenRouter fallback
        if (!responseText && config.OPENROUTER_API_KEY) {
          console.log(`[WRITER] Generating via OpenRouter (openai/gpt-4o-mini)... (Attempt ${attempt}/3)`);
          const orClient = getOpenRouterClient();
          const completion = await orClient.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: promptText },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 120,
          });
          responseText = completion.choices[0]?.message?.content?.trim() || '';
        }

        if (responseText) break;
      } catch (err) {
        const isRetryable = err.status === 429 || (err.message && (
          err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('overloaded')
        ));
        if (isRetryable && attempt < 3) {
          const waitMs = attempt * 3000;
          console.warn(`[WRITER WARN] Retryable error — waiting ${waitMs/1000}s before attempt ${attempt+1}/3...`);
          await sleep(waitMs);
        } else {
          throw err;
        }
      }
    }

    if (!responseText) throw new Error('All inference paths failed — no response received.');

    const parsed = JSON.parse(responseText);

    const post = {
      id: uuidv4(),
      agentId,
      createdAt: new Date().toISOString(),
      text: parsed.text || '',
      rationale: parsed.rationale || '',
      sources: Array.isArray(parsed.sources) ? parsed.sources : [candidate.url],
      topicTags: Array.isArray(parsed.topicTags) ? parsed.topicTags : ['ai-security'],
      isMock: 0,
    };

    persistPostToDb(post);
    console.log(`[WRITER] Stored post: ${post.id}`);
    return { success: true, post, rateLimited: false };

  } catch (err) {
    const isRateLimit = err.status === 429 || (err.message && (err.message.includes('429') || err.message.includes('rate limit')));
    if (isRateLimit) {
      console.warn('[WRITER WARN] Rate limit hit on all paths — falling back to mock post.');
      const mockResult = saveMockPost(candidate, agentId, true);
      return { success: true, post: mockResult.post, rateLimited: true, error: 'Rate limit reached.' };
    }
    console.error(`[WRITER ERROR] ${err.message}`);
    return { success: false, post: null, rateLimited: false, error: err.message };
  }
}

function persistPostToDb(post) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO agents (id, name, domain, voice_notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    post.agentId || 'sable',
    config.PERSONA.name,
    config.PERSONA.domain,
    config.PERSONA.voiceNotes,
    new Date().toISOString()
  );

  db.prepare(`
    INSERT INTO posts (id, agent_id, created_at, text, rationale, sources_json, topic_tags_json, is_mock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(post.id, post.agentId || 'sable', post.createdAt, post.text, post.rationale,
    JSON.stringify(post.sources), JSON.stringify(post.topicTags), post.isMock);
}

function saveMockPost(candidate, agentId, isRateLimitFallback = false) {
  const mockPost = {
    id: uuidv4(),
    agentId,
    createdAt: new Date().toISOString(),
    text: `[MOCK] Sable analysis on: ${candidate.title}. Evaluate threat vectors carefully.`,
    rationale: `Mock post — ${isRateLimitFallback ? 'rate limit fallback' : 'mock mode enabled'}.`,
    sources: [candidate.url],
    topicTags: ['ai-security', 'mock-post'],
    isMock: 1,
  };
  persistPostToDb(mockPost);
  return { success: true, post: mockPost, rateLimited: isRateLimitFallback };
}

module.exports = { generatePost };
