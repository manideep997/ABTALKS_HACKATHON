'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const config = require('../config');
const { getDb } = require('../db/database');
const { runCycle, startScheduler, getSchedulerState } = require('../pipeline/scheduler');
const { judgeCandidates } = require('../pipeline/judgment');
const { getRollingMemory } = require('../pipeline/memory');
const { generatePost } = require('../pipeline/writer');
const { fetchWebContent, resolveTitleToUrl } = require('../utils/webFetcher');

/**
 * POST /api/agent/init
 * Evaluator spec: accepts { persona: { name, domain } }, returns { agentId }.
 * Returns immediately — cycle #1 runs asynchronously in the background.
 */
router.post('/init', async (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();

  // Accept persona from request body; fall back to config defaults
  const personaBody = (req.body || {}).persona || {};
  const agentName   = (personaBody.name   || config.PERSONA.name).trim();
  const agentDomain = (personaBody.domain || config.PERSONA.domain).trim();

  // Generate a unique agentId for this evaluation run
  const agentId = randomUUID();

  try {
    // 1. Insert agent profile with dynamic persona
    db.prepare(`
      INSERT INTO agents (id, name, domain, voice_notes, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(agentId, agentName, agentDomain, config.PERSONA.voiceNotes, now);
    console.log(`[API] Agent profile created — id=${agentId} name="${agentName}" domain="${agentDomain}"`);

    // 2. Return agentId immediately — evaluator must not be kept waiting
    res.json({ agentId });

    // 3. Start scheduler and run cycle #1 asynchronously (after response sent)
    startScheduler(agentId);
    console.log('[API] /init triggering background cycle #1...');
    runCycle(agentId).then(outcome => {
      console.log(`[API] Background cycle #1 complete for agentId=${agentId}`, outcome?.postsPublished ?? '');
    }).catch(err => {
      console.error(`[API] Background cycle #1 error for agentId=${agentId}: ${err.message}`);
    });

  } catch (err) {
    console.error(`[API ERROR] /init failed: ${err.message}`);
    // Only send error if response not already sent
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

/**
 * GET /api/agent/feed?agentId=<id>
 * Returns { posts: [...] } in reverse chronological order.
 */
router.get('/feed', (req, res) => {
  const db = getDb();
  const agentId = req.query.agentId || config.PERSONA.id;

  try {
    const rows = db.prepare(`
      SELECT id, agent_id, created_at, text, rationale, sources_json, topic_tags_json, is_mock
      FROM posts
      WHERE agent_id = ?
      ORDER BY created_at DESC
    `).all(agentId);

    const posts = rows.map(row => {
      let sources = [];
      let topicTags = [];
      try { sources = JSON.parse(row.sources_json || '[]'); } catch (_e) {}
      try { topicTags = JSON.parse(row.topic_tags_json || '[]'); } catch (_e) {}

      return {
        id: row.id,
        createdAt: row.created_at,
        text: row.text || '',
        rationale: row.rationale || '',
        sources: Array.isArray(sources) ? sources : [],
        // dashboard extras
        agentId: row.agent_id,
        topicTags,
        isMock: row.is_mock === 1,
      };
    });

    return res.json({ posts });
  } catch (err) {
    console.error(`[API ERROR] /feed failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/tick
 * Manually triggers one autonomous pipeline cycle.
 */
router.post('/tick', async (req, res) => {
  const agentId = req.query.agentId || req.body.agentId || config.PERSONA.id;
  const state = getSchedulerState();

  if (state.isCycleRunning) {
    console.log('[API] /tick request rejected: cycle already running.');
    return res.json({ status: 'skipped', reason: 'cycle_already_in_progress' });
  }

  try {
    console.log('[API] /tick manually triggering runCycle...');
    const outcome = await runCycle(agentId);
    return res.json({ status: 'completed', outcome });
  } catch (err) {
    console.error(`[API ERROR] /tick failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/rejections
 */
router.get('/rejections', (req, res) => {
  const db = getDb();
  const agentId = req.query.agentId || config.PERSONA.id;

  try {
    const rows = db.prepare(`
      SELECT id, title, url, reason, score, scored_at
      FROM rejected_topics
      WHERE agent_id = ?
      ORDER BY scored_at DESC
    `).all(agentId);

    return res.json(rows);
  } catch (err) {
    console.error(`[API ERROR] /rejections failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/stats
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  const agentId = req.query.agentId || config.PERSONA.id;
  const state = getSchedulerState();

  try {
    const counts = db.prepare(`
      SELECT
        COUNT(id) as total,
        SUM(CASE WHEN is_mock = 0 THEN 1 ELSE 0 END) as real_posts,
        SUM(CASE WHEN is_mock = 1 THEN 1 ELSE 0 END) as mock_posts
      FROM posts
      WHERE agent_id = ?
    `).get(agentId);

    const rejCount = db.prepare(`
      SELECT COUNT(id) as total FROM rejected_topics WHERE agent_id = ?
    `).get(agentId);

    return res.json({
      total_posts: counts ? (counts.total || 0) : 0,
      real_llm_posts: counts ? (counts.real_posts || 0) : 0,
      mock_posts: counts ? (counts.mock_posts || 0) : 0,
      total_rejected: rejCount ? (rejCount.total || 0) : 0,
      scheduler_status: state.schedulerStatus,
      last_cycle_at: state.lastCycleAt,
      last_cycle_result: state.lastCycleResult,
      is_cycle_running: state.isCycleRunning,
    });
  } catch (err) {
    console.error(`[API ERROR] /stats failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/simulate
 */
router.post('/simulate', async (req, res) => {
  const { title, snippet, url } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Missing required field: title' });
  }

  const agentId = req.query.agentId || req.body.agentId || config.PERSONA.id;
  let targetUrl = url && url.trim().startsWith('http') ? url.trim() : null;

  if (!targetUrl) {
    console.log(`[SIMULATE] No URL provided — resolving title to real paper URL...`);
    try {
      targetUrl = await resolveTitleToUrl(title.trim());
    } catch (e) {
      console.log(`[SIMULATE] Title resolution error: ${e.message}`);
    }

    if (!targetUrl) {
      return res.status(404).json({
        error: `Could not resolve "${title.trim()}" to a specific paper. Try providing the paper's direct URL (arXiv, DOI, etc.) for accurate evaluation.`,
      });
    }
    console.log(`[SIMULATE] Resolved title to: ${targetUrl}`);
  }

  console.log(`[SIMULATE] Fetching web content from: ${targetUrl}`);
  const fetchedContent = await fetchWebContent(targetUrl, title.trim());
  if (fetchedContent) {
    console.log(`[SIMULATE] Fetched ${fetchedContent.length} chars.`);
  }

  const candidate = {
    title: title.trim(),
    snippet: (snippet || '').trim(),
    url: targetUrl,
    source: 'Simulation',
    publishedAt: new Date().toISOString(),
    fetchedContent,
  };

  try {
    const judgmentResponse = await judgeCandidates([candidate], agentId);

    if (!judgmentResponse.success) {
      return res.status(500).json({ error: judgmentResponse.error || 'Judgment failed.' });
    }

    const judgment = judgmentResponse.judgments[0];
    if (!judgment) {
      return res.status(500).json({ error: 'No judgment returned.' });
    }

    let post = null;
    if (judgment.verdict === 'accept') {
      const memory = getRollingMemory(agentId);
      const writeResult = await generatePost(candidate, memory, agentId);
      if (writeResult.success) post = writeResult.post;
    }

    return res.json({
      verdict: judgment.verdict,
      score: typeof judgment.final_score === 'number' ? judgment.final_score : judgment.score,
      criteria: judgment.criteria || null,
      reason: judgment.reason || 'No reason returned.',
      topicTags: judgment.topicTags || [],
      resolvedUrl: targetUrl,
      fetchedContent: fetchedContent ? fetchedContent.substring(0, 500) : null,
      post: post || null,
    });
  } catch (err) {
    console.error(`[API ERROR] /simulate failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/list
 */
router.get('/list', (req, res) => {
  const db = getDb();
  try {
    const rows = db.prepare('SELECT id, name, domain, created_at FROM agents ORDER BY created_at DESC').all();
    return res.json(rows);
  } catch (err) {
    console.error(`[API ERROR] /list failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
