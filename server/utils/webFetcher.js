'use strict';

const axios = require('axios');

// Simple in-memory cache to prevent re-fetching same URL/title within a session
const fetchCache = new Map();

/**
 * Production Universal Academic & Web Content Fetcher
 *
 * Priority chain (parallel where possible):
 *   1. CrossRef API        — best for doi.org / DOI links, zero rate-limit
 *   2. OpenAlex API        — free, no rate-limit, covers 200M+ academic works
 *   3. Semantic Scholar    — fallback for URL & title lookup
 *   4. Direct HTML scrape  — with og:description extraction
 *   5. DuckDuckGo HTML     — final fallback for any web page
 */
async function fetchWebContent(url, paperTitle = '') {
  const cacheKey = (url || '') + '::' + (paperTitle || '');
  if (fetchCache.has(cacheKey)) {
    console.log('[FETCHER] Cache hit — reusing previously fetched content.');
    return fetchCache.get(cacheKey);
  }

  let result = '';

  // ── Step 1: CrossRef for DOI-based URLs (no rate limit, authoritative) ───
  const doiMatch = (url || '').match(/10\.\d{4,}\/[^\s&?#"']+/);
  if (doiMatch || (url && url.includes('doi.org'))) {
    try {
      result = await fetchFromCrossRef(url || '', doiMatch ? doiMatch[0] : '');
      if (result) {
        console.log('[FETCHER] CrossRef API succeeded.');
        fetchCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.log(`[FETCHER] CrossRef failed: ${e.message}`);
    }
  }

  // ── Step 2: OpenAlex API — unlimited, covers nearly all academic papers ──
  // Run CrossRef and OpenAlex in parallel for speed
  const openAlexPromise = paperTitle ? fetchFromOpenAlex(paperTitle) : Promise.resolve(null);

  try {
    result = await openAlexPromise;
    if (result) {
      console.log('[FETCHER] OpenAlex API succeeded.');
      fetchCache.set(cacheKey, result);
      return result;
    }
  } catch (e) {
    console.log(`[FETCHER] OpenAlex failed: ${e.message}`);
  }

  // ── Step 3: Direct HTML scrape ───────────────────────────────────────────
  if (url && url.startsWith('http')) {
    try {
      const scraped = await scrapeDirectUrl(url);
      if (scraped && scraped.length > 200) {
        const blocked = /cloudflare|captcha|enable\s+cookies|forbidden|robot\s+check|access\s+denied|ddos/i.test(scraped.substring(0, 1200));
        if (!blocked) {
          console.log(`[FETCHER] Direct scrape succeeded: ${scraped.length} chars.`);
          fetchCache.set(cacheKey, scraped);
          return scraped;
        }
      }
    } catch (err) {
      console.log(`[FETCHER] Direct scrape failed: ${err.message}`);
    }
  }

  // ── Step 4: Semantic Scholar with retry ─────────────────────────────────
  if (paperTitle) {
    try {
      result = await retryWithBackoff(() => fetchByTitleSemanticScholar(paperTitle), 2, 1500);
      if (result) {
        console.log('[FETCHER] Semantic Scholar title search succeeded after retry.');
        fetchCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.log(`[FETCHER] Semantic Scholar title search exhausted: ${e.message}`);
    }
  }

  // ── Step 5: DuckDuckGo HTML snippets ────────────────────────────────────
  if (paperTitle) {
    try {
      result = await searchDuckDuckGo(paperTitle);
      if (result) {
        console.log('[FETCHER] DuckDuckGo search provided context snippets.');
        fetchCache.set(cacheKey, result);
        return result;
      }
    } catch (e) {
      console.log(`[FETCHER] DuckDuckGo fallback failed: ${e.message}`);
    }
  }

  fetchCache.set(cacheKey, '');
  return '';
}

// ── CrossRef API ─────────────────────────────────────────────────────────────
async function fetchFromCrossRef(url, rawDoi = '') {
  let doi = rawDoi;
  if (!doi) {
    const m = url.match(/10\.\d{4,}\/[^\s&?#"']+/);
    doi = m ? m[0] : '';
  }
  if (!doi && url.includes('doi.org/')) {
    doi = url.split('doi.org/')[1].split('?')[0].trim();
  }
  if (!doi) return null;

  const response = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    timeout: 7000,
    headers: { 'User-Agent': 'Sable-SecurityBot/1.0 (mailto:research@sable.ai)' }
  });

  const work = response.data?.message;
  if (!work || !work.title) return null;

  const title = Array.isArray(work.title) ? work.title[0] : work.title;
  const authors = Array.isArray(work.author)
    ? work.author.slice(0, 6).map(a => [a.given, a.family].filter(Boolean).join(' ')).join(', ')
    : 'Unknown';
  const abstract = work.abstract
    ? work.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  const venue = work['container-title']?.[0] || work.publisher || '';
  const year = work.issued?.['date-parts']?.[0]?.[0] || '';

  return [
    `Paper Title: ${title}`,
    authors ? `Authors: ${authors}` : '',
    venue ? `Published In: ${venue}` : '',
    year ? `Year: ${year}` : '',
    abstract ? `Abstract: ${abstract}` : '',
    work.subject ? `Subject Areas: ${work.subject.slice(0, 5).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

// ── OpenAlex API — 100% free, no rate limit, 200M+ papers ────────────────────
async function fetchFromOpenAlex(title) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1&select=title,abstract_inverted_index,authorships,publication_year,primary_location,open_access`;
  const response = await axios.get(url, {
    timeout: 7000,
    headers: {
      'User-Agent': 'Sable-SecurityBot/1.0 (mailto:research@sable.ai)',
      'Accept': 'application/json',
    }
  });

  const work = response.data?.results?.[0];
  if (!work) return null;

  // OpenAlex stores abstracts as inverted index — reconstruct it
  let abstract = '';
  if (work.abstract_inverted_index) {
    try {
      const wordPositions = [];
      for (const [word, positions] of Object.entries(work.abstract_inverted_index)) {
        for (const pos of positions) {
          wordPositions.push([pos, word]);
        }
      }
      wordPositions.sort((a, b) => a[0] - b[0]);
      abstract = wordPositions.map(([, word]) => word).join(' ');
    } catch (_) {
      abstract = '';
    }
  }

  const authors = Array.isArray(work.authorships)
    ? work.authorships.slice(0, 6).map(a => a.author?.display_name).filter(Boolean).join(', ')
    : '';
  const venue = work.primary_location?.source?.display_name || '';
  const year = work.publication_year || '';
  const paperTitle = work.title || '';

  if (!paperTitle && !abstract) return null;

  return [
    paperTitle ? `Paper Title: ${paperTitle}` : '',
    authors ? `Authors: ${authors}` : '',
    venue ? `Published In: ${venue}` : '',
    year ? `Year: ${year}` : '',
    abstract ? `Abstract: ${abstract}` : '',
  ].filter(Boolean).join('\n');
}

// ── Semantic Scholar Title Search ─────────────────────────────────────────────
async function fetchByTitleSemanticScholar(title) {
  const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=title,abstract,authors,year,venue`;
  const response = await axios.get(apiUrl, {
    timeout: 6000,
    headers: { 'User-Agent': 'Sable-SecurityBot/1.0' }
  });

  const data = response.data?.data?.[0];
  if (!data) return null;

  const authors = Array.isArray(data.authors) ? data.authors.slice(0, 6).map(a => a.name).join(', ') : '';
  return [
    `Paper Title: ${data.title}`,
    authors ? `Authors: ${authors}` : '',
    data.year ? `Year: ${data.year}` : '',
    data.venue ? `Venue: ${data.venue}` : '',
    data.abstract ? `Abstract: ${data.abstract}` : '',
  ].filter(Boolean).join('\n');
}

// ── Direct HTML Scrape ────────────────────────────────────────────────────────
async function scrapeDirectUrl(url) {
  if (/\/pdf\/|\.pdf(\?|$)/i.test(url)) return null;

  const isScienceDirect = /sciencedirect|elsevier/i.test(url);
  const response = await axios.get(url, {
    timeout: 7000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    maxContentLength: isScienceDirect ? 200_000 : 600_000,
    responseType: 'text',
  });

  const html = String(response.data || '');
  if (url.includes('arxiv.org')) return extractArxiv(html);
  return extractGeneric(html);
}

function extractArxiv(html) {
  const parts = [];
  const t = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) parts.push(`Paper Title: ${stripHtml(t[1]).replace(/^\[.*?\]\s*/, '').trim()}`);
  const a = html.match(/<div[^>]*class="[^"]*authors[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (a) parts.push(`Authors: ${stripHtml(a[1]).trim()}`);
  const abs = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (abs) parts.push(`Abstract: ${stripHtml(abs[1]).replace(/^Abstract:\s*/i, '').trim()}`);
  return parts.join('\n\n') || null;
}

function extractGeneric(html) {
  // Try og:description or meta description first (fastest & most accurate)
  const ogDesc = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]{100,})"/i);
  if (ogDesc) {
    const ogTitle = html.match(/<meta[^>]+(?:property="og:title"|name="title")[^>]+content="([^"]{10,})"/i);
    const parts = [];
    if (ogTitle) parts.push(`Paper Title: ${ogTitle[1].trim()}`);
    parts.push(`Abstract/Summary: ${ogDesc[1].trim()}`);
    return parts.join('\n') || null;
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
    .trim()
    .substring(0, 3500);
  return text || null;
}

// ── DuckDuckGo HTML snippets ──────────────────────────────────────────────────
async function searchDuckDuckGo(query) {
  const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' abstract')}`, {
    timeout: 6000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      'Accept': 'text/html,application/xhtml+xml',
    }
  });

  const html = String(response.data || '');
  const snippets = [];
  const matches = html.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g) || [];
  for (const match of matches.slice(0, 5)) {
    const clean = stripHtml(match).trim();
    if (clean.length > 30) snippets.push(`- ${clean}`);
  }

  if (snippets.length === 0) return null;
  return `Web Context Snippets:\n${snippets.join('\n')}`;
}

// ── Retry with backoff ────────────────────────────────────────────────────────
async function retryWithBackoff(fn, retries = 2, delayMs = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.response?.status === 429;
      if (i < retries && is429) {
        const wait = delayMs * Math.pow(2, i);
        console.log(`[FETCHER] 429 rate-limit hit, retrying in ${wait}ms...`);
        await sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchWebContent };
