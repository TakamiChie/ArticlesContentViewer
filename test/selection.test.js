import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function setup() {
  const nodes = new Map();
  const element = () => ({
    value: '', textContent: '', children: [], disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, addEventListener() {}
  });
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const requests = [];
  const context = {
    document: { getElementById: get, createElement: element, addEventListener() {} },
    localStorage: { getItem() { return null; } },
    URL, URLSearchParams, AbortController,
    setTimeout() {}, clearTimeout() {},
    fetch(path, options) {
      return new Promise(resolve => requests.push({
        path, signal: options.signal,
        respond(data, ok = true) { resolve({ ok, json: async () => data }); }
      }));
    }
  };
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
    .replace("import { markdownToHtml } from './markdown.js';", '')
    .replace('init().catch(report);', 'globalThis.viewer = { state, render };');
  runInNewContext(source, context);
  return { get, requests, ...context.viewer };
}

test('全件選択は2ページ目からも全検索結果を追加し、既存の選択を保持する', async () => {
  const { get, requests, state, render } = setup();
  state.page = 2;
  state.pages = 4;
  state.items = [{ content_id: '30', title: '記事30' }];
  state.selected.set('other', { content_id: 'other', title: '以前の選択' });
  get('query').value = '地域 活動';
  get('field').value = 'llm_tags';
  get('source').value = '1';
  get('type').value = 'podcast';
  get('sort').value = 'old';
  render();
  get('pageSelect').onclick();
  assert.equal(state.selected.size, 2);
  const pending = get('allSelect').onclick();
  assert.equal(get('allSelect').disabled, true);
  assert.equal(new URL(requests[0].path, 'http://localhost').searchParams.get('q'), '地域 活動');
  for (const [key, value] of Object.entries({ field: 'llm_tags', source: '1', type: 'podcast', sort: 'old' })) {
    assert.equal(new URL(requests[0].path, 'http://localhost').searchParams.get(key), value);
  }
  await get('allSelect').onclick();
  assert.equal(requests.length, 1);
  requests[0].respond({ items: Array.from({ length: 105 }, (_, i) => ({ content_id: String(i), title: `記事${i}` })) });
  await pending;
  assert.equal(state.selected.size, 106);
  assert.equal(state.page, 2);
  assert.equal(get('list').children[0].children[0].checked, true);
  assert.equal(get('allSelect').disabled, false);
  assert.equal(get('summarize').disabled, true);
  assert.equal(get('exportLinks').disabled, false);
});

test('検索入力の変更や選択解除で取得中の全件選択を中止する', async () => {
  for (const action of ['query', 'clear']) {
    const { get, requests, state } = setup();
    const pending = get('allSelect').onclick();
    if (action === 'query') get('query').oninput();
    else get('clear').onclick();
    assert.equal(requests[0].signal.aborted, true);
    requests[0].respond({ items: [{ content_id: 'stale', title: '古い結果' }] });
    await pending;
    assert.equal(state.selected.size, 0);
    assert.equal(get('allSelect').disabled, false);
  }
});

test('全件取得の失敗や検索結果0件でも既存の選択を保持する', async () => {
  const { get, requests, state } = setup();
  state.selected.set('existing', { title: '既存の選択' });
  let pending = get('allSelect').onclick();
  requests[0].respond({ error: '取得失敗' }, false);
  await pending;
  assert.equal(get('status').textContent, '取得失敗');
  assert.equal(get('allSelect').disabled, false);
  pending = get('allSelect').onclick();
  requests[1].respond({ items: [] });
  await pending;
  assert.equal(state.selected.size, 1);
  assert.equal(get('status').textContent, '検索結果0件を選択しました。');
});
