'use strict';

/* ═══════════════════════════════════════════════════════════════
   SABLE — Extraordinary JS Controller
   - Custom cursor tracking
   - 3D card tilt via mousemove
   - Magnetic buttons
   - SVG score ring animation
   - Scroll-reveal + stagger via IntersectionObserver
   - Counter animation for stats
   - All API endpoints wired up
═══════════════════════════════════════════════════════════════ */

const API_BASE     = '';
const POLL_MS      = 20_000;
const STORAGE_KEY  = 'sable_agent_id_v2';
const PERSONA      = { name: 'Sable', domain: 'AI Security' };

const CRITERIA_META = [
  { key: 'exploit_specificity',   label: 'Exploit Specificity',   weight: '30%' },
  { key: 'ai_security_relevance', label: 'AI Security Relevance', weight: '30%' },
  { key: 'practitioner_value',    label: 'Practitioner Value',    weight: '20%' },
  { key: 'technical_rigor',       label: 'Technical Rigor',       weight: '20%' },
];

let agentId      = null;
let pollTimer    = null;
let isRefreshing = false;

// ── Boot ──────────────────────────────────────────────────────
async function boot() {
  initCursor();
  initScrollReveal();
  initMagnetic();
  initCardTilt();

  agentId = localStorage.getItem(STORAGE_KEY);
  setStatus('loading', 'Connecting to agent…');

  if (!agentId) {
    agentId = await initAgent();
    if (!agentId) { setStatus('error', 'Connection failed'); return; }
    localStorage.setItem(STORAGE_KEY, agentId);
  }

  setStatus('online', `agent/${agentId.slice(0, 8)}…`);
  el('hero-agent-id').textContent = agentId.slice(0, 8) + '…';

  await Promise.all([ loadFeed(true), loadStats(), loadRejections() ]);
  pollTimer = setInterval(() => { loadFeed(false); loadStats(); }, POLL_MS);
}

// ── Init ──────────────────────────────────────────────────────
async function initAgent() {
  try {
    const data = await post('/api/agent/init', { persona: PERSONA });
    return data.agentId || null;
  } catch(e) { console.error('[SABLE] init failed', e); return null; }
}

// ── Feed ──────────────────────────────────────────────────────
async function loadFeed(showSpinner = true) {
  if (isRefreshing) return;
  isRefreshing = true;
  if (showSpinner) { setFeedState('loading'); setRefreshSpin(true); }

  try {
    const data  = await get(`/api/agent/feed?agentId=${agentId}`);
    const posts = data.posts || [];
    el('last-updated').textContent = 'Updated ' + nowTime();
    if (posts.length === 0) { setFeedState('empty'); }
    else { renderPosts(posts); setFeedState('posts'); }
  } catch(e) {
    setFeedState('empty');
  } finally {
    isRefreshing = false;
    setRefreshSpin(false);
  }
}

