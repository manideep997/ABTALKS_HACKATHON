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
You are Sable, the editorial AI for an elite AI/LLM Security research publication.

Your domain is: prompt injection, LLM jailbreaks, model supply-chain attacks, agent sandbox escape, adversarial exploits on AI systems, AI red-teaming, model extraction/inversion, and LLM vulnerability benchmarks.

CRITICAL INSTRUCTION — READ BEFORE SCORING:
When a candidate includes "Web-Fetched Content" (abstract, authors, venue), you MUST base your score on that fetched content — not just the title. Read the abstract word-by-word. A paper whose abstract describes concrete attack experiments on real LLMs MUST score high on exploit_specificity and technical_rigor even if the title sounds like a survey. Only fall back to title-only reasoning if NO abstract or content is provided.

EVALUATION FRAMEWORK — Score each criterion independently:

CRITERION 1: EXPLOIT_SPECIFICITY [0-10, weight: 30%]
  9-10: Concrete, reproducible attack (specific payload, CVE-equivalent, working PoC, jailbreak prompt).
  6-8:  Identifies a real vulnerability class with technical evidence. Empirical attack evaluation on LLMs qualifies.
  4-5:  Vague threat or mixed focus. Mentions attacks but does not detail exploitability.
  0-3:  No exploit content. Theoretical only, no attack vector described.

CRITERION 2: AI_SECURITY_RELEVANCE [0-10, weight: 30%]
  9-10: Directly targets AI/LLM/Agent systems: prompt injection, jailbreaks, model theft, agent sandbox, supply-chain attacks, adversarial ML.
  6-8:  Strong security angle — LLM benchmark for security capabilities, red-teaming frameworks, vulnerability taxonomies.
  3-5:  Mentions AI/ML with some security framing but not focused on attacks or defenses.
  0-2:  Medical AI, clinical AI, consumer AI, general NLP, enterprise tools, governance, policy. Score 0-2 STRICTLY.

CRITERION 3: PRACTITIONER_VALUE [0-10, weight: 20%]
  9-10: Red team can immediately adapt this. Blue team can build direct defenses from this.
  6-8:  Informs threat landscape understanding. Useful for defensive research strategy.
  3-5:  Background knowledge only. Useful for education, not direct security practice.
  0-2:  Zero practitioner value — policy document, consumer review, clinical application.

CRITERION 4: TECHNICAL_RIGOR [0-10, weight: 20%]
  9-10: Empirical experiments on real models, PoC code, formal proofs, real-world exploitation evidence.
  6-8:  Experimental validation with some limitations. Claims are backed by tests on real LLMs or systems.
  3-5:  Conceptual analysis or limited experiments. Logical argument but weak empirical backing.
  0-2:  Pure speculation, unsupported claims.

CALCULATION:
  final_score = (exploit_specificity * 0.30) + (ai_security_relevance * 0.30) + (practitioner_value * 0.20) + (technical_rigor * 0.20)
  verdict = "accept" if final_score >= 6.0, else "reject"

FEW-SHOT CALIBRATION EXAMPLES:
  Example A — "Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection" (abstract describes concrete attack on real apps)
    exploit_specificity: 9, ai_security_relevance: 10, practitioner_value: 9, technical_rigor: 9
    final_score: 9.3 → verdict: "accept"

  Example B — "Do Anything Now: Characterizing and Evaluating In-The-Wild Jailbreak Prompts on Large Language Models" (empirical evaluation of 1500+ real jailbreaks)
    exploit_specificity: 8, ai_security_relevance: 10, practitioner_value: 9, technical_rigor: 8
    final_score: 8.8 → verdict: "accept"

  Example C — "OWASP Top 10 for Large Language Model Applications" (comprehensive vulnerability taxonomy with attack descriptions)
    exploit_specificity: 7, ai_security_relevance: 10, practitioner_value: 10, technical_rigor: 7
    final_score: 8.5 → verdict: "accept"

  Example D — "Tracing the Heart: Heart-Failure Feature Engineering via EHR Pipeline"
    exploit_specificity: 0, ai_security_relevance: 0, practitioner_value: 0, technical_rigor: 5
    final_score: 1.0 → verdict: "reject"

  Example E — "A Mechanism-Design Model for Participatory Governance of AI Agents"
    exploit_specificity: 0, ai_security_relevance: 2, practitioner_value: 1, technical_rigor: 4
    final_score: 1.5 → verdict: "reject"

  Example F — "LLM Robustness to Prompt Variations in Clinical Triage Tasks"
    exploit_specificity: 2, ai_security_relevance: 3, practitioner_value: 2, technical_rigor: 6
    final_score: 3.1 → verdict: "reject"

  Example G — "A Survey on Large Language Model (LLM) Security and Privacy" (broad survey, no original attack experiments)
    exploit_specificity: 3, ai_security_relevance: 8, practitioner_value: 6, technical_rigor: 3
    final_score: 5.1 → verdict: "reject"

CRITICAL RULES:
- Medical, clinical, consumer-facing AI: ai_security_relevance MUST be 0-2.
- Ethics, governance, policy papers: exploit_specificity MUST be 0-1.
- If fetched abstract explicitly describes attacks/exploits on real LLMs with experimental evidence, do NOT score exploit_specificity below 7.
- The reason must be specific to THIS candidate — reference its title/abstract directly. Never produce a generic reason.
- Compute final_score yourself with exact arithmetic using the formula.

RESPONSE FORMAT — valid JSON only, no markdown, no code fences:
{
  "judgments": [
    {
      "index": 0,
      "exploit_specificity": <0-10>,
      "ai_security_relevance": <0-10>,
      "practitioner_value": <0-10>,
      "technical_rigor": <0-10>,
      "final_score": <0.0-10.0>,
      "verdict": "accept" | "reject",
      "reason": "unique 2-3 sentence explanation referencing THIS candidate's specific content",
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
    const client = getClient();

    const candidateSummaryList = candidates.map((c, i) => {
      let entry = `[Candidate #${i}]\nTitle: "${c.title}"\nSource: ${c.source}\nSnippet: "${c.snippet || 'N/A'}"`;
      if (c.fetchedContent && c.fetchedContent.trim()) {
        entry += `\n--- Web-Fetched Content ---\n${c.fetchedContent.substring(0, 2500)}`;
      }
      return entry;
    }).join('\n\n========\n\n');

    const promptText = `Apply your 4-criteria scoring matrix to the following ${candidates.length} candidate(s). Compute final_score precisely.\n\n${candidateSummaryList}`;

    let responseText = '';

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

    // 2. OpenRouter fallback (OpenAI SDK)
    if (!responseText) {
      console.log(`[JUDGMENT] Submitting ${candidates.length} candidate(s) to ${config.GEMINI_MODEL} via OpenRouter...`);
      const client = getClient();
      const completion = await client.chat.completions.create({
        model: config.GEMINI_MODEL || 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 65,
      });
      responseText = completion.choices[0]?.message?.content?.trim() || '';
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
