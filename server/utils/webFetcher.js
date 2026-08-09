'use strict';

const axios = require('axios');

/**
 * Resolve a paper title to a single canonical URL (prefer arxiv.org/abs/...).
 * Used by the title-only submission path in /simulate.
 * Returns null if no confident single match found.
 */
async function resolveTitleToUrl(title) {
  // 1. Try OpenAlex — returns open_access URLs and landing page
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1&select=title,ids,primary_location,open_access`;
    const resp = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Sable-SecurityBot/1.0' } });
    const work = resp.data?.results?.[0];
    if (work && titleSimilar(work.title || '', title)) {
      // Prefer arxiv URL
      const arxivId = work.ids?.arxiv;
      if (arxivId) {
        const cleanId = arxivId.replace('https://arxiv.org/abs/', '').replace('http://arxiv.org/abs/', '');
        return `https://arxiv.org/abs/${cleanId}`;
      }
      // Try open access URL
      const oaUrl = work.open_access?.oa_url;
      if (oaUrl && oaUrl.startsWith('http')) return oaUrl;
      // Try landing page
      const landing = work.primary_location?.landing_page_url;
      if (landing && landing.startsWith('http')) return landing;
    }
  } catch (e) {
    console.log(`[RESOLVER] OpenAlex resolve failed: ${e.message}`);
  }

  // 2. Try Semantic Scholar — returns externalIds.ArXiv
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=title,externalIds,url`;
    const resp = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Sable-SecurityBot/1.0' } });
    const paper = resp.data?.data?.[0];
    if (paper && titleSimilar(paper.title || '', title)) {
      const arxivId = paper.externalIds?.ArXiv;
      if (arxivId) return `https://arxiv.org/abs/${arxivId}`;
      if (paper.url && paper.url.startsWith('http')) return paper.url;
    }
  } catch (e) {
    console.log(`[RESOLVER] Semantic Scholar resolve failed: ${e.message}`);
  }

  return null;
}

/**
 * ROOT CAUSE OF PREVIOUS BUG:
 * OpenAlex title-search was running BEFORE direct URL scraping.
 * OpenAlex's fuzzy search returned PaLM for the GCG paper query
 * because keyword overlap ("language models") ranked PaLM higher.
 * That wrong result was cached and fed to the judgment engine.
 *
 * FIX: Direct URL scraping now runs FIRST for all non-DOI URLs.
 * Title-based API searches (OpenAlex, Semantic Scholar) only run
 * as a fallback when no URL is provided OR direct scraping fails.
 * A title-similarity guard prevents accepting obviously wrong results.
 *
 * Correct priority chain:
 *   1. CrossRef     — doi.org / DOI patterns (exact, authoritative)
 *   2. Direct scrape — fetch the EXACT submitted URL first
 *   3. OpenAlex     — title search only as fallback, with similarity check
 *   4. Semantic Scholar — title search with retry + similarity check
 *   5. DuckDuckGo   — last resort snippets
 */

// Session-scoped cache — keyed by url+title, cleared on server restart
const fetchCache = new Map();

async function fetchWebContent(url, paperTitle = '') {
  const cacheKey = `${url || ''}::${paperTitle || ''}`;
  if (fetchCache.has(cacheKey)) {
    console.log('[FETCHER] Cache hit — returning previously fetched content.');
    return fetchCache.get(cacheKey);
  }

  let result = '';

  // ── 1. CrossRef for DOI-based URLs (authoritative, deterministic) ────────
  const doiMatch = (url || '').match(/10\.\d{4,}\/[^\s&?#"']+/);
  const isDOI = doiMatch || (url && url.includes('doi.org'));
  if (isDOI) {
    try {
      result = await fetchFromCrossRef(url || '', doiMatch ? doiMatch[0] : '');
      if (result) {
        console.log('[FETCHER] CrossRef API returned metadata for DOI.');
        return cache(cacheKey, result);
      }
    } catch (e) {
      console.log(`[FETCHER] CrossRef failed: ${e.message}`);
    }
  }

  // ── 2. Direct URL scrape — ALWAYS try before any title-based API ─────────
  // This is the most deterministic: fetches exactly what the user submitted.
  if (url && url.startsWith('http') && !isDOI) {
    try {
      const scraped = await scrapeDirectUrl(url);
      if (scraped && scraped.length > 150) {
        const blocked = /cloudflare|captcha|enable\s+cookies|forbidden|robot\s+check|access\s+denied|ddos/i.test(scraped.substring(0, 1200));
        if (!blocked) {
          console.log(`[FETCHER] Direct scrape of URL succeeded: ${scraped.length} chars.`);
          return cache(cacheKey, scraped);
        }
        console.log('[FETCHER] Direct scrape returned bot-challenge page. Falling back to APIs.');
      }
    } catch (err) {
      console.log(`[FETCHER] Direct scrape failed: ${err.message}`);
    }
  }

  // ── 3. OpenAlex title search — fallback only, with similarity guard ───────
  if (paperTitle && paperTitle.trim()) {
    try {
      const opResult = await fetchFromOpenAlex(paperTitle);
      if (opResult && titleSimilar(opResult, paperTitle)) {
        console.log('[FETCHER] OpenAlex title search found matching paper.');
        return cache(cacheKey, opResult);
      } else if (opResult) {
        console.log('[FETCHER] OpenAlex returned a different paper — discarding to prevent wrong-paper bug.');
      }
    } catch (e) {
      console.log(`[FETCHER] OpenAlex failed: ${e.message}`);
    }
  }

  // ── 4. Semantic Scholar title search with backoff ─────────────────────────
  if (paperTitle && paperTitle.trim()) {
    try {
      const s2Result = await retryWithBackoff(() => fetchByTitleSemanticScholar(paperTitle), 2, 1200);
      if (s2Result && titleSimilar(s2Result, paperTitle)) {
        console.log('[FETCHER] Semantic Scholar title search found matching paper.');
        return cache(cacheKey, s2Result);
      } else if (s2Result) {
        console.log('[FETCHER] Semantic Scholar returned a different paper — discarding.');
      }
    } catch (e) {
      console.log(`[FETCHER] Semantic Scholar exhausted: ${e.message}`);
    }
  }

  // ── 5. DuckDuckGo HTML snippets — last resort ─────────────────────────────
  if (paperTitle && paperTitle.trim()) {
    try {
      const ddgResult = await searchDuckDuckGo(paperTitle);
      if (ddgResult) {
        console.log('[FETCHER] DuckDuckGo provided search snippets as context.');
        return cache(cacheKey, ddgResult);
      }
    } catch (e) {
      console.log(`[FETCHER] DuckDuckGo failed: ${e.message}`);
    }
  }

  return cache(cacheKey, '');
}

// ── Title similarity guard ────────────────────────────────────────────────────
// Prevents accepting an API result that describes a completely different paper.
// Checks if at least 40% of significant words from the query title appear in the result.
function titleSimilar(resultText, queryTitle) {
  if (!queryTitle || !resultText) return false;
  const stopWords = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'via', 'with', 'is', 'are', 'by']);
  const queryWords = queryTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  if (queryWords.length === 0) return true;
  const resultLower = resultText.toLowerCase();
  const matchCount = queryWords.filter(w => resultLower.includes(w)).length;
  const ratio = matchCount / queryWords.length;
  console.log(`[FETCHER] Title similarity check: ${matchCount}/${queryWords.length} words matched (${(ratio * 100).toFixed(0)}%).`);
  return ratio >= 0.40;
}

// ── CrossRef API (doi.org links) ──────────────────────────────────────────────
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
    : '';
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
    work.subject ? `Subject Areas: ${work.subject.slice(0, 4).join(', ')}` : '',
  ].filter(Boolean).join('\n') || null;
}

// ── Direct HTML scrape ────────────────────────────────────────────────────────
async function scrapeDirectUrl(url) {
  if (/\/pdf\/|\.pdf(\?|$)/i.test(url)) {
    return null; // Skip PDFs — return null to allow fallback to APIs
  }

  const isScienceDirect = /sciencedirect|elsevier/i.test(url);
  const response = await axios.get(url, {
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'DNT': '1',
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
  const t = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) parts.push(`Paper Title: ${stripHtml(t[1]).replace(/^\[.*?\]\s*/, '').trim()}`);
  const a = html.match(/<div[^>]*class="[^"]*authors[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (a) parts.push(`Authors: ${stripHtml(a[1]).trim()}`);
  const abs = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (abs) parts.push(`Abstract: ${stripHtml(abs[1]).replace(/^Abstract:\s*/i, '').trim()}`);
  return parts.join('\n\n') || null;
}

function extractGeneric(html) {
  // og:description is often the abstract on academic sites — try first
  const ogDesc = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]{80,})"/i);
  if (ogDesc) {
    const ogTitle = html.match(/<meta[^>]+(?:property="og:title"|name="title")[^>]+content="([^"]{10,})"/i);
    return [
      ogTitle ? `Paper Title: ${ogTitle[1].trim()}` : '',
      `Abstract/Summary: ${ogDesc[1].trim()}`,
    ].filter(Boolean).join('\n') || null;
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

// ── OpenAlex title search ─────────────────────────────────────────────────────
async function fetchFromOpenAlex(title) {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1&select=title,abstract_inverted_index,authorships,publication_year,primary_location`;
  const response = await axios.get(url, {
    timeout: 7000,
    headers: { 'User-Agent': 'Sable-SecurityBot/1.0 (mailto:research@sable.ai)' }
  });

  const work = response.data?.results?.[0];
  if (!work) return null;

  let abstract = '';
  if (work.abstract_inverted_index) {
    try {
      const wordPositions = [];
      for (const [word, positions] of Object.entries(work.abstract_inverted_index)) {
        for (const pos of positions) wordPositions.push([pos, word]);
      }
      wordPositions.sort((a, b) => a[0] - b[0]);
      abstract = wordPositions.map(([, word]) => word).join(' ');
    } catch (_) {}
  }

  const authors = Array.isArray(work.authorships)
    ? work.authorships.slice(0, 6).map(a => a.author?.display_name).filter(Boolean).join(', ')
    : '';
  const venue = work.primary_location?.source?.display_name || '';
  const paperTitle = work.title || '';

  return [
    paperTitle ? `Paper Title: ${paperTitle}` : '',
    authors ? `Authors: ${authors}` : '',
    venue ? `Published In: ${venue}` : '',
    work.publication_year ? `Year: ${work.publication_year}` : '',
    abstract ? `Abstract: ${abstract}` : '',
  ].filter(Boolean).join('\n') || null;
}

// ── Semantic Scholar title search ─────────────────────────────────────────────
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
  ].filter(Boolean).join('\n') || null;
}

// ── DuckDuckGo HTML snippets ──────────────────────────────────────────────────
async function searchDuckDuckGo(query) {
  const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' abstract research paper')}`, {
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

  return snippets.length > 0
    ? `Web Search Snippets for "${query}":\n${snippets.join('\n')}`
    : null;
}

// ── Retry with exponential backoff ────────────────────────────────────────────
async function retryWithBackoff(fn, retries = 2, delayMs = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.response?.status === 429;
      if (i < retries && is429) {
        const wait = delayMs * Math.pow(2, i);
        console.log(`[FETCHER] 429 rate-limit, retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cache(key, value) {
  fetchCache.set(key, value);
  return value;
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { fetchWebContent, resolveTitleToUrl };
