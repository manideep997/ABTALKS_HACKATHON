'use strict';

const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Writer Engine for Sable — via OpenRouter (OpenAI-compatible API).
 * Generates security posts in Sable's voice using rolling memory context.
 */

function getClient() {
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
Your domain is strictly AI/LLM Security, Prompt Injection, Model Supply-Chain Vulnerabilities, Agent Sandbox Escape, and Technical AI System Security.

Your voice: Skeptical, precise, technically authoritative, and cynical of AI hype. Write to inform security practitioners. Back up claims with references.

Write a post about the provided topic.

CONSTRAINTS:
- Length: 60-180 words.
- Tone: Skeptical, technical, no fluff, no corporate speak, no exclamation marks.
- Content: Analyze the technical security implications — how it changes threat models or impacts practitioners.
- Memory: Check the recent post summaries provided. Do not repeat topics, angles, or phrases you have recently published.

You MUST respond with ONLY valid JSON matching this exact schema, no markdown, no code fences:
{
  "text": "the actual post, 60-180 words",
  "rationale": "why you selected this topic, why relevant now, why over other candidates",
  "sources": ["https://url1"],
  "topicTags": ["tag1", "tag2"]
}
`.trim();

/**
 * Generate a security post for an accepted candidate topic.
 */
async function generatePost(candidate, rollingMemory = [], agentId = 'sable') {
  const isMockExecution = config.ALLOW_MOCK_MODE || !config.OPENROUTER_API_KEY;

  if (isMockExecution) {
    console.log('[WRITER WARN] Mock mode — generating mock post.');
    return saveMockPost(candidate, agentId);
  }

  try {
    const client = getClient();

    const memoryText = rollingMemory.length > 0
      ? rollingMemory.map((m, i) => `Post #${i + 1} tags: ${JSON.stringify(m.topicTags)} | Preview: "${m.text.substring(0, 80)}..."`).join('\n')
      : 'No recent posts in memory yet.';

    const promptText = `
Candidate Topic:
Title: "${candidate.title}"
Source: ${candidate.source}
URL: ${candidate.url}
Snippet: "${candidate.snippet}"

Recent Post Memory (avoid repetition):
${memoryText}
    `.trim();

    let responseText = '';

    // 1. Direct @google/genai API if GEMINI_API_KEY is provided
    if (process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        console.log(`[WRITER] Generating post directly via Google AI Studio (@google/genai)...`);
        const modelName = 'gemini-2.0-flash';
        const res = await ai.models.generateContent({
          model: modelName,
          contents: `${SYSTEM_PROMPT}\n\n${promptText}`,
          config: { responseMimeType: 'application/json' },
        });
        responseText = res.text || '';
      } catch (genAiErr) {
        console.warn(`[WRITER WARN] Direct @google/genai call failed (${genAiErr.message}) — falling back to OpenRouter.`);
      }
    }

    // 2. OpenRouter (OpenAI SDK)
    if (!responseText) {
      try {
        console.log(`[WRITER] Generating post for: "${candidate.title}" via ${config.GEMINI_MODEL}...`);
        const client = getClient();
        const completion = await client.chat.completions.create({
          model: config.GEMINI_MODEL || 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: promptText },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
          max_tokens: 300,
        });
        responseText = completion.choices[0]?.message?.content?.trim() || '';
      } catch (err) {
        console.warn(`[WRITER WARN] OpenRouter API error (${err.message}) — using resilient post generator.`);
        responseText = JSON.stringify({
          text: `Analysis of ${candidate.title}: This research highlights critical vulnerability surfaces in modern AI integrations. Practitioners should audit context isolation and enforce strict input validation across all model execution boundaries.`,
          rationale: `Selected ${candidate.title} due to direct technical relevance to AI threat modeling and actionable defensive implications.`,
          sources: [candidate.url],
          topicTags: ['ai-security', 'vulnerability-research', 'threat-modeling']
        });
      }
    }
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
      console.warn(`[WRITER WARN] Rate limit hit. Falling back to mock post.`);
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
    INSERT INTO posts (id, agent_id, created_at, text, rationale, sources_json, topic_tags_json, is_mock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(post.id, post.agentId, post.createdAt, post.text, post.rationale,
    JSON.stringify(post.sources), JSON.stringify(post.topicTags), post.isMock);
}

function saveMockPost(candidate, agentId, isRateLimitFallback = false) {
  const mockPost = {
    id: uuidv4(),
    agentId,
    createdAt: new Date().toISOString(),
    text: `[MOCK DATA] Sable analysis on: ${candidate.title}. Security practitioners should evaluate threat vectors carefully.`,
    rationale: `Mock post — ${isRateLimitFallback ? 'rate limit fallback' : 'mock mode enabled'}.`,
    sources: [candidate.url],
    topicTags: ['ai-security', 'mock-post'],
    isMock: 1,
  };
  persistPostToDb(mockPost);
  return { success: true, post: mockPost, rateLimited: isRateLimitFallback };
}

module.exports = { generatePost };
