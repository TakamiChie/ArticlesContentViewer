import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
const path = new URL('demo.sqlite', import.meta.url);
if (existsSync(path)) {
  console.log('既存のdemo.sqliteを使用します。');
} else {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('SCHEME.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT INTO SOURCE VALUES (?, ?, ?, ?, ?, ?)').run(1, 'demo', '動作確認用ポッドキャスト（架空）', 'podcast', '', null);
  db.prepare('INSERT INTO SOURCE VALUES (?, ?, ?, ?, ?, ?)').run(2, 'blog', '動作確認用ブログ（架空）', 'blog', '', null);
  const insert = db.prepare('INSERT INTO ARTICLE (content_id, source_id, title, url, published_at, summary, llm_summary, llm_tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 1; i <= 65; i++) {
    insert.run(`demo-${i}`, i % 3 ? 1 : 2, `【架空サンプル ${i}】${i % 2 ? '地域でプログラミングを楽しむ' : 'ゲームがつなぐ世代間の交流'}`, 'https://example.com/demo/' + i, `2026-08-${String(i % 28 + 1).padStart(2, '0')}`, 'これは実際の配信ではない動作確認用データです。', i % 5 ? '地域の集まりでデジタル機器を使い、参加者同士が教え合う活動について紹介。得意なことを持ち寄り、継続して集まれる場所を作る大切さを考えます。' : null, i % 2 ? '["地域活動", "プログラミング"]' : '地域活動, ゲーム, 多世代交流');
  }
  db.close();
  console.log('架空サンプル65件のdemo.sqliteを作成しました。');
}
