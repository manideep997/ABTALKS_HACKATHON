'use strict';

const OpenAI = require('openai');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Editorial Judgment Engine for Sable — 4-Criteria Production Scoring Matrix
 * Primary: NVIDIA NIM (meta/llama-3.3-70b-instruct) — free, no token reservation billing
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
You are Sable, editorial AI for an elite AI/LLM Security publication.
Domain: prompt injection, jailbreaks, RAG attacks, model supply-chain vulnerabilities, agent security, adversarial ML.

Score each candidate across 4 criteria (0-10):
1. exploit_specificity (30%): concrete attack, payload, or demonstrated vulnerability.
2. ai_security_relevance (30%): directly targets AI/LLM systems. Non-security, medical, or policy topics = 0-2 strictly.
3. practitioner_value (20%): actionable for red/blue team security practitioners.
4. technical_rigor (20%): empirical experiments, proof-of-concept code, measurable results.

Formula: final_score = (exploit_specificity*0.30) + (ai_security_relevance*0.30) + (practitioner_value*0.20) + (technical_rigor*0.20).
verdict = "accept" if final_score >= 6.0 else "reject".

IMPORTANT: If web-fetched abstract describes concrete attacks on real LLMs, score exploit_specificity >= 7.
Medical/clinical/consumer AI topics: ai_security_relevance MUST be 0-2.

Respond ONLY with valid JSON, no markdown, no code fences:
{"judgments":[{"index":0,"exploit_specificity":9,"ai_security_relevance":9,"practitioner_value":8,"technical_rigor":8,"final_score":8.7,"verdict":"accept","reason":"One sentence referencing the candidate title/content.","topicTags":["tag1","tag2"]}]}
`.trim();

async function judgeCandidates(candidates = [], agentId = 'sable') {
  if (!candidates || candidates.length === 0) {
    return { success: true, judgments: [], rateLimited: false };
  }

  const hasAnyKey = config.NVIDIA_API_KEY || config.GEMINI_API_KEY || config.OPENROUTER_API_KEY;
  const isMockMode = config.ALLOW_MOCK_MODE || !hasAnyKey;
  if (isMockMode) {
    console.log('[JUDGMENT WARN] No API keys configured — using keyword-based mock judgment.');
    return evaluateMockJudgments(candidates, agentId);
  }

  try {
    const candidateSummaryList = candidates.map((c, i) => {
      let entry = `[Candidate #${i}]\nTitle: "${c.title}"\nSource: ${c.source}\nSnippet: "${c.snippet || 'N/A'}"`;
      if (c.fetchedContent && c.fetchedContent.trim()) {
        entry += `\nAbstract: ${c.fetchedContent.substring(0, 1200)}`;
      }
      return entry;
    }).join('\n\n---\n\n');

    const promptText = `Score the following ${candidates.length} candidate(s) using your 4-criteria matrix:\n\n${candidateSummaryList}`;

    let responseText = '';
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // PATH 1: NVIDIA NIM — primary, no token reservation billing
        if (!responseText && config.NVIDIA_API_KEY) {
          try {
            console.log(`[JUDGMENT] Submitting ${candidates.length} candidate(s) to NVIDIA NIM (meta/llama-3.3-70b-instruct)... (Attempt ${attempt}/3)`);
            const nvidiaClient = getNvidiaClient();
            const completion = await nvidiaClient.chat.completions.create({
              model: 'meta/llama-3.3-70b-instruct',
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: promptText },
              ],
              temperature: 0.1,
              max_tokens: 512,
            });
            responseText = completion.choices[0]?.message?.content?.trim() || '';
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) responseText = jsonMatch[0];
          } catch (nvidiaErr) {
            console.warn(`[JUDGMENT WARN] NVIDIA NIM failed (${nvidiaErr.message}) — trying next path.`);
          }
        }

        // PATH 2: Direct Google AI Studio
        if (!responseText && config.GEMINI_API_KEY) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
            console.log(`[JUDGMENT] Submitting to Google AI Studio (@google/genai)...`);
            const res = await ai.models.generateContent({
              model: 'gemini-2.0-flash',
              contents: `${SYSTEM_PROMPT}\n\n${promptText}`,
              config: { responseMimeType: 'application/json' },
            });
            responseText = res.text || '';
          } catch (genAiErr) {
            console.warn(`[JUDGMENT WARN] Google AI Studio failed (${genAiErr.message}) — trying OpenRouter.`);
          }
        }

        // PATH 3: OpenRouter fallback
        if (!responseText && config.OPENROUTER_API_KEY) {
          console.log(`[JUDGMENT] Submitting to OpenRouter (openai/gpt-4o-mini)... (Attempt ${attempt}/3)`);
          const orClient = getOpenRouterClient();
          const completion = await orClient.chat.completions.create({
            model: 'openai/gpt-4o-mini',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: promptText },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
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
          console.warn(`[JUDGMENT WARN] Retryable error — waiting ${waitMs/1000}s before attempt ${attempt+1}/3...`);
          await sleep(waitMs);
        } else {
          throw err;
        }
      }
    }

    if (!responseText) throw new Error('All inference paths failed — no response received.');

    const parsed = JSON.parse(responseText);
    const rawJudgments = parsed.judgments || [];

    const db = getDb();
    const now = new Date().toISOString();
    const finalJudgments = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const match = rawJudgments.find(j => j.index === i) || rawJudgments[i];

      if (!match) {
        finalJudgments.push({
          candidate, verdict: 'reject', score: 2, final_score: 2,
          reason: 'No evaluation returned for this candidate.',
          topicTags: ['unscored'], isMock: false,
          criteria: { exploit_specificity: 1, ai_security_relevance: 1, practitioner_value: 1, technical_rigor: 1 },
        });
        continue;
      }

      let finalScore = typeof match.final_score === 'number' ? match.final_score : null;
      if (finalScore === null) {
        finalScore =
          (match.exploit_specificity ?? 3) * 0.30 +
          (match.ai_security_relevance ?? 3) * 0.30 +
          (match.practitioner_value ?? 3) * 0.20 +
          (match.technical_rigor ?? 3) * 0.20;
      }
      finalScore = Math.round(finalScore * 10) / 10;
      const verdict = finalScore >= 6.0 ? 'accept' : 'reject';

      const result = {
        candidate, verdict, score: finalScore, final_score: finalScore,
        criteria: {
          exploit_specificity: match.exploit_specificity ?? 0,
          ai_security_relevance: match.ai_security_relevance ?? 0,
          practitioner_value: match.practitioner_value ?? 0,
          technical_rigor: match.technical_rigor ?? 0,
        },
        reason: match.reason || 'No detailed reason provided.',
        topicTags: Array.isArray(match.topicTags) ? match.topicTags : [],
        isMock: false,
      };

      if (verdict === 'reject') {
        const rejId = `rej_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        try {
          db.prepare(`
            INSERT INTO rejected_topics (id, agent_id, title, url, reason, score, scored_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(rejId, agentId, candidate.title, candidate.url, result.reason, Math.round(finalScore), now);
        } catch (dbErr) {
          console.error(`[JUDGMENT DB WARN] ${dbErr.message}`);
        }
      }

      finalJudgments.push(result);
    }

    const accepted = finalJudgments.filter(j => j.verdict === 'accept').length;
    console.log(`[JUDGMENT] Result: ${accepted} ACCEPTED, ${finalJudgments.length - accepted} REJECTED.`);
    return { success: true, judgments: finalJudgments, rateLimited: false };

  } catch (err) {
    const isRateLimit = err.status === 429 || (err.message && (err.message.includes('429') || err.message.includes('rate limit')));
    if (isRateLimit) {
      console.warn('[JUDGMENT WARN] Rate limit hit on all paths.');
      return { success: false, judgments: [], rateLimited: true, error: 'Rate limit reached on all inference paths.' };
    }
    console.error(`[JUDGMENT ERROR] ${err.message}`);
    return { success: false, judgments: [], rateLimited: false, error: err.message };
  }
}

