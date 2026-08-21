const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = '请求失败';
    try { message = (await response.json()).detail || message; } catch (_) { /* plain error */ }
    throw new Error(message);
  }
  return response.json();
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  window.setTimeout(() => {
    $('#toast').textContent = '';
    $('#toast').classList.remove('visible');
  }, 3600);
}

function adapterLabel(value) {
  return ({
    manual_url_capture: '回答页直取（旧）',
    zhihu_search_question_api: '搜索 → 问题 → 回答',
  })[value] || value;
}

async function loadStats() {
  const stats = await getJson('/api/admin/stats');
  const metrics = [
    ['原文', stats.raw_envelopes],
    ['快照', stats.snapshots],
    ['情景', stats.scenarios],
    ['分叉', stats.branches],
  ];
  $('#stats').innerHTML = metrics.map(([label, value]) => `<span><strong>${value}</strong>${label}</span>`).join('') + `
    <span class="summary-inline-state"><i></i>${stats.confirmed_scenarios ? `${stats.confirmed_scenarios} 个情景已确认` : '语义层待建立'}</span>`;
}

function renderContent(data) {
  const container = $('#admin-content-list');
  if (!data.items.length) {
    container.innerHTML = '<div class="empty-state">没有匹配快照。</div>';
    return;
  }
  container.innerHTML = data.items.map((item) => `
    <button class="data-row admin-row" type="button" role="row" data-item="${escapeHtml(item.item_id)}">
      <span class="cell-primary" role="cell"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(adapterLabel(item.adapter_code))} · ${escapeHtml(item.captured_at.slice(0, 10))}</small></span>
      <span class="cell-mono" role="cell"><small class="mobile-label">回答 ID</small>${escapeHtml(item.external_id)}</span>
      <span role="cell"><small class="mobile-label">审核</small><i class="status-dot ${item.review_status === 'CONFIRMED' ? 'complete' : ''}"></i>${escapeHtml(item.review_status)}</span>
      <span role="cell"><small class="mobile-label">可用性</small>${escapeHtml(item.availability)}</span>
      <span role="cell"><small class="mobile-label">证据</small>${item.has_raw_html ? 'HTML' : '文本'} <span class="row-arrow" aria-hidden="true">›</span></span>
    </button>`).join('');
  container.querySelectorAll('[data-item]').forEach((row) => row.addEventListener('click', () => openContent(row.dataset.item)));
}

async function loadContent(query = '') {
  $('#admin-content-list').innerHTML = '<div class="empty-state">读取中……</div>';
  renderContent(await getJson(`/api/admin/content?q=${encodeURIComponent(query)}`));
}

function snapshotMarkup(item, snapshot, index) {
  return `<section class="detail-section">
    <div class="snapshot-heading"><div><span class="eyebrow">版本 ${index + 1}</span><h3>${escapeHtml(snapshot.title)}</h3></div><span class="review-label">${escapeHtml(snapshot.review_status)}</span></div>
    <div class="detail-meta"><span>${escapeHtml(snapshot.captured_at.slice(0, 10))}</span><span>${escapeHtml(snapshot.language)}</span><span>${snapshot.has_raw_html ? 'HTML 完整' : '仅文本'}</span></div>
    <p class="body-copy">${escapeHtml(snapshot.body)}</p>
    <a class="source-link" href="${escapeHtml(item.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.canonical_url)} ↗</a>
    <dl class="evidence-meta"><div><dt>snapshot_id</dt><dd>${escapeHtml(snapshot.snapshot_id)}</dd></div><div><dt>sha256</dt><dd>${escapeHtml(snapshot.raw_sha256 || '—')}</dd></div></dl>
    <details class="evidence-box"><summary>raw HTML / payload</summary><pre class="raw-html">${escapeHtml(snapshot.raw_html || '没有 raw HTML')}</pre></details>
    <div class="action-row"><button data-review="${escapeHtml(snapshot.snapshot_id)}" data-status="CONFIRMED">确认</button><button data-review="${escapeHtml(snapshot.snapshot_id)}" data-status="REJECTED">驳回</button><button class="archive" data-archive="${escapeHtml(item.item_id)}">归档内容</button></div>
  </section>`;
}

