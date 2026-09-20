import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../public/markdown.js';

test('Markdownの主要な記法をHTMLに変換する', () => {
  const html = markdownToHtml('# 見出し\n\n**太字**と`コード`\n\n- 一つ\n- 二つ\n\n|項目|内容|\n|---|---|\n|A|説明|');
  assert.match(html, /<h1>見出し<\/h1>/);
  assert.match(html, /<strong>太字<\/strong>と<code>コード<\/code>/);
  assert.match(html, /<ul><li>一つ<\/li><li>二つ<\/li><\/ul>/);
  assert.match(html, /<table>.*<th>項目<\/th>.*<td>説明<\/td>.*<\/table>/s);
});

test('HTMLと危険なリンクを無効化する', () => {
  const html = markdownToHtml('<img src=x onerror=alert(1)> [危険](javascript:alert(1)) [安全](https://example.com/)');
  assert.doesNotMatch(html, /<img|href="javascript:/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/"/);
});
