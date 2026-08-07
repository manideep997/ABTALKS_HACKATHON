/**
 * server.js – minimal Express API with in‑process scheduler
 * ---------------------------------------------------------
 *  - POST /api/agent/init   : creates agent row, starts scheduler, runs first cycle
 *  - GET  /api/agent/feed?agentId=:id : read‑only feed of stored posts
 *  - POST /api/agent/tick   : internal endpoint (optional external‑cron trigger)
 *
 *  All heavy lifting lives in ./services/* (discovery, judgment, writer, store).
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { initAgent, startScheduler, runCycle estrator');

const app = express();
app.use(express.json()); // parse JSON bodies

const PORT = process.env.PORT || 3000;
const AGENT_ID = process.env.AGENT_ID || 'ag

// ---------- API Routes ----------
app.post('/api/agent/init', async (req, res) => {
  try {
    // Ensure agent row exists & (re)start scheduler
    await initAgent(AGENT_ID);
    startScheduler(AGENT_ID);
    // Run an immediate cycle so the feed is
    await runCycle(AGENT_ID);
    res.json({ status: 'initialized', agentI
  } catch (err) {
    console.error('Init error:', err);
    res.status(500).json({ error: 'Failed to initialize agent' });
  }
});

app.get('/api/agent/feed', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  try {
    const posts = require('./services/store').getFeed(agentId);
    res.json({ agentId, posts });
  } catch (e) {
    console.error('Feed error:', e);
    res.status(500).json({ error: 'Unable to fetch feed' });
  }
});

/* Optional: expose a tick endpoint for external cron (e.g., cron-job.org) */
app.post('/api/agent/tick', async (req, res)
  try {
    await runCycle(AGENT_ID);
    res.json({ status: 'tick completed' });
  } catch (err) {
    console.error('Tick error:', err);
    res.status(500).json({ error: 'Tick fail
  }
});

// ---------- Health check ----------
app.get('/', (req, res) => res.send('Abtalks Agent is running'));

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`   Init endpoint: POST http://init`);
  console.log(`   Feed endpoint: GET  http://localhost:${PORT}/api/agent/feed?agentId=${AGENT_ID}`);
});