async function openContent(itemId) {
  const panel = $('#admin-detail');
  document.querySelectorAll('[data-item]').forEach((row) => row.classList.toggle('is-selected', row.dataset.item === itemId));
  panel.className = '';
  panel.innerHTML = '<div class="empty-state">正在读取证据……</div>';
  const item = await getJson(`/api/admin/content/${encodeURIComponent(itemId)}`);
  panel.innerHTML = `<div class="inspector-content"><div class="item-identity"><span>${escapeHtml(item.source_code)} · ${escapeHtml(adapterLabel(item.adapter_code))}</span><strong>${escapeHtml(item.external_id)}</strong><small>${escapeHtml(item.availability)}</small></div>${item.snapshots.map((snapshot, index) => snapshotMarkup(item, snapshot, index)).join('')}</div>`;
  panel.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', async () => {
    await getJson(`/api/admin/snapshots/${button.dataset.review}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ review_status: button.dataset.status }) });
    toast('审核状态已保存');
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
    await openContent(itemId);
  }));
  panel.querySelectorAll('[data-archive]').forEach((button) => button.addEventListener('click', async () => {
    await getJson(`/api/admin/content/${button.dataset.archive}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ availability: 'DELETED' }) });
    toast('内容已归档，原始证据仍保留');
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
    await openContent(itemId);
  }));
}

function renderScenarios(data) {
  const container = $('#admin-scenario-list');
  if (!data.items.length) {
    container.innerHTML = '<div class="empty-state compact-empty">还没有情景。</div>';
    return;
  }
  container.innerHTML = data.items.map((scenario) => `<article class="admin-scenario-card">
    <header><div><h3>${escapeHtml(scenario.name)}</h3><p>${escapeHtml(scenario.summary || '暂无摘要')}</p></div><span class="review-label">${escapeHtml(scenario.review_status)}</span></header>
    <div>${scenario.branches.map((branch) => `<div class="branch-editor"><strong>${escapeHtml(branch.label)}</strong><p>${escapeHtml(branch.action || branch.outcome || '暂无说明')}</p></div>`).join('')}</div>
    <details class="branch-editor"><summary>添加分叉</summary><form data-branch-form="${escapeHtml(scenario.id)}"><input name="label" placeholder="分叉名称" required><input name="trigger" placeholder="触发条件"><textarea name="action" rows="2" placeholder="采取什么行动"></textarea><textarea name="outcome" rows="2" placeholder="来源观察到的结果"></textarea><input name="source_snapshot_id" placeholder="来源 snapshot_id（可选）"><div class="form-row"><select name="review_status"><option>UNREVIEWED</option><option>CONFIRMED</option><option>REJECTED</option></select><input name="position" type="number" min="0" value="0"></div><button>保存分叉</button></form></details>
  </article>`).join('');
  container.querySelectorAll('[data-branch-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.position = Number(data.position || 0);
    if (!data.source_snapshot_id) delete data.source_snapshot_id;
    await getJson(`/api/admin/scenarios/${form.dataset.branchForm}/branches`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
    toast('分叉已保存');
    await Promise.all([loadStats(), loadScenarios()]);
  }));
}

async function loadScenarios() { renderScenarios(await getJson('/api/admin/scenarios')); }

$('#admin-search-form').addEventListener('submit', (event) => { event.preventDefault(); loadContent($('#admin-search').value.trim()); });
$('#refresh-scenarios').addEventListener('click', () => loadScenarios());
$('#scenario-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  await getJson('/api/admin/scenarios', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
  event.target.reset();
  toast('情景已创建');
  await Promise.all([loadStats(), loadScenarios()]);
});
$('#jsonl-input').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const records = file.name.endsWith('.jsonl') ? (await file.text()).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [JSON.parse(await file.text())];
    const result = await getJson('/api/admin/import', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ records }) });
    toast(`导入完成：新增 ${result.created}，未变化 ${result.unchanged}，拒绝 ${result.rejected}`);
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

Promise.all([loadStats(), loadContent(), loadScenarios()]).catch((error) => toast(error.message));
