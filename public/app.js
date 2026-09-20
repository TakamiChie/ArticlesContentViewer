import { markdownToHtml } from './markdown.js';

const $ = id => document.getElementById(id);
const state = { page: 1, pages: 1, items: [], selected: new Map(), busy: false, controller: null, result: '', searchController: null, detailController: null };
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function tags(value) {
  if (!value) return [];
  try {
    const data = JSON.parse(value);
    if (Array.isArray(data)) return data.map(x => typeof x === 'string' ? x : JSON.stringify(x));
  } catch { /* Plain-text tag lists are also supported. */ }
  return String(value).split(/[,，、\n]+|\s+(?=#)/).map(x => x.trim()).filter(Boolean);
}
async function api(path, body, signal) {
  const res = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function report(error) { if (error.name !== 'AbortError') $('status').textContent = error.message; }
function config() { return { baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim(), apiKey: $('apiKey').value }; }
try {
  const saved = JSON.parse(localStorage.getItem('onpu-llm') || '{}');
  if (saved.baseUrl) $('baseUrl').value = saved.baseUrl;
  if (saved.model) $('model').value = saved.model;
} catch { /* Storage may be disabled. */ }
function drawTags(container, value) {
  const group = el('div', undefined, 'tags');
  for (const tag of tags(value)) {
    const button = el('button', tag, 'tag');
    button.onclick = () => { $('query').value = tag; $('field').value = 'llm_tags'; state.page = 1; load().catch(report); };
    group.append(button);
  }
  container.append(group);
}
function updateSelected() {
  $('selectedCount').textContent = `${state.selected.size}件選択`;
  $('selected').replaceChildren();
  for (const [id, row] of state.selected) {
    const line = el('div', undefined, 'selectedItem');
    const remove = el('button', '×'); remove.setAttribute('aria-label', `${row.title}の選択解除`);
    remove.onclick = () => { state.selected.delete(id); render(); };
    line.append(el('span', row.title), remove); $('selected').append(line);
  }
  $('summarize').disabled = state.busy || state.selected.size < 2 || state.selected.size > 100;
  $('exportLinks').disabled = state.selected.size === 0;
}
function render() {
  $('list').replaceChildren();
  for (const row of state.items) {
    const card = el('article', undefined, 'card');
    const check = el('input'); check.type = 'checkbox'; check.checked = state.selected.has(row.content_id);
    check.setAttribute('aria-label', `${row.title}を選択`);
    check.onchange = () => { if (check.checked) state.selected.set(row.content_id, row); else state.selected.delete(row.content_id); updateSelected(); };
    const content = el('div');
    content.append(el('div', `${row.source_name || '配信元未登録'} ・ ${row.source_type || '種類未登録'} ・ ${row.published_at || '日付未設定'}`, 'meta'));
    const heading = el('h3'), title = el('button', row.title, 'title');
    title.onclick = () => detail(row.content_id); heading.append(title); content.append(heading);
    const summary = row.llm_summary?.trim();
    content.append(el('div', summary ? 'LLM概要' : 'LLM概要なし・既存summary', 'meta'));
    content.append(el('p', summary || row.summary || '概要はまだありません。', 'summary clamp'));
    drawTags(content, row.llm_tags); card.append(check, content); $('list').append(card);
  }
  if (!state.items.length) $('list').append(el('p', '一致するコンテンツはありません。検索条件を変更してください。'));
  $('page').textContent = `${state.page} / ${state.pages}ページ`;
  $('prev').disabled = state.page <= 1; $('next').disabled = state.page >= state.pages;
  updateSelected();
}
async function load() {
  state.searchController?.abort(); state.searchController = new AbortController();
  const controller = state.searchController;
  const params = new URLSearchParams({ q: $('query').value, field: $('field').value, source: $('source').value, type: $('type').value, sort: $('sort').value, page: state.page });
  $('status').textContent = '';
  const data = await api(`/api/articles?${params}`, null, controller.signal);
  if (controller !== state.searchController) return;
  state.items = data.items; state.page = data.page; state.pages = data.pages;
  $('count').textContent = `${data.total.toLocaleString()}件のコンテンツ`;
  render();
}
function closeDetail() { state.detailController?.abort(); $('detail').close(); $('detailBody').replaceChildren(); }
$('detailClose').onclick = closeDetail;
$('detail').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
async function detail(id) {
  state.detailController?.abort(); const controller = new AbortController(); state.detailController = controller;
  $('detailBody').replaceChildren(el('p', '読み込み中…')); $('detail').showModal();
  try {
    const row = await api(`/api/article?id=${encodeURIComponent(id)}`, null, controller.signal);
    const body = $('detailBody'); body.replaceChildren();
    const cover = safeUrl(row.cover_art);
    if (cover) { const img = el('img'); img.src = cover; img.alt = ''; img.referrerPolicy = 'no-referrer'; body.append(img); }
    body.append(el('h2', row.title), el('p', `${row.source_name || ''} ・ ${row.published_at || ''}`, 'meta'));
    const href = safeUrl(row.url);
    if (href) {
      const link = el('a', 'コンテンツの実ページを開く ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);
      const url = new URL(href);
      if (url.hostname === 'listen.style' && /^\/p\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
        const frame = el('iframe'); frame.title = `${row.title}のLISTENプレイヤー`;
        frame.src = `https://listen.style${url.pathname.replace(/\/$/, '')}/player?theme=auto`;
        frame.height = '178'; frame.width = '100%'; frame.setAttribute('scrolling', 'no'); frame.allow = 'autoplay'; body.append(frame);
      } else { body.append(el('p', 'このコンテンツは実ページでご覧ください。', 'hint')); }
    }
    body.append(el('h3', 'LLM概要'), el('p', row.llm_summary || '未生成', 'summary'));
    drawTags(body, row.llm_tags);
    body.append(el('h3', '元の概要'), el('p', row.summary || '未登録', 'summary'));
    if (row.llm_hashtags) body.append(el('h3', 'LLMハッシュタグ'), el('p', row.llm_hashtags));
    if (row.transcript_vtt) { const details = el('details'); details.append(el('summary', '文字起こし（VTT）を表示'), el('pre', row.transcript_vtt)); body.append(details); }
  } catch (error) { if (error.name !== 'AbortError') $('detailBody').replaceChildren(el('p', error.message)); }
}
let debounce;
$('query').oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => { state.page = 1; load().catch(report); }, 250); };
for (const id of ['field', 'source', 'type', 'sort']) $(id).onchange = () => { state.page = 1; load().catch(report); };
$('prev').onclick = () => { state.page--; load().catch(report); };
$('next').onclick = () => { state.page++; load().catch(report); };
$('refresh').onclick = () => load().catch(report);
$('pageSelect').onclick = () => { state.items.forEach(row => state.selected.set(row.content_id, row)); render(); };
$('clear').onclick = () => { state.selected.clear(); render(); };
$('settingsOpen').onclick = () => $('settings').showModal();
$('settingsClose').onclick = () => $('settings').close();
$('settingsSave').onclick = () => {
  const { baseUrl, model } = config();
  try { localStorage.setItem('onpu-llm', JSON.stringify({ baseUrl, model })); } catch { $('status').textContent = '設定を永続保存できないため、この画面を開いている間のみ使用します。'; }
  $('settings').close();
};
$('models').onclick = async () => {
  $('models').disabled = true; $('modelStatus').textContent = '接続中…';
  try {
    const data = await api('/api/models', config());
    $('modelList').replaceChildren(...data.models.map(model => { const option = el('option'); option.value = model; return option; }));
    if (!$('model').value && data.models[0]) $('model').value = data.models[0];
    $('modelStatus').textContent = `${data.models.length}件のモデルを取得しました。`;
  } catch (error) { $('modelStatus').textContent = error.message; }
  finally { $('models').disabled = false; }
};
function save(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function references(rows) { return rows.map((r, i) => `${r.number || i + 1}. ${r.title}\n   ${safeUrl(r.url) || 'URLなし'}\n   ID: ${r.content_id}`).join('\n'); }
$('exportLinks').onclick = () => save('selected-contents.md', `# 選択したコンテンツ\n\n${references([...state.selected.values()])}\n`);
$('saveResult').onclick = () => save('content-summary.md', state.result);
$('cancel').onclick = () => state.controller?.abort();
$('summarize').onclick = async () => {
  if (!config().model) { $('modelStatus').textContent = 'モデルを取得または入力してください。'; $('settings').showModal(); return; }
  state.busy = true; state.controller = new AbortController(); updateSelected();
  $('cancel').hidden = false; $('resultPanel').hidden = false; $('saveResult').disabled = true;
  $('result').textContent = ''; $('references').replaceChildren();
  const ids = [...state.selected.keys()]; const instruction = $('instruction').value;
  const started = Date.now();
  const progress = () => { $('generationStatus').textContent = `${ids.length}件を生成中… ${Math.floor((Date.now() - started) / 1000)}秒（多い場合は分割して統合します）`; };
  progress(); const timer = setInterval(progress, 1000);
  try {
    const data = await api('/api/summarize', { ...config(), ids, instruction }, state.controller.signal);
    clearInterval(timer);
    $('result').innerHTML = markdownToHtml(data.text);
    $('generationStatus').textContent = ['生成完了。原音・原文と照合してからご利用ください。', ...data.warnings].join('\n');
    for (const source of data.sources) {
      const li = el('li'); const link = el('a', `[${source.number}] ${source.title}`);
      const href = safeUrl(source.url); if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      li.append(link); $('references').append(li);
    }
    state.result = `# コンテンツのまとめ\n\n作成日時: ${new Date().toISOString()}\n視点: ${instruction || '共通メッセージと活動紹介'}\n\n${data.text}\n\n## 処理について\n${data.warnings.join('\n')}\n\n## 使用した資料\n${references(data.sources)}\n`;
    $('saveResult').disabled = false;
  } catch (error) { clearInterval(timer); $('generationStatus').textContent = error.name === 'AbortError' ? '生成を中止しました。' : error.message; }
  finally { clearInterval(timer); state.busy = false; $('cancel').hidden = true; updateSelected(); }
};
async function init() {
  const meta = await api('/api/meta');
  for (const source of meta.sources) { const option = el('option', source.source_name); option.value = source.id; $('source').append(option); }
  for (const type of [...new Set(meta.sources.map(x => x.source_type))]) { const option = el('option', type); option.value = type; $('type').append(option); }
  await load();
}
init().catch(report);
