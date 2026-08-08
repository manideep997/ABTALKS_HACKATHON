/* main.js — Full UI controller for Sable Dashboard */
'use strict';

(function () {

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const btnInit        = document.getElementById('btn-init');
  const btnInitFeed    = document.getElementById('btn-init-feed');
  const btnTick        = document.getElementById('btn-tick');
  const btnSimulate    = document.getElementById('btn-simulate');
  const simBtnText     = document.getElementById('sim-btn-text');
  const simSpinner     = document.getElementById('sim-spinner');

  const simTitle       = document.getElementById('sim-title');
  const simSnippet     = document.getElementById('sim-snippet');
  const simUrl         = document.getElementById('sim-url');

  const simResultBox   = document.getElementById('sim-result');
  const simVerdictHdr  = document.getElementById('sim-verdict-header');
  const simCriteria    = document.getElementById('sim-criteria');
  const simReasonBlk   = document.getElementById('sim-reason-block');
  const simTagsRow     = document.getElementById('sim-tags');
  const simSourceInfo  = document.getElementById('sim-source-info');
  const simPostBlock   = document.getElementById('sim-post-block');
  const simEmpty       = document.getElementById('sim-empty');

  const postsFeed      = document.getElementById('posts-feed');
  const rejList        = document.getElementById('rejections-list');
  const rejCount       = document.getElementById('rej-count');

  const liveBadge      = document.getElementById('live-badge');
  const liveDot        = document.getElementById('live-dot');
  const liveLabel      = document.getElementById('live-label');

  const presetAccept   = document.getElementById('preset-accept');
  const presetMed      = document.getElementById('preset-reject-med');
  const presetEth      = document.getElementById('preset-reject-eth');

  const rpToggle       = document.getElementById('rp-toggle');
  const rejPanel       = document.getElementById('rejection-panel');

  const modalBackdrop  = document.getElementById('modal-backdrop');
  const fcClose        = document.getElementById('fc-close');
  const fcContent      = document.getElementById('fc-content');

  const tabBtns        = document.querySelectorAll('.nav-tab');
  const tabPanels      = document.querySelectorAll('.tab-panel');

  // ── State ───────────────────────────────────────────────────────────────────
  let rejectionStore = [];

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12: false });
    } catch { return iso; }
  }

  function barColor(score) {
    if (score >= 7) return '#10b981';
    if (score >= 4) return '#fbbf24';
    return '#f43f5e';
  }

  // ── Tab Switching ────────────────────────────────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });

  // ── Rejection Panel Toggle ───────────────────────────────────────────────────
  let rpCollapsed = false;
  rpToggle.addEventListener('click', () => {
    rpCollapsed = !rpCollapsed;
    rejPanel.classList.toggle('collapsed', rpCollapsed);
    rpToggle.textContent = rpCollapsed ? '›' : '‹';
  });

  // ── Dashboard Refresh ────────────────────────────────────────────────────────
  async function refresh() {
    try {
      const [feedData, rejectionsData, statsData] = await Promise.all([
        Telemetry.getFeed(),
        Telemetry.getRejections(),
        Telemetry.getStats(),
      ]);
      renderStats(statsData);
      renderFeed(feedData);
      renderRejections(rejectionsData);
    } catch (err) {
      console.error('[UI] Refresh failed:', err);
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  function renderStats(stats) {
    if (!stats) return;

    // Header live status
    const isLive = stats.scheduler_status === 'running';
    liveDot.className = 'live-dot' + (isLive ? ' active' : '');
    liveLabel.textContent = isLive ? 'Live' : (stats.scheduler_status || 'Offline');
    liveBadge.className = 'live-badge' + (isLive ? ' online' : '');

    // Hero floating cards
    setText('sfc-posts', stats.total_posts ?? 0);
    setText('sfc-rejected', stats.total_rejected ?? 0);
    setText('sfc-status', stats.scheduler_status || '—');
    const lastAt = stats.last_cycle_at ? fmtDate(stats.last_cycle_at) : '—';
    setText('sfc-last', lastAt);

    // Pipeline tab telemetry
    setText('pstat-scheduler', stats.scheduler_status || '—');
    setText('pstat-result', stats.last_cycle_result || '—');
    setText('pstat-total', stats.total_posts ?? 0);
    setText('pstat-real', stats.llm_posts ?? 0);
    setText('pstat-mock', stats.mock_posts ?? 0);
    setText('pstat-rejected', stats.total_rejected ?? 0);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  }

  // ── Feed ─────────────────────────────────────────────────────────────────────
  function renderFeed(feedData) {
    const posts = (feedData && Array.isArray(feedData.posts)) ? feedData.posts : [];
    if (posts.length === 0) {
      postsFeed.innerHTML = `
        <div class="empty-feed-msg">
          <div class="efm-icon">◉</div>
          <p>No posts yet. Boot the agent and wait for a cycle to complete.</p>
          <button class="hdr-btn" id="btn-init-feed-inner">Boot Agent Scheduler</button>
        </div>`;
      document.getElementById('btn-init-feed-inner')?.addEventListener('click', doInit);
      return;
    }

    postsFeed.innerHTML = '';
    posts.forEach(post => {
      const card = document.createElement('div');
      card.className = 'post-card';
      const isMock = post.isMock || post.is_mock;
      const sources = Array.isArray(post.sources) ? post.sources : (post.sources ? [post.sources] : []);
      const tags = Array.isArray(post.topicTags) ? post.topicTags : (Array.isArray(post.topic_tags) ? post.topic_tags : []);

      card.innerHTML = `
        <div class="pc-header">
          <span class="pc-badge ${isMock ? 'mock' : 'llm'}">${isMock ? 'MOCK' : 'LLM VALID'}</span>
          <span class="pc-date">${fmtDate(post.createdAt || post.created_at)}</span>
        </div>
        <div>
          <div class="pc-label-row"><span class="pc-lbl">TITLE</span></div>
          <p class="pc-text">${esc(post.text)}</p>
        </div>
        ${post.rationale ? `
        <div class="pc-rationale">
          <strong>RATIONALE</strong>
          ${esc(post.rationale)}
        </div>` : ''}
        <div class="pc-footer">
          ${sources.length ? `
          <div class="pc-sources">
            ${sources.map(s => `<a href="${esc(s)}" target="_blank" class="pc-source-link" rel="noopener">↗ ${esc(s.replace(/^https?:\/\/(www\.)?/,'').substring(0,50))}…</a>`).join('')}
          </div>` : ''}
          ${tags.length ? `
          <div class="pc-tags">
            ${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
          </div>` : ''}
        </div>`;
      postsFeed.appendChild(card);
    });
  }

  // ── Rejections ───────────────────────────────────────────────────────────────
  function renderRejections(data) {
    const items = Array.isArray(data) ? data : (data && Array.isArray(data.rejections) ? data.rejections : []);
    rejectionStore = items;
    if (rejCount) rejCount.textContent = items.length;

    if (items.length === 0) {
      rejList.innerHTML = '<p class="rp-empty">No rejections yet.<br/>Run a cycle or simulate a topic.</p>';
      return;
    }

    rejList.innerHTML = '';
    items.slice(0, 40).forEach((r, idx) => {
      const el = document.createElement('div');
      el.className = 'rej-item';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.innerHTML = `
        <p class="rej-title">${esc(r.title)}</p>
        <div class="rej-meta">
          <span class="rej-score">Score ${r.score ?? '?'}/10</span>
          <span class="rej-hint">Click to view →</span>
        </div>`;
      el.addEventListener('click', () => openFlashcard(idx));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openFlashcard(idx); });
      rejList.appendChild(el);
    });
  }

  // ── Rejection Flashcard Modal ─────────────────────────────────────────────────
  function openFlashcard(idx) {
    const r = rejectionStore[idx];
    if (!r) return;

    const score = r.score ?? 0;
    const verdictLabel = score >= 6 ? 'ACCEPT' : 'REJECT';
    const verdictClass = score >= 6 ? 'accept' : 'reject';

    // Build criteria HTML if available (only from simulate results, not DB items)
    let criteriaHtml = '';
    const criteria = r.criteria;
    if (criteria) {
      const rows = [
        { label: 'Exploit Specificity', key: 'exploit_specificity', weight: '30%' },
        { label: 'AI Security Relevance', key: 'ai_security_relevance', weight: '30%' },
        { label: 'Practitioner Value', key: 'practitioner_value', weight: '20%' },
        { label: 'Technical Rigor', key: 'technical_rigor', weight: '20%' },
      ].map(c => {
        const s = criteria[c.key] ?? 0;
        const pct = (s / 10 * 100).toFixed(0);
        const color = barColor(s);
        return `
          <div class="fc-criterion">
            <div class="fcc-header">
              <span class="fcc-label">${c.label}</span>
              <div style="display:flex;gap:8px;align-items:center">
                <span class="fcc-weight">${c.weight}</span>
                <span class="fcc-score" style="color:${color}">${s}/10</span>
              </div>
            </div>
            <div class="fcc-bar">
              <div class="fcc-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>`;
      }).join('');
      criteriaHtml = `
        <p class="fc-section-title" style="margin-top:24px;">SCORING CRITERIA</p>
        <div class="fc-criteria">${rows}</div>`;
    }

    const tags = Array.isArray(r.topic_tags) ? r.topic_tags : (Array.isArray(r.topicTags) ? r.topicTags : []);
    const tagsHtml = tags.length ? `
      <p class="fc-section-title" style="margin-top:24px;">TOPIC TAGS</p>
      <div class="fc-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : '';

    const urlDisplay = r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.substring(0, 60))}${r.url.length > 60 ? '…' : ''}</a>` : 'N/A';

    fcContent.innerHTML = `
      <p class="fc-eyebrow">PAPER EVALUATION REPORT · REJECTED</p>
      <h2 class="fc-title">${esc(r.title)}</h2>
      <div class="fc-verdict-row">
        <span class="fc-verdict-badge ${verdictClass}">${verdictLabel}</span>
        <div>
          <div class="fc-score-big ${verdictClass}">${score}/10</div>
          <div class="fc-score-label">Overall Score</div>
        </div>
      </div>

      ${criteriaHtml}

      <p class="fc-section-title" style="margin-top:${criteria ? '28px' : '0'};">REJECTION REASON</p>
      <p class="fc-reason">${esc(r.reason || 'No reason recorded.')}</p>

      <div class="fc-meta">
        <div class="fc-meta-row">
          <span class="fc-meta-key">URL</span>
          <span class="fc-meta-val">${urlDisplay}</span>
        </div>
        <div class="fc-meta-row">
          <span class="fc-meta-key">Evaluated</span>
          <span class="fc-meta-val">${fmtDate(r.scored_at)}</span>
        </div>
      </div>

      ${tagsHtml}`;

    modalBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modalBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  fcClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ── Simulate Console ──────────────────────────────────────────────────────────
  btnSimulate.addEventListener('click', async () => {
    const title   = simTitle.value.trim();
    if (!title) { simTitle.focus(); simTitle.style.borderColor = 'var(--red)'; return; }
    simTitle.style.borderColor = '';

    const snippet = simSnippet.value.trim();
    const url     = simUrl.value.trim();

    // Loading state
    btnSimulate.disabled = true;
    simBtnText.textContent = 'Fetching & Evaluating…';
    simSpinner.classList.remove('hidden');
    simResultBox.classList.add('hidden');
    simEmpty.classList.remove('hidden');
    simEmpty.innerHTML = `<div class="empty-icon" style="animation:spin 1s linear infinite">⟳</div><p>Sable is fetching the paper from the web and applying its 4-criteria scoring matrix…</p>`;

    try {
      const res = await Telemetry.simulate({ title, snippet, url });

      simEmpty.classList.add('hidden');
      simResultBox.classList.remove('hidden');

      if (res.error) {
        simVerdictHdr.innerHTML = `<span class="svh-badge reject">ERROR</span><p style="color:var(--red);font-size:13px;margin-left:8px">${esc(res.error)}</p>`;
        simCriteria.classList.add('hidden');
        simReasonBlk.classList.add('hidden');
        simTagsRow.classList.add('hidden');
        simSourceInfo.classList.add('hidden');
        simPostBlock.classList.add('hidden');
        return;
      }

      const accepted = res.verdict === 'accept';
      const score    = typeof res.score === 'number' ? res.score : '?';

      // Verdict header
      simVerdictHdr.innerHTML = `
        <span class="svh-badge ${accepted ? 'accept' : 'reject'}">${accepted ? '✓ ACCEPTED' : '✕ REJECTED'}</span>
        <div>
          <div class="svh-score ${accepted ? 'accept' : 'reject'}">${typeof score === 'number' ? score.toFixed(1) : score} / 10</div>
          <div class="svh-label">Overall Score (4-Criteria Matrix)</div>
        </div>`;

      // Criteria breakdown
      if (res.criteria) {
        const crits = [
          { label: 'Exploit Specificity',    key: 'exploit_specificity',    w: '30%' },
          { label: 'AI Security Relevance',  key: 'ai_security_relevance',  w: '30%' },
          { label: 'Practitioner Value',     key: 'practitioner_value',     w: '20%' },
          { label: 'Technical Rigor',        key: 'technical_rigor',        w: '20%' },
        ];
        simCriteria.innerHTML = `<div class="sc-title">SCORING BREAKDOWN</div>` + crits.map(c => {
          const s   = res.criteria[c.key] ?? 0;
          const pct = (s / 10 * 100).toFixed(0);
          const col = barColor(s);
          return `
            <div class="criterion-row">
              <span class="cr-label">${c.label}</span>
              <span class="cr-weight" style="font-size:10px;color:var(--text-dim);font-family:var(--mono);width:30px">${c.w}</span>
              <div class="cr-bar-wrap"><div class="cr-bar" style="width:${pct}%;background:${col}"></div></div>
              <span class="cr-score">${s}/10</span>
            </div>`;
        }).join('');
        simCriteria.classList.remove('hidden');
      } else {
        simCriteria.classList.add('hidden');
      }

      // Reason
      if (res.reason) {
        simReasonBlk.innerHTML = `<span class="sr-label">EDITORIAL REASON</span><p class="sr-text">${esc(res.reason)}</p>`;
        simReasonBlk.classList.remove('hidden');
      } else {
        simReasonBlk.classList.add('hidden');
      }

      // Tags
      if (res.topicTags && res.topicTags.length) {
        simTagsRow.innerHTML = res.topicTags.map(t => `<span class="stag">${esc(t)}</span>`).join('');
        simTagsRow.classList.remove('hidden');
      } else {
        simTagsRow.classList.add('hidden');
      }

      // Source info
      if (res.resolvedUrl) {
        const preview = res.fetchedContent ? `<br/><span style="color:var(--text-dim)">${esc(res.fetchedContent.substring(0, 200))}…</span>` : '';
        simSourceInfo.innerHTML = `Source: <a href="${esc(res.resolvedUrl)}" target="_blank" rel="noopener">${esc(res.resolvedUrl.substring(0, 60))}${res.resolvedUrl.length > 60 ? '…' : ''}</a>${preview}`;
        simSourceInfo.classList.remove('hidden');
      } else {
        simSourceInfo.classList.add('hidden');
      }

      // Generated post
      if (accepted && res.post) {
        simPostBlock.innerHTML = `<span class="spb-label">✓ GENERATED POST</span><p class="spb-text">${esc(res.post.text)}</p>`;
        simPostBlock.classList.remove('hidden');
        refresh(); // refresh feed to show new post
      } else {
        simPostBlock.classList.add('hidden');
      }

    } catch (err) {
      simEmpty.classList.add('hidden');
      simResultBox.classList.remove('hidden');
      simVerdictHdr.innerHTML = `<span class="svh-badge reject">NETWORK ERROR</span><p style="color:var(--red-dim);font-size:13px;margin-left:8px">${esc(err.message)}</p>`;
      simCriteria.classList.add('hidden');
      simReasonBlk.classList.add('hidden');
      simTagsRow.classList.add('hidden');
      simSourceInfo.classList.add('hidden');
      simPostBlock.classList.add('hidden');
    } finally {
      btnSimulate.disabled = false;
      simBtnText.textContent = 'Submit to Sable';
      simSpinner.classList.add('hidden');
    }
  });

  // ── Presets ──────────────────────────────────────────────────────────────────
  presetAccept.addEventListener('click', () => {
    simTitle.value   = 'Direct Jailbreaks and Sandbox Escape Exploits in Multi-Agent LLM Systems';
    simSnippet.value = 'We demonstrate that multi-agent LLM frameworks are vulnerable to system prompt override attacks. An adversary can craft malicious tool outputs that bypass environment isolation layers, enabling local OS shell command execution inside the host sandbox. We confirm exploitation on GPT-4, Claude-3, and Gemini-Ultra agent configurations.';
    simUrl.value     = 'https://arxiv.org/abs/2402.05162';
    clearSimResult();
  });

  presetMed.addEventListener('click', () => {
    simTitle.value   = 'Tracing the Heart: Heart-Failure Feature Engineering via EHR Pipeline';
    simSnippet.value = 'This research proposes an automated pipeline for clinical feature extraction from EHR records. It uses gradient boosting to predict cardiac arrest timelines showing 94.3% accuracy on private patient datasets from three hospitals in the UK.';
    simUrl.value     = 'https://arxiv.org/abs/2402.09876';
    clearSimResult();
  });

  presetEth.addEventListener('click', () => {
    simTitle.value   = 'A Mechanism-Design Model for Participatory Governance of Deployed AI Agents';
    simSnippet.value = 'This paper presents a social welfare framework for democratic policy guidelines for deployed AI systems. It discusses multi-stakeholder consensus building, ethical trade-offs between utility and fairness, and proposes a voting mechanism for resolving disagreements in AI deployment decisions.';
    simUrl.value     = 'https://arxiv.org/abs/2402.01234';
    clearSimResult();
  });

  function clearSimResult() {
    simResultBox.classList.add('hidden');
    simEmpty.classList.remove('hidden');
    simEmpty.innerHTML = `<div class="empty-icon">◈</div><p>Submit a paper above to see Sable's editorial judgment with full scoring breakdown.</p>`;
    simTitle.focus();
  }

  // ── Boot & Tick ──────────────────────────────────────────────────────────────
  async function doInit() {
    const b = btnInit;
    if (b) { b.disabled = true; b.textContent = 'Booting…'; }
    try {
      await Telemetry.initAgent();
      await refresh();
    } catch (e) { alert('Init failed: ' + e.message); }
    finally {
      if (b) { b.textContent = 'Boot Agent'; b.disabled = false; }
    }
  }

  btnInit.addEventListener('click', doInit);
  if (btnInitFeed) btnInitFeed.addEventListener('click', doInit);

  btnTick.addEventListener('click', async () => {
    btnTick.disabled = true;
    btnTick.textContent = 'Scanning…';
    try {
      const res = await Telemetry.triggerTick();
      if (res.status === 'skipped') alert('Cycle already running — try again shortly.');
      await refresh();
    } catch (e) { alert('Tick failed: ' + e.message); }
    finally { btnTick.textContent = 'Force Scan'; btnTick.disabled = false; }
  });

  // ── Auto-refresh every 30s ───────────────────────────────────────────────────
  refresh();
  setInterval(refresh, 30_000);

})();
