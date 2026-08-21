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
  if (!data.items.length) {
    container.innerHTML = '<div class="empty-state">管理端确认情景后，它们会出现在这里。</div>';
    return;
  }
  container.innerHTML = data.items.map((scenario) => `
    <article class="scenario-card">
      <h3>${escapeHtml(scenario.name)}</h3>
      <p>${escapeHtml(scenario.summary || '暂无摘要')}</p>
      ${scenario.branches.map((branch) => `<div class="branch-line"><strong>${escapeHtml(branch.label)}</strong><p>${escapeHtml(branch.action || branch.outcome || '暂无说明')}</p>${branch.evidence ? `<div class="meta-line">证据：${escapeHtml(branch.evidence.title)}</div>` : ''}</div>`).join('')}
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
search();
loadScenarios();
