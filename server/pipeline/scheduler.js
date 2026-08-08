'use strict';

const cron = require('node-cron');
const config = require('../config');
const { discover, markTopicsSeen } = require('./discovery');
const { judgeCandidates } = require('./judgment');
const { getRollingMemory } = require('./memory');
const { generatePost } = require('./writer');

// Shared concurrency lock & telemetry state
let isCycleRunning = false;
let schedulerStatus = 'running'; // 'running', 'blocked_no_key', 'rate_limited', 'error'
let lastCycleAt = null;
let lastCycleResult = null; // 'posted', 'rejected_all', 'skipped_blocked', 'skipped_rate_limited', 'skipped_no_candidates', 'failed_error'
let cronJob = null;

// Determine initial scheduler status based on environment
if (!config.ALLOW_MOCK_MODE && (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY.includes('placeholder'))) {
  schedulerStatus = 'blocked_no_key';
}

/**
 * Execute one full autonomous cycle (discover -> judge -> write -> store)
 * @param {string} agentId
 * @returns {Promise<{success: boolean, result: string, post?: Object, error?: string}>}
 */
async function runCycle(agentId = 'sable') {
  if (isCycleRunning) {
    console.log('[SCHEDULER] Cycle skipped: another execution is currently in progress.');
    return { success: false, result: 'skipped_concurrency' };
  }

  isCycleRunning = true;
  lastCycleAt = new Date().toISOString();

  // Validate API key status before launching requests
  if (!config.ALLOW_MOCK_MODE && (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY.includes('placeholder'))) {
    schedulerStatus = 'blocked_no_key';
    lastCycleResult = 'skipped_blocked';
    isCycleRunning = false;
    console.warn('[SCHEDULER] Cycle blocked: OPENROUTER_API_KEY is missing or invalid.');
    return { success: false, result: 'skipped_blocked' };
  }

  // Restore status to running if key issues resolved
  if (schedulerStatus === 'blocked_no_key') {
    schedulerStatus = 'running';
  }

  console.log(`[SCHEDULER] Starting cycle at ${lastCycleAt} for agent "${agentId}"...`);

  try {
    // 1. Discover candidates
    const candidates = await discover(agentId);
    if (!candidates || candidates.length === 0) {
      console.log('[SCHEDULER] Cycle complete: no fresh candidate topics found.');
      lastCycleResult = 'skipped_no_candidates';
      isCycleRunning = false;
      return { success: true, result: 'skipped_no_candidates' };
    }

    // 2. Editorial Judgment
    // Limit to batch size of 5 to preserve free tier quota
    const batch = candidates.slice(0, 5);
    const judgmentResponse = await judgeCandidates(batch, agentId);

    if (!judgmentResponse.success) {
      if (judgmentResponse.rateLimited) {
        schedulerStatus = 'rate_limited';
        lastCycleResult = 'skipped_rate_limited';
      } else {
        schedulerStatus = 'error';
        lastCycleResult = 'failed_error';
      }
      isCycleRunning = false;
      return { success: false, result: lastCycleResult, error: judgmentResponse.error };
    }

    // Mark evaluated candidates as seen in SQLite seen_topics table
    markTopicsSeen(agentId, batch);

    // 3. Select accepted candidates
    const accepted = judgmentResponse.judgments.filter(j => j.verdict === 'accept');
    if (accepted.length === 0) {
      console.log('[SCHEDULER] Cycle complete: all candidates rejected by editorial judgment.');
      lastCycleResult = 'rejected_all';
      isCycleRunning = false;
      return { success: true, result: 'rejected_all' };
    }

    // Sort by highest score descending
    accepted.sort((a, b) => b.score - a.score);
    const topCandidate = accepted[0].candidate;

    // 4. Generate post & memory update
    const memory = getRollingMemory(agentId);
    const writerResponse = await generatePost(topCandidate, memory, agentId);

    if (!writerResponse.success) {
      if (writerResponse.rateLimited) {
        schedulerStatus = 'rate_limited';
        lastCycleResult = 'skipped_rate_limited';
      } else {
        schedulerStatus = 'error';
        lastCycleResult = 'failed_error';
      }
      isCycleRunning = false;
      return { success: false, result: lastCycleResult, error: writerResponse.error };
    }

    // Successfully posted
    schedulerStatus = 'running';
    lastCycleResult = 'posted';
    isCycleRunning = false;
    return { success: true, result: 'posted', post: writerResponse.post };

  } catch (err) {
    console.error(`[SCHEDULER ERROR] Unexpected pipeline error: ${err.message}`);
    schedulerStatus = 'error';
    lastCycleResult = 'failed_error';
    isCycleRunning = false;
    return { success: false, result: 'failed_error', error: err.message };
  }
}

/**
 * Initialize and start the in-process background scheduler.
 */
function startScheduler(agentId = 'sable') {
  if (cronJob) {
    console.log('[SCHEDULER] Scheduler is already active.');
    return;
  }

  console.log(`[SCHEDULER] Registering in-process cron job with schedule: ${config.CRON_SCHEDULE}`);
  cronJob = cron.schedule(config.CRON_SCHEDULE, () => {
    console.log('[SCHEDULER] Cron tick triggered.');
    runCycle(agentId).catch(err => {
      console.error('[SCHEDULER] Background run cycle failed:', err);
    });
  });
}

/**
 * Stop the background scheduler.
 */
function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[SCHEDULER] Scheduler stopped.');
  }
}

function getSchedulerState() {
  return {
    isCycleRunning,
    schedulerStatus,
    lastCycleAt,
    lastCycleResult,
  };
}

module.exports = {
  runCycle,
  startScheduler,
  stopScheduler,
  getSchedulerState,
};