function renderPosts(posts) {
  const grid = el('feed-posts');
  grid.innerHTML = '';
  posts.forEach((post) => {
    const card = document.createElement('article');
    card.className = 'post-card stagger';
    const src  = (post.sources || [])[0] || null;
    const host = src ? (() => { try { return new URL(src).hostname.replace('www.',''); } catch { return src; } })() : null;
    const tags = (post.topicTags || []).slice(0, 3);
    card.innerHTML = `
      <div class="post-meta">
        <span class="post-time">${fmtDate(post.createdAt)}</span>
        ${post.isMock ? '<span class="post-badge">Mock</span>' : ''}
      </div>
      <p class="post-text">${esc(post.text)}</p>
      <div class="post-footer">
        <div class="post-tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>
        <div style="display:flex;align-items:center;gap:10px">
          ${src ? `<a class="post-source-link" href="${esc(src)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(host)}</a>` : ''}
          <button class="read-more-btn">Read more</button>
        </div>
      </div>
    `;
    const open = () => openPostModal(post);
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => { if(e.key === 'Enter') open(); });
    card.querySelector('.read-more-btn').addEventListener('click', e => { e.stopPropagation(); open(); });
    grid.appendChild(card);
  });

  // Re-apply scroll reveal to new cards
  setTimeout(() => {
    grid.querySelectorAll('.stagger').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 60);
    });
  }, 50);

  // Re-apply 3D tilt to new cards
  grid.querySelectorAll('.post-card').forEach(applyCardTilt);
}

function setFeedState(state) {
  el('feed-loading').style.display = state === 'loading' ? '' : 'none';
  el('feed-empty').style.display   = state === 'empty'   ? '' : 'none';
  el('feed-posts').style.display   = state === 'posts'   ? '' : 'none';
}

// ── Stats ─────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await get(`/api/agent/stats?agentId=${agentId}`);
    animateCounter(el('stat-total'),    d.total_posts      ?? 0);
    animateCounter(el('stat-real'),     d.real_llm_posts   ?? 0);
    animateCounter(el('stat-rejected'), d.total_rejected   ?? 0);
    el('stat-scheduler').textContent  = d.scheduler_status === 'running' ? '● running' : (d.scheduler_status || '—');
    el('stat-last-cycle').textContent = d.last_cycle_at ? fmtDate(d.last_cycle_at) : '—';
    // Hero stats
    animateCounter(el('hero-stat-posts'),    d.total_posts    ?? 0);
    animateCounter(el('hero-stat-rejected'), d.total_rejected ?? 0);
    el('hero-scheduler-status').textContent = d.scheduler_status === 'running' ? 'Scheduler: running' : (d.scheduler_status || '—');
  } catch(e) { /* silent */ }
}

function animateCounter(elRef, target) {
  if (!elRef || isNaN(target)) return;
  const current = parseInt(elRef.textContent) || 0;
  if (current === target) return;
  const duration = 800;
  const start    = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    elRef.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Rejections ────────────────────────────────────────────────
async function loadRejections() {
  el('rejections-loading').style.display = '';
  el('rejections-list').style.display    = 'none';
  el('rejections-empty').style.display   = 'none';
  try {
    const rows = await get(`/api/agent/rejections?agentId=${agentId}`);
    el('rejections-loading').style.display = 'none';
    if (!rows || rows.length === 0) { el('rejections-empty').style.display = ''; return; }
    const list = el('rejections-list');
    list.innerHTML = '';
    rows.slice(0, 15).forEach(r => {
      const item = document.createElement('div');
      item.className = 'rejection-item';
      item.innerHTML = `
        <div class="rejection-title">${esc(r.title || 'Untitled')}</div>
        <div class="rejection-meta">
          <span class="rejection-score">Score: ${r.score ?? '?'}/10</span>
          <span class="rejection-reason">${esc(r.reason || '')}</span>
        </div>`;
      list.appendChild(item);
    });
    list.style.display = '';
  } catch(e) {
    el('rejections-loading').innerHTML = '<p class="intel-muted">Could not load rejection log.</p>';
  }
}

// ── Editorial Console Simulation ──────────────────────────────
async function runSimulation() {
  const title   = el('sim-title').value.trim();
  const url     = el('sim-url').value.trim();
  const snippet = el('sim-abstract').value.trim();
  if (!title) { el('sim-title').focus(); return; }

  const btn = el('btn-simulate');
  btn.disabled = true;
  el('sim-btn-text').style.display    = 'none';
  el('sim-btn-loading').style.display = '';
  el('sim-result').style.display      = 'none';

  try {
    const data = await post('/api/agent/simulate', {
      title,
      url:     url     || undefined,
      snippet: snippet || undefined,
    });
    renderSimResult(data, url);
    if (data.verdict === 'accept') {
      setTimeout(() => loadFeed(false), 1500);
      await loadStats();
    }
  } catch(e) {
    renderSimError(e.message || 'Evaluation failed');
  } finally {
    btn.disabled = false;
    el('sim-btn-text').style.display    = '';
    el('sim-btn-loading').style.display = 'none';
  }
}

function renderSimResult(data, fallbackUrl) {
  const verdict  = data.verdict || 'reject';
  const score    = typeof data.score === 'number' ? data.score : 0;
  const scoreStr = score.toFixed(1);
  const criteria = data.criteria || {};
  const reason   = data.reason   || '';
  const srcUrl   = data.resolvedUrl || fallbackUrl || '';

  // Verdict
  el('sim-verdict-icon').textContent = verdict === 'accept' ? '✓' : '✗';
  const vtxt = el('sim-verdict-text');
  vtxt.className = `sim-verdict-text ${verdict}`;
  vtxt.textContent = verdict === 'accept' ? 'ACCEPTED' : 'REJECTED';

  // Score number
  el('sim-score-number').textContent = scoreStr;

  // SVG ring animation
  const circle = el('score-circle');
  const circumference = 327;
  const offset = circumference - (score / 10) * circumference;
  setTimeout(() => { circle.style.strokeDashoffset = offset; }, 100);

  // Criteria bars
  const barsEl = el('criteria-bars');
  barsEl.innerHTML = '';
  CRITERIA_META.forEach(c => {
    const val = criteria[c.key];
    const pct = val != null ? Math.round((val / 10) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'crit-row';
    row.innerHTML = `
      <div class="crit-header">
        <span class="crit-name">${esc(c.label)}</span>
        <span class="crit-score">${val != null ? val + '/10' : '—'}</span>
      </div>
      <div class="crit-track">
        <div class="crit-fill" style="width:0%" data-target="${pct}"></div>
      </div>
      <div class="crit-weight">${c.weight} weight</div>
    `;
    barsEl.appendChild(row);
  });

  // Animate bars after next frame
  requestAnimationFrame(() => requestAnimationFrame(() => {
    barsEl.querySelectorAll('.crit-fill').forEach(f => {
      f.style.width = f.dataset.target + '%';
    });
  }));

  // Source link
  const srcLink = el('sim-source-link');
  if (srcUrl) {
    srcLink.href = srcUrl;
    srcLink.textContent = '↗ ' + (srcUrl.length > 60 ? srcUrl.substring(0, 60) + '…' : srcUrl);
    srcLink.style.display = '';
  } else {
    srcLink.style.display = 'none';
  }

  // Reason
  el('sim-reason-text').textContent = reason;

  // Post (if accepted)
  const ps = el('sim-post-section');
  if (verdict === 'accept' && data.post) {
    el('sim-generated-post').textContent = data.post.text || '';
    el('sim-post-tags').innerHTML = (data.post.topicTags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    const sources = data.post.sources || [];
    el('sim-post-source').innerHTML = sources.length
      ? `<a href="${esc(sources[0])}" target="_blank" rel="noopener">↗ Source</a>`
      : '';
    ps.style.display = '';
  } else {
    ps.style.display = 'none';
  }

  // Show + scroll
  el('sim-result').style.display = '';
  setTimeout(() => el('sim-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
}

function renderSimError(msg) {
  el('sim-verdict-icon').textContent = '⚠';
  el('sim-verdict-text').className   = 'sim-verdict-text reject';
  el('sim-verdict-text').textContent = 'ERROR';
  el('sim-score-number').textContent = '—';
  el('criteria-bars').innerHTML      = '';
  el('sim-source-link').style.display = 'none';
  el('sim-reason-text').textContent  = msg;
  el('sim-post-section').style.display = 'none';
  el('sim-result').style.display     = '';
}

// ── Post Modal ────────────────────────────────────────────────
function openPostModal(post) {
  const sources = post.sources || [];
  const tags    = post.topicTags || [];
  el('modal-content').innerHTML = `
    <span class="modal-time">${fmtDate(post.createdAt)}${post.isMock ? ' · Mock' : ''}</span>
    <div class="post-tags" style="margin-bottom:18px">
      ${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}
    </div>
    <p class="modal-post-text">${esc(post.text)}</p>
    ${post.rationale ? `
    <div class="modal-sec-label">Editorial Rationale</div>
    <p class="modal-rationale-text">${esc(post.rationale)}</p>` : ''}
    ${sources.length ? `
    <div class="modal-sec-label">Sources</div>
    <div class="modal-sources">
      ${sources.map(s => {
        let host = s;
        try { host = new URL(s).hostname.replace('www.',''); } catch {}
        return `<a class="modal-source-link" href="${esc(s)}" target="_blank" rel="noopener">
          <span class="modal-source-arrow">↗</span>
          <span>${esc(host)} — ${esc(s)}</span>
        </a>`;
      }).join('')}
    </div>` : ''}
  `;
  el('post-modal').style.display = 'flex';
  el('post-modal').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  el('post-modal').style.display = 'none';
  el('post-modal').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ── Custom Cursor ─────────────────────────────────────────────
function initCursor() {
  const cursor = el('cursor');
  const dot    = el('cursor-dot');
  let cx = 0, cy = 0;

  document.addEventListener('mousemove', e => {
    cx = e.clientX; cy = e.clientY;
    dot.style.left    = cx + 'px';
    dot.style.top     = cy + 'px';
    cursor.style.left = cx + 'px';
    cursor.style.top  = cy + 'px';
  });

  document.addEventListener('mousedown', () => cursor.style.transform = 'translate(-50%,-50%) scale(0.8)');
  document.addEventListener('mouseup',   () => cursor.style.transform = 'translate(-50%,-50%) scale(1)');
}

// ── 3D Card Tilt ──────────────────────────────────────────────
function initCardTilt() {
  document.querySelectorAll('.post-card, .live-stat-card, .criteria-card').forEach(applyCardTilt);
}

function applyCardTilt(card) {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width  - 0.5) * 12;
    const y = ((e.clientY - rect.top)  / rect.height - 0.5) * -12;
    card.style.transform = `perspective(1000px) rotateX(${y}deg) rotateY(${x}deg) translateZ(6px)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.transition = 'transform 500ms var(--ease-out-expo), background 200ms, border-color 200ms, box-shadow 300ms';
    setTimeout(() => { card.style.transition = ''; }, 500);
  });
}

