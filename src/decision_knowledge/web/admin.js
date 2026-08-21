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
  window.setTimeout(() => { $('#toast').textContent = ''; }, 3600);
}

async function loadStats() {
  const stats = await getJson('/api/admin/stats');
  const labels = [['content_items', '内容'], ['snapshots', '快照'], ['raw_envelopes', '原始包'], ['scenarios', '情景'], ['branches', '分叉'], ['confirmed_scenarios', '已确认']];
  $('#stats').innerHTML = labels.map(([key, label]) => `<div class="stat-card"><span>${label}</span><strong>${stats[key]}</strong></div>`).join('');
}

function renderContent(data) {
  const container = $('#admin-content-list');
  if (!data.items.length) { container.innerHTML = '<div class="empty-state">没有匹配的内容。</div>'; return; }
  container.innerHTML = data.items.map((item) => `
    <article class="admin-row" data-item="${escapeHtml(item.item_id)}">
      <div class="admin-row-main"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body_preview)}</p><div class="meta-line"><span>${escapeHtml(item.external_id)}</span><span>${escapeHtml(item.review_status)}</span><span>${escapeHtml(item.availability)}</span></div></div>
      <span class="status-pill">${item.has_raw_html ? 'HTML' : 'TEXT'}</span>
    </article>`).join('');
  container.querySelectorAll('[data-item]').forEach((row) => row.addEventListener('click', () => openContent(row.dataset.item)));
}

async function loadContent(query = '') {
  $('#admin-content-list').innerHTML = '<div class="empty-state">读取中……</div>';
  renderContent(await getJson(`/api/admin/content?q=${encodeURIComponent(query)}`));
}

function snapshotMarkup(item, snapshot) {
  return `<div class="detail-section"><div class="meta-line"><strong>快照 ${escapeHtml(snapshot.snapshot_id)}</strong><span>${escapeHtml(snapshot.review_status)}</span></div>
    <p class="body-copy">${escapeHtml(snapshot.body)}</p>
    <p>URL：<a href="${escapeHtml(item.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(item.canonical_url)}</a><br>sha256：${escapeHtml(snapshot.raw_sha256 || '—')}</p>
    <details class="evidence-box"><summary>查看 raw HTML / payload</summary><pre class="raw-html">${escapeHtml(snapshot.raw_html || '没有 raw HTML')}</pre></details>
    <div class="action-row"><button data-review="${escapeHtml(snapshot.snapshot_id)}" data-status="CONFIRMED">标记已确认</button><button data-review="${escapeHtml(snapshot.snapshot_id)}" data-status="REJECTED">标记驳回</button><button class="archive" data-archive="${escapeHtml(item.item_id)}">归档整条内容</button></div></div>`;
}

async function openContent(itemId) {
  const panel = $('#admin-detail');
  panel.innerHTML = '<div class="empty-state">打开证据抽屉……</div>';
  const item = await getJson(`/api/admin/content/${encodeURIComponent(itemId)}`);
  panel.innerHTML = `<div><p class="eyebrow">${escapeHtml(item.source_code)} · ${escapeHtml(item.external_id)}</p><h3>${escapeHtml(item.canonical_url)}</h3>${item.snapshots.map((snapshot) => snapshotMarkup(item, snapshot)).join('')}</div>`;
  panel.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', async () => {
    await getJson(`/api/admin/snapshots/${button.dataset.review}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ review_status: button.dataset.status }) });
    toast('审核状态已保存');
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
    await openContent(itemId);
  }));
  panel.querySelectorAll('[data-archive]').forEach((button) => button.addEventListener('click', async () => {
    await getJson(`/api/admin/content/${button.dataset.archive}`, { method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ availability: 'DELETED' }) });
    toast('内容已归档，用户端不再展示');
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
    await openContent(itemId);
  }));
}

function renderScenarios(data) {
  const container = $('#admin-scenario-list');
  if (!data.items.length) { container.innerHTML = '<div class="empty-state">还没有情景。先创建一个可审核抽屉。</div>'; return; }
  container.innerHTML = data.items.map((scenario) => `<article class="admin-scenario-card">
    <h3>${escapeHtml(scenario.name)} <span class="status-pill">${escapeHtml(scenario.review_status)}</span></h3><p>${escapeHtml(scenario.summary || '暂无摘要')}</p>
    <div>${scenario.branches.map((branch) => `<div class="branch-editor"><strong>${escapeHtml(branch.label)}</strong><p>${escapeHtml(branch.action || branch.outcome || '暂无说明')}</p></div>`).join('')}</div>
    <details class="branch-editor"><summary>为这个情景添加分叉</summary><form data-branch-form="${escapeHtml(scenario.id)}"><input name="label" placeholder="分叉名称" required><input name="trigger" placeholder="触发条件"><textarea name="action" rows="2" placeholder="采取什么行动"></textarea><textarea name="outcome" rows="2" placeholder="来源观察到的结果"></textarea><input name="source_snapshot_id" placeholder="来源 snapshot_id（可选）"><div class="form-row"><select name="review_status"><option>UNREVIEWED</option><option>CONFIRMED</option><option>REJECTED</option></select><input name="position" type="number" min="0" value="0"></div><button>保存分叉</button></form></details>
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
    const records = file.name.endsWith('.jsonl') ? file ? (await file.text()).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [] : [JSON.parse(await file.text())];
    const result = await getJson('/api/admin/import', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ records }) });
    toast(`导入完成：新增 ${result.created}，未变化 ${result.unchanged}，拒绝 ${result.rejected}`);
    await Promise.all([loadStats(), loadContent($('#admin-search').value.trim())]);
  } catch (error) { toast(`导入失败：${error.message}`); }
  event.target.value = '';
});

Promise.all([loadStats(), loadContent(), loadScenarios()]).catch((error) => toast(error.message));
