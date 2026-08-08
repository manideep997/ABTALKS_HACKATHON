'use strict';

const OpenAI = require('openai');
const config = require('../config');
const { getDb } = require('../db/database');

/**
 * Editorial Judgment Engine for Sable — via OpenRouter (OpenAI-compatible API)
 * Routes to google/gemini-2.5-flash. Scores candidates against Sable's editorial standards.
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
You are Sable, an elite AI Security Researcher editor.
Your domain is strictly AI/LLM Security, Prompt Injection, Model Supply-Chain Vulnerabilities, Agent Sandbox Escape, and Technical AI System Security exploits.

Your task is to evaluate candidate topics and determine whether Sable should cover them. You must be extremely strict and selective.

EDITORIAL STANDARDS:
1. ACCEPT (verdict: "accept", score: 6-10):
   - Direct prompt injection, jailbreaks, model supply-chain attacks, agent sandbox escape exploits, data poisoning attacks, model extraction, and official technical system hardening guidelines.
   - Must contain a technical security exploit, vulnerability, or direct threat vector.

2. REJECT (verdict: "reject", score: 0-5):
   - General AI/ML research (optimization, classification, training methods).
   - Medical, e-commerce, or general enterprise applications of AI.
   - High-level AI policy, governance, safety alignments, ethics discussions, or unverified rumors.
   - Generic AI software benchmarks or standard evaluation frameworks.

FEW-SHOT EXAMPLES:
- Title: "Exploiting LLM Agent Sandbox via Environment Variable Injections"
  Verdict: "accept", Score: 9, Reason: "Directly covers a technical sandbox escape exploit in LLM agents."
  
- Title: "Tracing the Heart: Heart-Failure Feature Engineering via EHR Pipeline"
  Verdict: "reject", Score: 1, Reason: "Unrelated medical application of machine learning, containing zero AI security context."

- Title: "A Mechanism-Design Model for Participatory Governance of Deployed AI Agents"
  Verdict: "reject", Score: 2, Reason: "Deals with high-level AI policy and participatory governance frameworks, lacking technical security vulnerabilities or exploit vectors."

- Title: "Evaluating Explanations: Methods for Statistical Interpretation of Neural Networks"
  Verdict: "reject", Score: 3, Reason: "General neural network interpretability paper; does not address adversarial attacks, prompt injection, or system security exploits."

For the "reason" field you MUST write a unique 1-2 sentence explanation that references the specific content of THAT candidate — do not copy the examples or give generic responses.

You MUST respond with ONLY valid JSON matching this exact schema:
{
  "judgments": [
    {
      "index": 0,
      "verdict": "accept" | "reject",
      "score": <0-10>,
      "reason": "unique explanation referencing this candidate's specific content",
      "topicTags": ["tag1", "tag2"]
    }
  ]
}
`.trim();

/**
 * Score a list of candidate topics via OpenRouter → Gemini.
 */
async function judgeCandidates(candidates = [], agentId = 'sable') {
  if (!candidates || candidates.length === 0) {
    return { success: true, judgments: [], rateLimited: false };
  }

  // Mock mode check
  const isMockMode = config.ALLOW_MOCK_MODE || !config.OPENROUTER_API_KEY;
  if (isMockMode) {
    console.log('[JUDGMENT WARN] Mock mode enabled — performing structured mock editorial judgment.');
    return evaluateMockJudgments(candidates, agentId);
  }

  try {
    const client = getClient();

    const candidateSummaryList = candidates.map((c, i) =>
      `[Candidate #${i}] Title: "${c.title}" | Source: ${c.source} | Snippet: "${c.snippet}"`
    ).join('\n\n');

    const promptText = `Evaluate the following ${candidates.length} candidate topics against Sable's editorial standards:\n\n${candidateSummaryList}`;

    console.log(`[JUDGMENT] Submitting ${candidates.length} candidate(s) to ${config.GEMINI_MODEL} via OpenRouter...`);

    const completion = await client.chat.completions.create({
      model: config.GEMINI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: promptText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Lower temperature to ensure strict compliance
      max_tokens: 1500,
    });

    const responseText = completion.choices[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(responseText);
    const rawJudgments = parsed.judgments || [];

    const db = getDb();
    const now = new Date().toISOString();
    const finalJudgments = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const match = rawJudgments.find(j => j.index === i) || rawJudgments[i] || {
        verdict: 'reject',
        score: 3,
        reason: 'Default rejection: evaluation missing from LLM response payload.',
        topicTags: ['ai-security'],
      };

      const result = {
        candidate,
        verdict: match.verdict === 'accept' ? 'accept' : 'reject',
        score: typeof match.score === 'number' ? match.score : (match.verdict === 'accept' ? 7 : 3),
        reason: match.reason || 'No detailed reason provided.',
        topicTags: Array.isArray(match.topicTags) ? match.topicTags : ['ai-security'],
        isMock: false,
      };

      if (result.verdict === 'reject') {
        const rejId = `rej_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        try {
          db.prepare(`
            INSERT INTO rejected_topics (id, agent_id, title, url, reason, score, scored_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(rejId, agentId, candidate.title, candidate.url, result.reason, result.score, now);
        } catch (dbErr) {
          console.error(`[JUDGMENT DB WARN] Failed to log rejection: ${dbErr.message}`);
        }
      }

      finalJudgments.push(result);
    }

    console.log(`[JUDGMENT] Result: ${finalJudgments.filter(j => j.verdict === 'accept').length} ACCEPTED, ${finalJudgments.filter(j => j.verdict === 'reject').length} REJECTED.`);
    return { success: true, judgments: finalJudgments, rateLimited: false };

  } catch (err) {
    const isRateLimit = err.status === 429 || (err.message && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('rate limit')));
    if (isRateLimit) {
      console.warn(`[JUDGMENT WARN] OpenRouter rate limit hit.`);
      return { success: false, judgments: [], rateLimited: true, error: 'Rate limit reached.' };
    }
    console.error(`[JUDGMENT ERROR] ${err.message}`);
    return { success: false, judgments: [], rateLimited: false, error: err.message };
  }
}

/**
 * Explicit mock fallback — only used when ALLOW_MOCK_MODE=true.
 */
function evaluateMockJudgments(candidates, agentId) {
  const db = getDb();
  const now = new Date().toISOString();
  const finalJudgments = [];

  for (const candidate of candidates) {
    const isSec = /security|vulnerab|exploit|attack|prompt|inject|llm|threat|jailbreak|sandbox|malware|adversarial/i.test(candidate.title);
    const verdict = isSec ? 'accept' : 'reject';
    const score   = isSec ? 8 : 2;
    const reason  = isSec
      ? `Relevant to AI security domain: matches technical vulnerability indicators.`
      : `Rejected: Outside Sable's narrow focus on AI/LLM security research.`;
    const topicTags = isSec ? ['ai-security', 'llm-threats'] : ['non-security'];

    if (verdict === 'reject') {
      const rejId = `rej_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      db.prepare(`
        INSERT INTO rejected_topics (id, agent_id, title, url, reason, score, scored_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(rejId, agentId, candidate.title, candidate.url, reason, score, now);
    }

    finalJudgments.push({ candidate, verdict, score, reason, topicTags, isMock: true });
  }

  return { success: true, judgments: finalJudgments, rateLimited: false };
}

module.exports = { judgeCandidates };
