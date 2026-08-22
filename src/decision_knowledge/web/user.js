const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  perspective: 'scenes',
  sceneQuery: '',
  sceneDomain: '全部',
  decisionQuery: '',
  decisionsLoaded: false,
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = '请求失败';
    try { message = (await response.json()).detail || message; } catch (_) { /* no-op */ }
    throw new Error(message);
  }
  return response.json();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date).replaceAll('/', '-');
}

function adapterLabel(value) {
  return ({
    manual_url_capture: '回答页直取（旧）',
    zhihu_search_question_api: '搜索 → 问题 → 回答',
  })[value] || value || '未知来源';
}

function reviewLabel(value) {
  return ({ UNREVIEWED: '候选', CONFIRMED: '已自动确认', REJECTED: '自动排除' })[value] || value || '未标注';
}

function renderOverview(data) {
  const metrics = [
    ['回答快照', data.snapshots],
    ['决策候选', data.decision_candidates],
    ['正式情景', data.confirmed_scenarios],
    ['原始包', data.raw_envelopes],
  ];
  $('#overview-strip').innerHTML = `
    <div class="summary-metrics">${metrics.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`).join('')}</div>
    <div class="summary-state"><i></i><span><strong>${escapeHtml(data.semantic_status)}</strong><small>${escapeHtml(data.unreviewed_snapshots)} 条原始快照已保留</small></span></div>`;
}

async function loadOverview() {
  try {
    renderOverview(await getJson('/api/overview'));
  } catch (error) {
    $('#overview-strip').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderSceneFilters() {
  const domains = ['全部', '职业与工作', '教育与学习', '财务与住房', '关系与家庭', '成长与生活', '其他'];
  $('#scene-filters').innerHTML = domains.map((domain) => `
    <button type="button" class="filter-tab ${domain === state.sceneDomain ? 'is-active' : ''}" data-domain="${escapeHtml(domain)}">${escapeHtml(domain)}</button>`).join('');
  $$('#scene-filters [data-domain]').forEach((button) => button.addEventListener('click', () => {
    state.sceneDomain = button.dataset.domain;
    renderSceneFilters();
    loadScenes(state.sceneQuery, state.sceneDomain === '全部' ? '' : state.sceneDomain);
  }));
}

function renderSceneItems() {
  const container = $('#scenario-list');
  const items = (state.sceneItems || []).filter((item) => state.sceneDomain === '全部' || item.domain === state.sceneDomain);
  const countLabel = state.sceneDomain === '全部' ? (state.sceneTotal || items.length) : items.length;
  $('#scenario-status').textContent = `${countLabel} 个自动情景`;
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">没有匹配的自动情景。换一个关键词或领域。</div>';
    return;
  }
  container.innerHTML = items.map((scene) => `
    <article class="scene-card">
      <header class="scene-card-heading">
        <div>
          <span class="scene-kicker">自动情景 · ${escapeHtml(scene.domain || '其他')}</span>
          <h3>${escapeHtml(scene.name)}</h3>
        </div>
        <div class="scene-count"><strong>${escapeHtml(scene.answer_count)}</strong><span>条回答</span></div>
      </header>
      <div class="scene-meta"><span>${escapeHtml(scene.decision_count)} 条决策候选</span><span>平均置信度 ${escapeHtml(scene.avg_confidence)}%</span><span class="review-chip">${escapeHtml(scene.status)}</span></div>
      <div class="path-list">
        ${(scene.paths || []).map((path, index) => `
          <button class="path-row" type="button" data-open-decision="${escapeHtml(path.candidate_id)}">
            <span class="path-index">${index + 1}</span>
            <span class="path-copy"><strong>${escapeHtml(path.decision || '未提取决定')}</strong><span>${escapeHtml(path.action || '未提取行动')}</span><small>${escapeHtml(path.outcome || '未提取结果')} · ${escapeHtml(path.confidence)}%</small></span>
            <span class="path-arrow" aria-hidden="true">↗</span>
          </button>`).join('')}
      </div>
      <footer class="scene-card-footer"><span>展示置信度最高的 ${Math.min((scene.paths || []).length, 8)} 条路径</span><button type="button" data-open-scene="${escapeHtml(scene.name)}">查看全部决策</button></footer>
    </article>`).join('');
  container.querySelectorAll('[data-open-decision]').forEach((button) => button.addEventListener('click', () => openDecision(button.dataset.openDecision)));
  container.querySelectorAll('[data-open-scene]').forEach((button) => button.addEventListener('click', () => {
    state.decisionQuery = button.dataset.openScene;
    $('#decision-search-input').value = state.decisionQuery;
    setPerspective('decisions');
    loadDecisions(state.decisionQuery);
  }));
}

function renderScenes(data) {
  state.sceneItems = data.items || [];
  state.sceneTotal = data.total || state.sceneItems.length;
  $('#formal-status').textContent = `正式情景：${data.formal_scenarios || 0}`;
  renderSceneItems();
}

async function loadScenes(query = '', domain = '') {
  $('#scenario-status').textContent = '读取中';
  try {
    renderScenes(await getJson(`/api/scene-view?q=${encodeURIComponent(query)}&domain=${encodeURIComponent(domain)}&limit=48`));
  } catch (error) {
    $('#scenario-status').textContent = '错误';
    $('#scenario-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderDecisions(data) {
  const container = $('#decision-list');
  $('#decision-status').textContent = `${data.total || 0} 条候选`;
  if (!data.items || !data.items.length) {
    container.innerHTML = '<div class="empty-state">没有匹配的单一决策候选。换一个关键词。</div>';
    return;
  }
  container.innerHTML = data.items.map((item) => `
    <article class="decision-card">
      <header class="decision-card-heading">
        <span class="decision-kicker">单一决策 · ${escapeHtml(reviewLabel(item.review_status))}</span>
        <span class="confidence-badge">置信度 ${escapeHtml(item.confidence)}%</span>
      </header>
      <h3>${escapeHtml(item.title || '未命名问题')}</h3>
      <div class="decision-grid">
        <div><span>处境</span><p>${escapeHtml(item.context || '未提取')}</p></div>
        <div><span>决定</span><p>${escapeHtml(item.decision || '未提取')}</p></div>
        <div><span>行动</span><p>${escapeHtml(item.action || '未提取')}</p></div>
        <div><span>结果</span><p>${escapeHtml(item.outcome || '未提取')}</p></div>
      </div>
      <footer class="decision-card-footer"><span>${escapeHtml(formatDate(item.captured_at))} · ${escapeHtml(adapterLabel(item.adapter_code))}</span><button type="button" data-open-decision="${escapeHtml(item.id)}">打开完整证据 ↗</button></footer>
    </article>`).join('');
  container.querySelectorAll('[data-open-decision]').forEach((button) => button.addEventListener('click', () => openDecision(button.dataset.openDecision)));
}

async function loadDecisions(query = '') {
  $('#decision-status').textContent = '读取中';
  try {
    renderDecisions(await getJson(`/api/decisions?q=${encodeURIComponent(query)}&limit=60`));
    state.decisionsLoaded = true;
  } catch (error) {
    $('#decision-status').textContent = '错误';
    $('#decision-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function setPerspective(name) {
  state.perspective = name;
  $$('[data-perspective]').forEach((button) => {
    const active = button.dataset.perspective === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-panel]').forEach((panel) => {
    const active = panel.dataset.panel === name;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  if (name === 'decisions' && !state.decisionsLoaded) loadDecisions(state.decisionQuery);
}

async function openDecision(candidateId) {
  const dialog = $('#answer-dialog');
  const detail = $('#answer-detail');
  detail.innerHTML = '<div class="empty-state">正在读取单一决策和原文……</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const payload = await getJson(`/api/decisions/${encodeURIComponent(candidateId)}`);
    const decision = payload.decision;
    const source = payload.source;
    detail.innerHTML = `
      <article class="dialog-content">
        <p class="eyebrow">单一决策 · ${escapeHtml(reviewLabel(decision.review_status))}</p>
        <h2>${escapeHtml(decision.title || '未命名问题')}</h2>
        <div class="detail-meta"><span>置信度 ${escapeHtml(decision.confidence)}%</span><span>分析 ${escapeHtml(decision.analysis_version)}</span><span>采集 ${escapeHtml(formatDate(decision.captured_at))}</span></div>
        <div class="decision-detail-grid">
          <div><span>处境</span><p>${escapeHtml(decision.context || '未提取')}</p></div>
          <div><span>决定</span><p>${escapeHtml(decision.decision || '未提取')}</p></div>
          <div><span>行动</span><p>${escapeHtml(decision.action || '未提取')}</p></div>
          <div><span>结果</span><p>${escapeHtml(decision.outcome || '未提取')}</p></div>
        </div>
        <section class="detail-section"><p class="detail-label">用户原文</p><p class="body-copy">${escapeHtml(source.body)}</p></section>
        <a class="source-link" href="${escapeHtml(source.canonical_url)}" target="_blank" rel="noreferrer">打开知乎原文 ↗</a>
        <details class="evidence-box"><summary>raw HTML 原始片段${source.has_raw_html ? '' : '（未保存）'}</summary><pre class="raw-html">${escapeHtml(source.raw_html || '没有保存 raw HTML')}</pre></details>
      </article>`;
  } catch (error) {
    detail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

$('#scene-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.sceneQuery = $('#scene-search-input').value.trim();
  loadScenes(state.sceneQuery, state.sceneDomain === '全部' ? '' : state.sceneDomain);
});
$('#decision-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.decisionQuery = $('#decision-search-input').value.trim();
  loadDecisions(state.decisionQuery);
});
$$('[data-perspective]').forEach((button) => button.addEventListener('click', () => setPerspective(button.dataset.perspective)));
$('[data-close-dialog]').addEventListener('click', () => $('#answer-dialog').close());
$('#answer-dialog').addEventListener('click', (event) => {
  if (event.target === $('#answer-dialog')) $('#answer-dialog').close();
});

renderSceneFilters();
loadOverview().catch(() => {});
loadScenes();
