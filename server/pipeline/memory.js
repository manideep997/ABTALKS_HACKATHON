'use strict';

const { getDb } = require('../db/database');

/**
 * Retrieve the rolling memory context of the last ~10 published posts for the agent.
 * Used by the writer LLM call to avoid repetition and ensure variety.
 * @param {string} agentId
 * @returns {Array<{text: string, topicTags: Array<string>}>}
 */
function getRollingMemory(agentId = 'sable') {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT text, topic_tags_json
      FROM posts
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(agentId);

    return rows.map(row => {
      let topicTags = [];
      try {
        topicTags = JSON.parse(row.topic_tags_json || '[]');
      } catch (_e) {
        // Fallback for invalid JSON formatting
      }
      return {
        text: row.text,
        topicTags,
      };
    });
  } catch (err) {
    console.error(`[MEMORY ERROR] Failed to fetch rolling memory: ${err.message}`);
    return [];
  }
}

module.exports = { getRollingMemory };
