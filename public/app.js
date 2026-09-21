import { markdownToHtml } from './markdown.js';

const $ = id => document.getElementById(id);
const state = { page: 1, pages: 1, items: [], tags: new Set(), models: [], visibleModels: [], selected: new Map(), busy: false, controller: null, result: '', searchController: null, detailController: null };
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
    if (Array.isArray(data)) return data.map(x => typeof x === 'string' ? x : JSON.stringify(x)).map(x => x.trim()).filter(Boolean);
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
  $('exportTranscripts').disabled = state.selected.size === 0;
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
let appliedTag = '';
function searchTag() {
  const tag = $('tagSelect').value.trim();
  const key = tag.normalize('NFKC').toLowerCase();
  if (!state.tags.has(key)) { appliedTag = ''; return; }
  if (appliedTag === key && $('query').value === tag && $('field').value === 'llm_tags') return;
  appliedTag = key;
  clearTimeout(debounce);
  $('query').value = tag;
  $('field').value = 'llm_tags';
  state.page = 1;
  load().catch(report);
}
$('tagSelect').oninput = searchTag;
$('tagSelect').onchange = searchTag;
$('tagSelect').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); searchTag(); } };
for (const id of ['field', 'source', 'type', 'sort']) $(id).onchange = () => { state.page = 1; load().catch(report); };
$('prev').onclick = () => { state.page--; load().catch(report); };
$('next').onclick = () => { state.page++; load().catch(report); };
$('refresh').onclick = () => Promise.all([loadTags(), load()]).catch(report);
$('pageSelect').onclick = () => { state.items.forEach(row => state.selected.set(row.content_id, row)); render(); };
$('clear').onclick = () => { state.selected.clear(); render(); };
$('settingsOpen').onclick = () => $('settings').showModal();
$('settingsClose').onclick = () => $('settings').close();
$('settingsSave').onclick = () => {
  const { baseUrl, model } = config();
  try { localStorage.setItem('onpu-llm', JSON.stringify({ baseUrl, model })); } catch { $('status').textContent = '設定を永続保存できないため、この画面を開いている間のみ使用します。'; }
  $('settings').close();
};
let activeModel = -1;
function closeModelList() {
  $('modelList').hidden = true;
  $('model').setAttribute('aria-expanded', 'false');
  $('modelToggle').setAttribute('aria-expanded', 'false');
  $('model').removeAttribute('aria-activedescendant');
  activeModel = -1;
}
function highlightModel(index) {
  const options = [...$('modelList').querySelectorAll('[role="option"]')];
  if (!options.length) return;
  activeModel = (index + options.length) % options.length;
  options.forEach((option, i) => { option.classList.toggle('active', i === activeModel); option.setAttribute('aria-selected', String(i === activeModel)); });
  $('model').setAttribute('aria-activedescendant', options[activeModel].id);
  options[activeModel].scrollIntoView({ block: 'nearest' });
}
function persistModel() {
  try {
    const saved = JSON.parse(localStorage.getItem('onpu-llm') || '{}');
    localStorage.setItem('onpu-llm', JSON.stringify({ ...saved, model: $('model').value.trim() }));
  } catch { /* Storage may be disabled. */ }
}
function chooseModel(model) {
  $('model').value = model;
  $('modelStatus').textContent = '';
  persistModel();
  closeModelList();
  $('model').focus();
}
function openModelList(showAll = false) {
  const query = showAll ? '' : $('model').value.normalize('NFKC').toLowerCase();
  state.visibleModels = state.models.filter(model => model.normalize('NFKC').toLowerCase().includes(query));
  const options = state.visibleModels.map((model, i) => {
    const option = el('button', model); option.type = 'button'; option.id = `modelOption${i}`; option.setAttribute('role', 'option'); option.tabIndex = -1;
    option.onmousedown = event => event.preventDefault();
    option.onclick = () => chooseModel(model);
    return option;
  });
  $('modelList').replaceChildren(...(options.length ? options : [el('div', state.models.length ? '一致する候補はありません。' : '接続設定からモデル一覧を取得してください。', 'comboEmpty')]));
  $('modelList').hidden = false;
  $('model').setAttribute('aria-expanded', 'true');
  $('modelToggle').setAttribute('aria-expanded', 'true');
  activeModel = -1;
}
$('model').onfocus = () => openModelList(true);
$('model').onclick = () => openModelList(true);
$('model').oninput = () => openModelList(false);
$('model').onchange = persistModel;
$('model').onblur = () => setTimeout(() => { if (!document.activeElement?.closest('.modelPicker')) closeModelList(); });
$('model').onkeydown = event => {
  if (event.key === 'Escape') { closeModelList(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if ($('modelList').hidden) openModelList(true);
    highlightModel(activeModel + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter' && activeModel >= 0) {
    event.preventDefault(); chooseModel(state.visibleModels[activeModel]);
  }
};
$('modelToggle').onclick = () => {
  if ($('modelList').hidden) { openModelList(true); $('model').focus({ preventScroll: true }); }
  else closeModelList();
};
document.addEventListener('mousedown', event => { if (!event.target.closest('.modelPicker')) closeModelList(); });
$('models').onclick = async () => {
  $('models').disabled = true; $('modelFetchStatus').textContent = '接続中…';
  try {
    const data = await api('/api/models', config());
    state.models = [...new Set(data.models.filter(model => typeof model === 'string' && model))];
    if (!$('model').value && data.models[0]) $('model').value = data.models[0];
    $('modelFetchStatus').textContent = `${state.models.length}件のモデルを取得しました。設定を保存して閉じてから、モデルID欄で選択してください。`;
    $('modelStatus').textContent = `${state.models.length}件のモデル候補を利用できます。`;
  } catch (error) { $('modelFetchStatus').textContent = error.message; }
  finally { $('models').disabled = false; }
};
function save(name, text, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function references(rows) { return rows.map((r, i) => `${r.number || i + 1}. ${r.title}\n   ${safeUrl(r.url) || 'URLなし'}\n   ID: ${r.content_id}`).join('\n'); }
$('exportLinks').onclick = () => save('selected-contents.md', `# 選択したコンテンツ\n\n${references([...state.selected.values()])}\n`);
$('exportTranscripts').onclick = () => {
  $('transcriptExportError').textContent = '';
  $('transcriptExport').showModal();
};
$('transcriptExportCancel').onclick = () => $('transcriptExport').close();
$('transcriptExportForm').onsubmit = async event => {
  event.preventDefault();
  const include = [...new FormData(event.currentTarget).getAll('include')];
  if (!include.length) { $('transcriptExportError').textContent = '保存する項目を1つ以上選択してください。'; return; }
  const button = $('exportTranscripts');
  const submit = event.submitter || event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true; submit.disabled = true; $('transcriptExportError').textContent = ''; $('exportStatus').textContent = 'テキストを準備中…';
  try {
    const data = await api('/api/transcripts', { ids: [...state.selected.keys()], include });
    if (!data.count) { $('transcriptExportError').textContent = '選択した項目に文字起こし（VTT）はありません。'; $('exportStatus').textContent = ''; return; }
    save('selected-transcripts.txt', data.text, 'text/plain;charset=utf-8');
    $('transcriptExport').close();
    $('exportStatus').textContent = `${data.count}件のテキストを保存しました。`;
  } catch (error) { $('transcriptExportError').textContent = error.message; $('exportStatus').textContent = ''; }
  finally { button.disabled = state.selected.size === 0; submit.disabled = false; }
};
$('saveResult').onclick = () => save('content-summary.md', state.result);
$('cancel').onclick = () => state.controller?.abort();
$('summarize').onclick = async () => {
  if (!config().model) { $('modelStatus').textContent = 'モデルIDを入力するか、LLM接続設定で一覧を取得してください。'; $('model').focus(); return; }
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
async function loadTags() {
  const data = await api('/api/tags');
  state.tags.clear();
  $('tagOptions').replaceChildren();
  for (const item of data.tags) {
    state.tags.add(item.tag.normalize('NFKC').toLowerCase());
    const option = el('option'); option.value = item.tag; option.label = `${item.count.toLocaleString()}件`;
    $('tagOptions').append(option);
  }
}
async function init() {
  const [meta] = await Promise.all([api('/api/meta'), loadTags()]);
  for (const source of meta.sources) { const option = el('option', source.source_name); option.value = source.id; $('source').append(option); }
  for (const type of [...new Set(meta.sources.map(x => x.source_type))]) { const option = el('option', type); option.value = type; $('type').append(option); }
  await load();
}
init().catch(report);