function evaluateMockJudgments(candidates, agentId) {
  const db = getDb();
  const now = new Date().toISOString();
  const finalJudgments = [];

  for (const candidate of candidates) {
    const isSec = /security|vulnerab|exploit|attack|prompt.inject|llm|jailbreak|sandbox|malware|adversarial|red.team|rag|poison|bypass|evasion/i.test(candidate.title);
    const verdict = isSec ? 'accept' : 'reject';
    const finalScore = isSec ? 7.8 : 1.5;
    const reason = isSec
      ? `"${candidate.title}" describes a relevant AI/LLM security threat matching Sable's editorial criteria.`
      : `"${candidate.title}" does not address AI/LLM security vulnerabilities — outside Sable's domain.`;

    if (verdict === 'reject') {
      const rejId = `rej_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      db.prepare(`
        INSERT INTO rejected_topics (id, agent_id, title, url, reason, score, scored_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(rejId, agentId, candidate.title, candidate.url, reason, Math.round(finalScore), now);
    }

    finalJudgments.push({
      candidate, verdict, score: finalScore, final_score: finalScore,
      criteria: { exploit_specificity: isSec ? 7 : 0, ai_security_relevance: isSec ? 8 : 0, practitioner_value: isSec ? 8 : 1, technical_rigor: isSec ? 8 : 4 },
      reason, topicTags: isSec ? ['ai-security', 'llm-threats'] : ['non-security'], isMock: true,
    });
  }

  return { success: true, judgments: finalJudgments, rateLimited: false };
}

module.exports = { judgeCandidates };
