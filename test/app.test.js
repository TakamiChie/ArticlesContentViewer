import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { openDatabase, createApp, llmBase, parseLlmTags, aggregateLlmTags } from '../server.js';

test('LLM tags support stored formats and aggregate per content', () => {
  assert.deepEqual(parseLlmTags('["地域", "教育"]'), ['地域', '教育']);
  assert.deepEqual(parseLlmTags('地域、教育\n#活動'), ['地域', '教育', '#活動']);
  assert.deepEqual(aggregateLlmTags([
    { llm_tags: '["地域", "地域", "教育"]' },
    { llm_tags: '地域，福祉' },
    { llm_tags: '["ＲＥＤ"]' },
    { llm_tags: '["red"]' }
  ]), [
    { tag: 'ＲＥＤ', count: 2 },
    { tag: '地域', count: 2 },
    { tag: '教育', count: 1 },
    { tag: '福祉', count: 1 }
  ]);
});

test('schema, all rows, literal search, paging, detail, LLM and origin protection', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'viewer-'));
  const path = join(temp, 'test.sqlite');
  const writer = new DatabaseSync(path);
  writer.exec(readFileSync(new URL('../SCHEME.sql', import.meta.url), 'utf8'));
  writer.prepare('INSERT INTO SOURCE VALUES (1, ?, ?, ?, ?, ?)').run('test', '配信元', 'podcast', '', null);
  writer.exec('PRAGMA foreign_keys = OFF');
  const insert = writer.prepare('INSERT INTO ARTICLE(content_id, source_id, title, url, llm_summary, llm_tags) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 35; i++) insert.run(String(i), i === 34 ? 999 : 1, i === 0 ? '100% テスト ＡＢＣ' : `記事${i}`, 'https://listen.style/p/test/example', i === 1 ? '地域の活動' : '概要', i === 2 ? '["地域", "教育", "地域"]' : i === 3 ? '地域、福祉' : null);
  writer.close();
  const db = openDatabase(path), server = createApp(db);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [];
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (raw) requests.push(JSON.parse(raw));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/models') ? { data: [{ id: 'test-model' }] } : { choices: [{ finish_reason: 'stop', message: { content: '共通のメッセージ [1] [2]' } }] }));
  });
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    let data = await (await fetch(base + '/api/articles')).json();
    assert.equal(data.total, 35); assert.equal(data.items.length, 30);
    data = await (await fetch(base + '/api/articles?page=2')).json(); assert.equal(data.items.length, 5);
    for (const q of ['%', 'abc', '地域']) {
      data = await (await fetch(base + '/api/articles?q=' + encodeURIComponent(q))).json();
      assert.equal(data.total, q === '地域' ? 3 : 1);
    }
    data = await (await fetch(base + '/api/articles?q=' + encodeURIComponent('地域 活動'))).json(); assert.equal(data.total, 1);
    data = await (await fetch(base + '/api/tags')).json();
    assert.deepEqual(data.tags, [{ tag: '地域', count: 2 }, { tag: '教育', count: 1 }, { tag: '福祉', count: 1 }]);
    data = await (await fetch(base + '/api/articles?q=' + encodeURIComponent("' OR 1=1 --"))).json(); assert.equal(data.total, 0);
    data = await (await fetch(base + '/api/article?id=34')).json(); assert.equal(data.content_id, '34'); assert.equal(data.source_name, null);
    assert.throws(() => db.exec('DELETE FROM ARTICLE'), /readonly/);
    assert.throws(() => llmBase('https://example.com/v1'));
    assert.equal((await post('/api/models', {}, { Origin: 'https://evil.example' })).status, 403);
    const config = { baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'test-model' };
    data = await (await post('/api/models', config)).json(); assert.deepEqual(data.models, ['test-model']);
    data = await (await post('/api/summarize', { ...config, ids: ['0', '1'] })).json();
    assert.match(data.text, /共通/); assert.equal(data.sources.length, 2); assert.match(requests.at(-1).messages[1].content, /地域の活動/);
    assert.equal((await post('/api/summarize', { ...config, ids: ['0', 'missing'] })).status, 400);
    assert.equal((await post('/api/summarize', { ...config, ids: ['0'] })).status, 400);
    assert.equal((await fetch(base + '/SCHEME.sql')).status, 404);
    const updater = new DatabaseSync(path);
    updater.prepare('UPDATE ARTICLE SET llm_summary = ? WHERE content_id IN (?, ?)').run('地域活動。'.repeat(1601), '0', '1');
    updater.close();
    const before = requests.length;
    data = await (await post('/api/summarize', { ...config, ids: ['0', '1'] })).json();
    assert.equal(requests.length - before, 3);
    assert.ok(data.warnings.some(x => x.includes('先頭8,000文字')));
    assert.ok(data.warnings.some(x => x.includes('2組')));
    assert.equal(data.sources[1].content_id, '1');
  } finally {
    server.closeAllConnections(); mock.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => mock.close(resolve))]);
    db.close(); rmSync(temp, { recursive: true });
  }
});
