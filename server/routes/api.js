'use strict';

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db/database');
const { runCycle, startScheduler, getSchedulerState } = require('../pipeline/scheduler');
const { judgeCandidates } = require('../pipeline/judgment');
const { getRollingMemory } = require('../pipeline/memory');
const { generatePost } = require('../pipeline/writer');
const { fetchWebContent } = require('../utils/webFetcher');

/**
 * POST /api/agent/init
 * Initializes the agent record in SQLite database, starts background cron scheduler,
 * and executes cycle #1 immediately so that the feed is populated on first inspection.
 */
router.post('/init', async (req, res) => {
  const db = getDb();
  const agentId = config.PERSONA.id;
  const now = new Date().toISOString();

  try {
    // 1. Ensure Agent Profile exists in database
    const agentExists = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
    if (!agentExists) {
      db.prepare(`
        INSERT INTO agents (id, name, domain, voice_notes, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        agentId,
        config.PERSONA.name,
        config.PERSONA.domain,
        config.PERSONA.voiceNotes,
        now
      );
      console.log(`[API] Agent profile "${agentId}" created in SQLite.`);
    }

    // 2. Start background in-process cron
    startScheduler(agentId);

    // 3. Immediately execute cycle #1 synchronously
    console.log('[API] /init triggering immediate cycle #1 execution...');
    const cycleOutcome = await runCycle(agentId);

    return res.json({
      success: true,
      message: 'Agent initialized, scheduler started, cycle #1 executed.',
      cycleOutcome,
    });
  } catch (err) {
    console.error(`[API ERROR] /init failed: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agent/feed
 * Read-only feed returning published posts for a specific agent.
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
        agentId: row.agent_id,
        createdAt: row.created_at,
        text: row.text,
        rationale: row.rationale,
        sources,
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
 * Manually triggers one autonomous pipeline cycle (subject to concurrency lock).
 */
router.post('/tick', async (req, res) => {
  const agentId = config.PERSONA.id;
  const state = getSchedulerState();

  if (state.isCycleRunning) {
    console.log('[API] /tick request rejected: cycle already running.');
    return res.json({
      status: 'skipped',
      reason: 'cycle_already_in_progress',
    });
  }

  try {
    console.log('[API] /tick manually triggering runCycle...');
    const outcome = await runCycle(agentId);
    return res.json({
      status: 'completed',
      outcome,
    });
  } catch (err) {
    console.error(`[API ERROR] /tick failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agent/rejections
 * Returns logs of rejected candidate topics.
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
 * Returns operational metrics including counts of real vs mock posts and scheduler state.
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  const agentId = req.query.agentId || config.PERSONA.id;
  const state = getSchedulerState();

  try {
    // Count real vs mock posts
    const counts = db.prepare(`
      SELECT 
        COUNT(id) as total,
        SUM(CASE WHEN is_mock = 0 THEN 1 ELSE 0 END) as real_posts,
        SUM(CASE WHEN is_mock = 1 THEN 1 ELSE 0 END) as mock_posts
      FROM posts
      WHERE agent_id = ?
    `).get(agentId);

    // Count rejections
    const rejCount = db.prepare(`
      SELECT COUNT(id) as total FROM rejected_topics WHERE agent_id = ?
    `).get(agentId);

    const stats = {
      total_posts: counts ? (counts.total || 0) : 0,
      real_llm_posts: counts ? (counts.real_posts || 0) : 0,
      mock_posts: counts ? (counts.mock_posts || 0) : 0,
      total_rejected: rejCount ? (rejCount.total || 0) : 0,
      scheduler_status: state.schedulerStatus,
      last_cycle_at: state.lastCycleAt,
      last_cycle_result: state.lastCycleResult,
      is_cycle_running: state.isCycleRunning,
    };

    return res.json(stats);
  } catch (err) {
    console.error(`[API ERROR] /stats failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/simulate
 * Accepts { title, snippet, url }. Fetches the URL content for richer AI context,
 * runs the 4-criteria judgment matrix, and optionally generates a post.
 */
router.post('/simulate', async (req, res) => {
  const { title, snippet, url } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Missing required field: title' });
  }

  const agentId = config.PERSONA.id;
  const targetUrl = url && url.trim().startsWith('http')
    ? url.trim()
    : `https://arxiv.org/search/?query=${encodeURIComponent(title.trim())}&searchtype=all`;

  // Fetch web content for richer judgment context
  console.log(`[SIMULATE] Fetching web content from: ${targetUrl}`);
  const fetchedContent = await fetchWebContent(targetUrl, title.trim());
  if (fetchedContent) {
    console.log(`[SIMULATE] Fetched ${fetchedContent.length} chars from URL/Metadata.`);
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


module.exports = router;

