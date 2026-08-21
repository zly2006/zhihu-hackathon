const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error((await response.json()).detail || '请求失败');
  return response.json();
}

function renderResults(data) {
  $('#result-count').textContent = `${data.total} 条`;
  const container = $('#results');
  if (!data.items.length) {
    container.innerHTML = '<div class="empty-state">没有找到匹配回答。换个词试试，或先从快捷搜索开始。</div>';
    return;
  }
  container.innerHTML = data.items.map((item) => `
    <article class="result-card" data-snapshot="${escapeHtml(item.snapshot_id)}">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body_preview)}</p>
      <div class="meta-line"><span>${escapeHtml(item.source_code)} · ${escapeHtml(item.external_id)}</span><span>${escapeHtml(item.language)}</span><a href="${escapeHtml(item.canonical_url)}" target="_blank" rel="noreferrer">打开知乎原文 ↗</a></div>
    </article>`).join('');
  container.querySelectorAll('[data-snapshot]').forEach((card) => card.addEventListener('click', () => openAnswer(card.dataset.snapshot)));
}

function renderOverview(data) {
  const layers = [
    ['raw_envelopes', '原文', 'URL / HTML'],
    ['snapshots', '快照', '版本'],
    ['scenarios', '情景', '归类'],
    ['branches', '分叉', '比较'],
  ];
  $('#overview-strip').innerHTML = layers.map(([key, label, hint]) => `
    <div class="overview-step"><span>${escapeHtml(label)}</span><strong>${data[key]}</strong><small>${escapeHtml(hint)}</small></div>`).join('<span class="overview-arrow">→</span>') + `
    <div class="overview-state"><span>语义层状态</span><strong>${escapeHtml(data.semantic_status)}</strong><small>${data.unreviewed_snapshots} 条快照待审核</small></div>`;
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
  detail.innerHTML = '<div class="empty-state">正在打开证据抽屉……</div>';
  dialog.showModal();
  try {
    const item = await getJson(`/api/snapshots/${encodeURIComponent(snapshotId)}`);
    detail.innerHTML = `
      <div class="dialog-content">
        <p class="eyebrow">SOURCE SNAPSHOT · ${escapeHtml(item.source_code)}</p>
        <h2>${escapeHtml(item.title)}</h2>
        <div class="meta-line"><span>${escapeHtml(item.external_id)}</span><span>${escapeHtml(item.language)}</span><a href="${escapeHtml(item.canonical_url)}" target="_blank" rel="noreferrer">知乎原文 ↗</a></div>
        <div class="detail-section"><p class="body-copy">${escapeHtml(item.body)}</p></div>
        <details class="evidence-box"><summary>查看 raw HTML 原始片段</summary><pre class="raw-html">${escapeHtml(item.raw_html || '没有保存 raw HTML')}</pre></details>
      </div>`;
  } catch (error) {
    detail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderScenarios(data) {
  const container = $('#scenario-list');
  $('#scenario-status').textContent = data.items.length ? `${data.items.length} 个情景` : '尚未建立';
  if (!data.items.length) {
    container.innerHTML = '<div class="pipeline-empty"><div class="empty-icon">◎</div><h3>情景层还没有数据</h3><p>当前已有原文和快照，但还没有完成“决策经历 → 情景 → 分叉”的整理。</p><button data-scroll-evidence>先查看原文快照</button></div>';
    container.querySelector('[data-scroll-evidence]').addEventListener('click', () => $('#evidence').scrollIntoView({ behavior: 'smooth' }));
    return;
  }
  container.innerHTML = data.items.map((scenario) => `
    <article class="scenario-card">
      <div class="scenario-card-head"><span class="status-pill">${escapeHtml(scenario.domain || '未分类')}</span><span class="meta-line">${scenario.branches.length} 个分叉</span></div>
      <h3>${escapeHtml(scenario.name)}</h3>
      <p>${escapeHtml(scenario.summary || '暂无摘要')}</p>
      <div class="branch-tree">${scenario.branches.map((branch) => `<div class="branch-line"><strong>${escapeHtml(branch.label)}</strong><p>${escapeHtml(branch.action || branch.outcome || '暂无说明')}</p>${branch.evidence ? `<div class="meta-line">↳ ${escapeHtml(branch.evidence.title)}</div>` : '<div class="meta-line">↳ 尚未关联证据</div>'}</div>`).join('')}</div>
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
