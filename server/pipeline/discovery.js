'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { getDb } = require('../db/database');

/**
 * Generate a fuzzy fingerprint from a title for deduplication.
 * Lowercase, strip non-alphanumeric, collapse spaces.
 */
function createFingerprint(title) {
  const normalized = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Fetch candidate topics from Hacker News Algolia API (No API key required)
 */
async function fetchHackerNews() {
  try {
    const url = 'https://hn.algolia.com/api/v1/search?query=(jailbreak+OR+prompt+injection+OR+LLM+security+OR+RAG+security)&tags=story&numericFilters=created_at_i>0';
    const response = await axios.get(url, { timeout: 8000 });
    const hits = (response.data && response.data.hits) || [];

    const candidates = [];
    for (const hit of hits) {
      const itemUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const title = hit.title || '';
      if (!title) continue;

      candidates.push({
        title: title.trim(),
        url: itemUrl,
        snippet: hit.story_text ? hit.story_text.substring(0, 300) : `HN points: ${hit.points || 0}, comments: ${hit.num_comments || 0}`,
        source: 'HackerNews',
        publishedAt: hit.created_at || new Date().toISOString(),
      });
    }
    return candidates;
  } catch (err) {
    console.error(`[DISCOVERY WARN] HackerNews fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Fetch candidate topics from arXiv cs.CR / cs.AI API (No API key required)
 */
async function fetchArXiv() {
  try {
    const url = 'http://export.arxiv.org/api/query?search_query=(cat:cs.CR+OR+cat:cs.AI)+AND+(LLM+OR+adversarial+OR+prompt+injection+OR+RAG+OR+vulnerability)&sortBy=submittedDate&sortOrder=descending&max_results=20';
    const response = await axios.get(url, { timeout: 10000 });
    const xml = response.data || '';

    // Fast regex extraction of arXiv entry blocks
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    const candidates = [];

    for (const entryStr of entryMatches) {
      const titleMatch = entryStr.match(/<title>([\s\S]*?)<\/title>/);
      const idMatch = entryStr.match(/<id>([\s\S]*?)<\/id>/);
      const summaryMatch = entryStr.match(/<summary>([\s\S]*?)<\/summary>/);
      const publishedMatch = entryStr.match(/<published>([\s\S]*?)<\/published>/);

      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
      const rawUrl = idMatch ? idMatch[1].trim() : '';
      const snippet = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '';
      const publishedAt = publishedMatch ? publishedMatch[1].trim() : new Date().toISOString();

      if (!title || !rawUrl) continue;

      candidates.push({
        title,
        url: rawUrl,
        snippet: snippet + '...',
        source: 'arXiv',
        publishedAt,
      });
    }
    return candidates;
  } catch (err) {
    console.error(`[DISCOVERY WARN] arXiv fetch failed: ${err.message}`);
    return [];
  }
}

/**
 * Discover new candidate topics across live sources and deduplicate against seen_topics DB table.
 * @param {string} agentId - Persona agent ID (default 'sable')
 * @returns {Promise<Array<{title: string, url: string, snippet: string, source: string, publishedAt: string}>>}
 */
async function discover(agentId = 'sable') {
  console.log(`[DISCOVERY] Fetching live candidates for agent "${agentId}"...`);

  const [hnTopics, arxivTopics] = await Promise.all([
    fetchHackerNews(),
    fetchArXiv(),
  ]);

  const rawCandidates = [...hnTopics, ...arxivTopics];
  console.log(`[DISCOVERY] Fetched ${rawCandidates.length} total raw candidates (${hnTopics.length} HN, ${arxivTopics.length} arXiv).`);

  const db = getDb();
  const freshCandidates = [];

  for (const candidate of rawCandidates) {
    const fingerprint = createFingerprint(candidate.title);

    // 1. Check exact URL match
    const urlMatch = db.prepare('SELECT id FROM seen_topics WHERE agent_id = ? AND url = ?').get(agentId, candidate.url);
    if (urlMatch) {
      continue;
    }

    // 2. Check title fingerprint match
    const fpMatch = db.prepare('SELECT id FROM seen_topics WHERE agent_id = ? AND fingerprint = ?').get(agentId, fingerprint);
    if (fpMatch) {
      continue;
    }

    candidate.fingerprint = fingerprint;
    freshCandidates.push(candidate);
  }

  console.log(`[DISCOVERY] ${freshCandidates.length} new candidates remaining after deduplication.`);
  return freshCandidates;
}

/**
 * Mark a set of topics as seen in the database.
 * @param {string} agentId
 * @param {Array<{url: string, title: string, fingerprint?: string}>} topics
 */
function markTopicsSeen(agentId = 'sable', topics = []) {
  if (!topics || topics.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();

  for (const topic of topics) {
    const fingerprint = topic.fingerprint || createFingerprint(topic.title);
    const id = `seen_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    try {
      db.prepare(`
        INSERT INTO seen_topics (id, agent_id, url, title, fingerprint, first_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, agentId, topic.url, topic.title, fingerprint, now);
    } catch (_err) {
      // Ignore duplicate insert errors if already logged
    }
  }
}

module.exports = {
  discover,
  markTopicsSeen,
  fetchHackerNews,
  fetchArXiv,
  createFingerprint,
};
