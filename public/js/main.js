'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM refs ─────────────────────────────────────────────────────────────
  const agentDot      = document.getElementById('agent-dot');
  const pillStatus    = document.getElementById('pill-status');
  const pillPosts     = document.getElementById('pill-posts');
  const pillLast      = document.getElementById('pill-last');

  const statScheduler = document.getElementById('stat-scheduler');
  const statResult    = document.getElementById('stat-result');
  const statTotal     = document.getElementById('stat-total');
  const statReal      = document.getElementById('stat-real');
  const statMock      = document.getElementById('stat-mock');

  const btnInit       = document.getElementById('btn-init');
  const btnTick       = document.getElementById('btn-tick');

  const postsFeed     = document.getElementById('posts-feed');
  const rejList       = document.getElementById('rejections-list');
  const rejCount      = document.getElementById('rej-count');

  const simTitle      = document.getElementById('sim-title');
  const simSnippet    = document.getElementById('sim-snippet');
  const simUrl        = document.getElementById('sim-url');
  const btnSimulate   = document.getElementById('btn-simulate');
  const simResult     = document.getElementById('sim-result');

  // Preset buttons
  const presetAccept      = document.getElementById('preset-accept');
  const presetRejectMed   = document.getElementById('preset-reject-med');
  const presetRejectEth   = document.getElementById('preset-reject-ethics');

  // ── Dashboard refresh ────────────────────────────────────────────────────
  async function refresh() {
    const [feed, rejections, stats] = await Promise.all([
      Telemetry.getFeed(),
      Telemetry.getRejections(),
      Telemetry.getStats(),
    ]);

    renderStats(stats);
    renderFeed(feed ? feed.posts : []);
    renderRejections(rejections);
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  function renderStats(stats) {
    if (!stats) return;

    const running = stats.scheduler_status === 'running';
    const cycling = stats.is_cycle_running;

    // Topbar dot + pill
    agentDot.className = 'agent-dot' + (running ? ' online' : '');

    if (running) {
      pillStatus.textContent = cycling ? 'Executing cycle…' : 'Active';
      pillStatus.className   = 'stat-pill online';
    } else if (stats.scheduler_status === 'rate_limited') {
      pillStatus.textContent = 'Rate limited';
      pillStatus.className   = 'stat-pill';
    } else {
      pillStatus.textContent = stats.scheduler_status || 'Offline';
      pillStatus.className   = 'stat-pill';
    }

    pillPosts.textContent = `${stats.total_posts} post${stats.total_posts !== 1 ? 's' : ''}`;
    pillLast.textContent  = stats.last_cycle_at ? 'Last: ' + fmtTime(stats.last_cycle_at) : 'Never run';

    statScheduler.textContent = stats.scheduler_status || '—';
    statResult.textContent    = stats.last_cycle_result || '—';
    statTotal.textContent     = stats.total_posts;
    statReal.textContent      = stats.real_llm_posts;
    statMock.textContent      = stats.mock_posts;
  }

  // ── Posts Feed ───────────────────────────────────────────────────────────
  function renderFeed(posts) {
    if (!posts || posts.length === 0) {
      postsFeed.innerHTML = `<div class="empty-feed"><p>No posts yet. Click <strong>Initialize Agent</strong> to run the first cycle.</p></div>`;
      return;
    }

    postsFeed.innerHTML = '';
    posts.forEach((post, i) => {
      const card = document.createElement('article');
      card.className = 'post-card';

      // Subtle 3D parallax depth — earlier posts sit slightly "behind"
      const depth = Math.min(i * 2, 12);
      card.style.transform = `perspective(900px) rotateX(${depth * 0.4}deg)`;
      card.style.opacity   = Math.max(0.75, 1 - i * 0.04);

      // Restore natural tilt on hover
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'perspective(900px) rotateX(0deg) translateY(-2px)';
        card.style.opacity   = '1';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = `perspective(900px) rotateX(${depth * 0.4}deg)`;
        card.style.opacity   = String(Math.max(0.75, 1 - i * 0.04));
      });

      const isLLM      = !post.isMock;
      const badgeClass = isLLM ? 'llm' : 'mock';
      const badgeText  = isLLM ? 'LLM Valid' : 'Mock';

      const tagsHTML = (post.topicTags || []).map(t => `<span class="tag">${t}</span>`).join('');
      const srcHTML  = (post.sources || []).map(s => {
        const label = s.replace(/^https?:\/\/(www\.)?/, '').substring(0, 60);
        return `<a href="${s}" target="_blank" class="post-source-link">↗ ${label}</a>`;
      }).join('');

      card.innerHTML = `
        <div class="post-card-header">
          <div class="post-meta">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span class="post-date">${fmtDate(post.createdAt)}</span>
          </div>
        </div>
        <p class="post-text">${esc(post.text)}</p>
        <div class="post-rationale">
          <strong>Editorial Rationale</strong>
          ${esc(post.rationale)}
        </div>
        ${srcHTML ? `<div class="post-sources">${srcHTML}</div>` : ''}
        <div class="post-tags">${tagsHTML}</div>
      `;

      postsFeed.appendChild(card);
    });
  }

  // ── Rejections ───────────────────────────────────────────────────────────
  function renderRejections(rows) {
    rejCount.textContent = rows ? rows.length : 0;
    if (!rows || rows.length === 0) {
      rejList.innerHTML = '<p class="empty-note">No rejections yet.</p>';
      return;
    }
    rejList.innerHTML = '';
    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rej-item';
      const cleanUrl = r.url.replace(/^https?:\/\/(www\.)?/, '').substring(0, 30) + '…';
      el.innerHTML = `
        <p class="rej-title">${esc(r.title)}</p>
        <p class="rej-reason">${esc(r.reason)}</p>
        <div class="rej-meta">
          <span class="rej-score">Score ${r.score}/10</span>
          <a href="${r.url}" target="_blank" class="rej-link">↗ ${cleanUrl}</a>
        </div>
      `;
      rejList.appendChild(el);
    });
  }

  // ── Simulation Console ───────────────────────────────────────────────────
  btnSimulate.addEventListener('click', async () => {
    const title   = simTitle.value.trim();
    if (!title) { simTitle.focus(); return; }

    const snippet = simSnippet.value.trim();
    const url     = simUrl.value.trim();
    btnSimulate.disabled    = true;
    btnSimulate.textContent = 'Asking Sable…';

    // Show loading
    simResult.className = 'sim-loading';
    simResult.innerHTML = '<div class="spinner"></div> Sable is evaluating your topic...';

    try {
      const res = await Telemetry.simulate({ title, snippet, url });

      // Handle server-side errors
      if (res.error) {
        simResult.className = 'sim-result rejected';
        simResult.innerHTML = `
          <div class="sim-verdict rejected">✗ ERROR</div>
          <p class="sim-reason">${esc(res.error)}</p>
        `;
        return;
      }

      const accepted  = res.verdict === 'accept';
      const scoreText = typeof res.score === 'number' ? `${res.score}/10` : '?/10';
      simResult.className = `sim-result ${accepted ? 'accepted' : 'rejected'}`;

      let html = `
        <div class="sim-verdict ${accepted ? 'accepted' : 'rejected'}">
          ${accepted ? '✓ ACCEPTED' : '✗ REJECTED'} — Score ${scoreText}
        </div>
        <p class="sim-reason">${esc(res.reason)}</p>
      `;

      if (res.topicTags && res.topicTags.length) {
        html += `<div class="post-tags" style="margin-top:8px">${res.topicTags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`;
      }

      if (accepted && res.post) {
        html += `
          <div class="sim-post">
            <p class="sim-post-label">Generated Post</p>
            <p>${esc(res.post.text)}</p>
          </div>
        `;
      }

      simResult.innerHTML = html;
      if (accepted) refresh();
    } catch (err) {
      simResult.className = 'sim-result rejected';
      simResult.innerHTML = `<p class="sim-reason">Network error: ${esc(err.message)}</p>`;
    } finally {
      btnSimulate.disabled    = false;
      btnSimulate.textContent = 'Ask Sable';
    }
  });

  // ── Button Actions ───────────────────────────────────────────────────────
  btnInit.addEventListener('click', async () => {
    btnInit.disabled    = true;
    btnInit.textContent = 'Booting…';
    try {
      await Telemetry.initAgent();
      await refresh();
    } catch (e) {
      alert('Init failed: ' + e.message);
    } finally {
      btnInit.textContent = 'Boot Agent Scheduler';
      btnInit.disabled    = false;
    }
  });

  btnTick.addEventListener('click', async () => {
    btnTick.disabled    = true;
    btnTick.textContent = 'Scanning…';
    try {
      const res = await Telemetry.triggerTick();
      if (res.status === 'skipped') alert('Cycle is already running — try again shortly.');
      await refresh();
    } catch (e) {
      alert('Tick failed: ' + e.message);
    } finally {
      btnTick.textContent = 'Force Live Internet Scan';
      btnTick.disabled    = false;
    }
  });

  // ── Presets Event Handlers ───────────────────────────────────────────────
  presetAccept.addEventListener('click', () => {
    simTitle.value = 'Direct Jailbreaks and Sandbox Escape Exploits in Multi-Agent Systems';
    simSnippet.value = 'This paper analyzes the vulnerability of multi-agent LLM systems to system prompt override attacks, showing how an attacker can craft malicious inputs that bypass environment isolation layers and execute local OS shell commands inside the host sandbox.';
    simUrl.value = 'https://arxiv.org/abs/2402.05162';
    simResult.className = 'sim-result hidden';
    simTitle.focus();
  });

  presetRejectMed.addEventListener('click', () => {
    simTitle.value = 'Tracing the Heart: Heart-Failure Feature Engineering via EHR Pipeline';
    simSnippet.value = 'This research proposes an automated pipeline for clinical medical data extraction. It extracts diagnostic markers from EHR records to predict cardiac arrest timelines, showing high reliability on private patient datasets.';
    simUrl.value = 'https://arxiv.org/abs/2402.09876';
    simResult.className = 'sim-result hidden';
    simTitle.focus();
  });

  presetRejectEth.addEventListener('click', () => {
    simTitle.value = 'A Mechanism-Design Model for Participatory Governance of Deployed AI Agents';
    simSnippet.value = 'This paper presents a social welfare framework for establishing democratic policy guidelines for deployed AI systems. It discusses stakeholder consensus building and ethical trade-offs but offers no security details.';
    simUrl.value = 'https://arxiv.org/abs/2402.01234';
    simResult.className = 'sim-result hidden';
    simTitle.focus();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  refresh();
  setInterval(refresh, 8000);
});