// ── Magnetic Buttons ──────────────────────────────────────────
function initMagnetic() {
  document.querySelectorAll('[data-magnetic]').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const rect = btn.getBoundingClientRect();
      const dx = (e.clientX - rect.left - rect.width  / 2) * 0.35;
      const dy = (e.clientY - rect.top  - rect.height / 2) * 0.35;
      btn.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.transition = 'transform 500ms var(--ease-out-back), box-shadow 0.3s ease';
      setTimeout(() => { btn.style.transition = ''; }, 500);
    });
  });
}

// ── Scroll Reveal ─────────────────────────────────────────────
function initScrollReveal() {
  const sectionObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Trigger stagger children
        entry.target.querySelectorAll('.stagger').forEach((el, i) => {
          setTimeout(() => el.classList.add('visible'), i * 70);
        });
        sectionObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.reveal-section').forEach(s => sectionObs.observe(s));
}

// ── Events ────────────────────────────────────────────────────
function wireEvents() {
  el('btn-refresh').addEventListener('click', () => loadFeed(true));
  el('btn-refresh-feed').addEventListener('click', () => loadFeed(true));
  el('btn-refresh-empty').addEventListener('click', () => loadFeed(true));

  el('btn-stats-refresh').addEventListener('click', async () => {
    el('btn-stats-refresh').classList.add('spinning');
    await loadStats();
    el('btn-stats-refresh').classList.remove('spinning');
  });

  el('btn-rejections-refresh').addEventListener('click', async () => {
    el('btn-rejections-refresh').classList.add('spinning');
    await loadRejections();
    el('btn-rejections-refresh').classList.remove('spinning');
  });

  el('btn-simulate').addEventListener('click', runSimulation);
  el('sim-title').addEventListener('keydown', e => { if (e.key === 'Enter') runSimulation(); });
  el('sim-url').addEventListener('keydown',   e => { if (e.key === 'Enter') runSimulation(); });

  el('modal-close').addEventListener('click', closeModal);
  el('post-modal').addEventListener('click', e => { if (e.target === el('post-modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── Helpers ───────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  } catch { return iso; }
}

function pad(n) { return String(n).padStart(2, '0'); }

function setStatus(state, text) {
  el('status-dot').className = `status-dot ${state}`;
  el('status-text').textContent = text;
}

function setRefreshSpin(on) {
  el('refresh-icon').classList.toggle('spinning', on);
}

async function get(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ── Start ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  boot();
});
