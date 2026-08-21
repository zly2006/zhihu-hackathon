const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error((await response.json()).detail || '请求失败');
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
  })[value] || value;
}

function renderResults(data) {
  $('#result-count').textContent = `${data.total} 条`;
  const container = $('#results');
  if (!data.items.length) {
    container.innerHTML = '<div class="empty-state">没有匹配快照。换一个关键词。</div>';
    return;
  }
  container.innerHTML = data.items.map((item) => `
    <button class="data-row result-row" type="button" role="row" data-snapshot="${escapeHtml(item.snapshot_id)}">
      <span class="cell-primary" role="cell"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body_preview)}</small></span>
      <span class="cell-source" role="cell"><small class="mobile-label">来源</small><strong>${escapeHtml(item.source_code)} · ${escapeHtml(item.external_id)}</strong><small>${escapeHtml(adapterLabel(item.adapter_code))}</small></span>
      <span role="cell"><small class="mobile-label">采集时间</small>${escapeHtml(formatDate(item.captured_at))}</span>
      <span role="cell"><small class="mobile-label">证据</small><i class="status-dot ${item.has_raw_html ? 'complete' : ''}"></i>${item.has_raw_html ? 'HTML' : '文本'}</span>
      <span class="row-arrow" aria-hidden="true">›</span>
    </button>`).join('');
  container.querySelectorAll('[data-snapshot]').forEach((row) => row.addEventListener('click', () => openAnswer(row.dataset.snapshot)));
}

function renderOverview(data) {
  const metrics = [
    ['原文', data.raw_envelopes],
    ['快照', data.snapshots],
    ['情景', data.scenarios],
    ['分叉', data.branches],
  ];
  $('#overview-strip').innerHTML = `
    <div class="summary-metrics">${metrics.map(([label, value]) => `<span><strong>${value}</strong>${label}</span>`).join('')}</div>
    <div class="summary-state"><i></i><span><strong>${escapeHtml(data.semantic_status)}</strong><small>${data.unreviewed_snapshots} 条快照待整理</small></span></div>`;
}

async function loadOverview() {
  try { renderOverview(await getJson('/api/overview')); }
  catch (error) { $('#overview-strip').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

async function search(query = '') {
  $('#result-count').textContent = '检索中';
  try {
    renderResults(await getJson(`/api/search?q=${encodeURIComponent(query)}`));
  } catch (error) {
    $('#result-count').textContent = '错误';
    $('#results').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function openAnswer(snapshotId) {
  const dialog = $('#answer-dialog');
  const detail = $('#answer-detail');
  detail.innerHTML = '<div class="empty-state">正在读取证据……</div>';
  dialog.showModal();
  try {
    const item = await getJson(`/api/snapshots/${encodeURIComponent(snapshotId)}`);
    detail.innerHTML = `
      <article class="dialog-content">
        <p class="eyebrow">原文快照</p>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="detail-meta"><span>${escapeHtml(item.source_code)} · ${escapeHtml(item.external_id)}</span><span>采集：${escapeHtml(adapterLabel(item.adapter_code))}</span><span>${escapeHtml(formatDate(item.captured_at))}</span><span>${escapeHtml(item.review_status)}</span></div>
        <div class="detail-section"><p class="body-copy">${escapeHtml(item.body)}</p></div>
        <a class="source-link" href="${escapeHtml(item.canonical_url)}" target="_blank" rel="noreferrer">打开知乎原文 ↗</a>
        <details class="evidence-box"><summary>raw HTML 原始片段</summary><pre class="raw-html">${escapeHtml(item.raw_html || '没有保存 raw HTML')}</pre></details>
      </article>`;
  } catch (error) {
    detail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderScenarios(data) {
  const container = $('#scenario-list');
  $('#scenario-status').textContent = data.items.length ? `${data.items.length} 个` : '0 个';
  if (!data.items.length) {
    container.innerHTML = `<div class="semantic-empty">
      <i class="status-dot"></i>
      <div><strong>语义层尚未建立</strong><p>已有原文与快照，尚未归类为可比较的情景和分叉。</p></div>
      <button data-scroll-evidence>查看 ${$('#overview-strip .summary-metrics span:nth-child(2) strong')?.textContent || ''} 条快照 ↓</button>
    </div>`;
    container.querySelector('[data-scroll-evidence]').addEventListener('click', () => $('#evidence').scrollIntoView({ behavior: 'smooth' }));
    return;
  }
  container.innerHTML = data.items.map((scenario) => `
    <article class="scenario-row">
      <header><div><span class="scenario-domain">${escapeHtml(scenario.domain || '未分类')}</span><h3>${escapeHtml(scenario.name)}</h3><p>${escapeHtml(scenario.summary || '暂无摘要')}</p></div><span class="section-count">${scenario.branches.length} 个分叉</span></header>
      <div class="branch-tree">${scenario.branches.map((branch) => `<div class="branch-line"><i></i><div><strong>${escapeHtml(branch.label)}</strong><p>${escapeHtml(branch.action || branch.outcome || '暂无说明')}</p><small>${branch.evidence ? `证据 · ${escapeHtml(branch.evidence.title)}` : '尚未关联证据'}</small></div></div>`).join('')}</div>
    </article>`).join('');
}

async function loadScenarios() {
  try { renderScenarios(await getJson('/api/scenarios')); }
  catch (error) { $('#scenario-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  search($('#search-input').value.trim());
});
document.querySelectorAll('[data-query]').forEach((button) => button.addEventListener('click', () => {
  $('#search-input').value = button.dataset.query;
  search(button.dataset.query);
}));
$('[data-close-dialog]').addEventListener('click', () => $('#answer-dialog').close());
$('#answer-dialog').addEventListener('click', (event) => { if (event.target === $('#answer-dialog')) $('#answer-dialog').close(); });

loadOverview();
loadScenarios();
search();
