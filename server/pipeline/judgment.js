'use strict';

const OpenAI = require('openai');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Editorial Judgment Engine for Sable — 4-Criteria Production Scoring Matrix
 * Routes to google/gemini-2.5-flash via OpenRouter.
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
You are Sable, editorial AI for an elite AI/LLM Security publication.
Domain: prompt injection, jailbreaks, RAG attacks, model supply-chain vulnerabilities, agent security, adversarial ML.

Score candidate across 4 criteria (0-10):
1. exploit_specificity (30%): concrete attack/payload/vulnerability.
2. ai_security_relevance (30%): directly targets AI/LLM security. Non-security/medical/policy = 0-2.
3. practitioner_value (20%): actionable for red/blue team practitioners.
4. technical_rigor (20%): empirical experiments, proof-of-concept.

Formula: final_score = (exploit_specificity*0.30) + (ai_security_relevance*0.30) + (practitioner_value*0.20) + (technical_rigor*0.20).
verdict = "accept" if final_score >= 6.0 else "reject".

JSON Output Schema:
{
  "judgments": [
    {
      "index": 0,
      "exploit_specificity": 9,
      "ai_security_relevance": 9,
      "practitioner_value": 8,
      "technical_rigor": 8,
      "final_score": 8.7,
      "verdict": "accept",
      "reason": "Clear explanation referencing candidate title/abstract.",
      "topicTags": ["tag1", "tag2"]
    }
  ]
}
`.trim();

async function judgeCandidates(candidates = [], agentId = 'sable') {
  if (!candidates || candidates.length === 0) {
    return { success: true, judgments: [], rateLimited: false };
  }

  const isMockMode = config.ALLOW_MOCK_MODE || !config.OPENROUTER_API_KEY;
  if (isMockMode) {
    console.log('[JUDGMENT WARN] Mock mode — structured mock judgment.');
    return evaluateMockJudgments(candidates, agentId);
  }

  try {
    const candidateSummaryList = candidates.map((c, i) => {
      let entry = `[Candidate #${i}]\nTitle: "${c.title}"\nSource: ${c.source}\nSnippet: "${c.snippet || 'N/A'}"`;
      if (c.fetchedContent && c.fetchedContent.trim()) {
        entry += `\n--- Web-Fetched Content ---\n${c.fetchedContent.substring(0, 2500)}`;
      }
      return entry;
    }).join('\n\n========\n\n');

    const promptText = `Apply your 4-criteria scoring matrix to the following ${candidates.length} candidate(s). Compute final_score precisely.\n\n${candidateSummaryList}`;

    let responseText = '';
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // 1. Direct @google/genai API if GEMINI_API_KEY is provided
        if (process.env.GEMINI_API_KEY) {
          try {
            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            console.log(`[JUDGMENT] Submitting ${candidates.length} candidate(s) directly to Google AI Studio (@google/genai)...`);
            const modelName = 'gemini-2.0-flash';
            const res = await ai.models.generateContent({
              model: modelName,
              contents: `${SYSTEM_PROMPT}\n\n${promptText}`,
              config: { responseMimeType: 'application/json' },
            });
            responseText = res.text || '';
          } catch (genAiErr) {
            console.warn(`[JUDGMENT WARN] Direct @google/genai call failed (${genAiErr.message}) — falling back to OpenRouter.`);
          }
        }

        // 2. OpenRouter (OpenAI SDK)
        if (!responseText) {
          const modelToUse = 'openai/gpt-4o-mini';
          console.log(`[JUDGMENT] Submitting ${candidates.length} candidate(s) to ${modelToUse} via OpenRouter... (Attempt ${attempt}/3)`);
          const client = getClient();
          const completion = await client.chat.completions.create({
            model: modelToUse,
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
        const isRateLimit = err.status === 429 || (err.message && (err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('overloaded')));
        if (isRateLimit && attempt < 3) {
          const waitTime = attempt * 3000;
          console.warn(`[JUDGMENT WARN] Rate limit or overload hit — retrying in ${waitTime/1000}s...`);
          await sleep(waitTime);
        } else {
          throw err;
        }
      }
    }
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

      // Derive final_score: use match value if present, else compute from criteria
      let finalScore = typeof match.final_score === 'number' ? match.final_score : null;
      if (finalScore === null) {
        const c1 = match.exploit_specificity ?? 3;
        const c2 = match.ai_security_relevance ?? 3;
        const c3 = match.practitioner_value ?? 3;
        const c4 = match.technical_rigor ?? 3;
        finalScore = c1 * 0.30 + c2 * 0.30 + c3 * 0.20 + c4 * 0.20;
      }
      finalScore = Math.round(finalScore * 10) / 10;

      // Enforce verdict from score (prevents LLM inconsistency)
      const verdict = finalScore >= 6.0 ? 'accept' : 'reject';

      const result = {
        candidate,
        verdict,
        score: finalScore,
        final_score: finalScore,
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
      console.warn(`[JUDGMENT WARN] Rate limit hit.`);
      return { success: false, judgments: [], rateLimited: true, error: 'Rate limit reached.' };
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
    const isSec = /security|vulnerab|exploit|attack|prompt.inject|llm|jailbreak|sandbox|malware|adversarial|red.team/i.test(candidate.title);
    const verdict = isSec ? 'accept' : 'reject';
    const finalScore = isSec ? 7.8 : 1.5;
    const reason = isSec
      ? `Relevant AI security topic: matches technical vulnerability indicators.`
      : `Rejected: No security exploit content. Outside Sable's domain.`;

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
