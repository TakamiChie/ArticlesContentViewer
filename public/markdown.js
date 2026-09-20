const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function safeHref(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : null;
  } catch {
    return null;
  }
}

function inlineMarkdown(value) {
  const tokens = [];
  const token = html => {
    const index = tokens.push(html) - 1;
    return `\uE000${index}\uE001`;
  };

  let text = String(value).replace(/[\uE000\uE001]/g, '');
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => token(`<code>${escapeHtml(code.trim())}</code>`));
  text = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (all, label, url) => {
    const href = safeHref(url);
    return href ? token(`<a href="${href}" target="_blank" rel="noopener noreferrer">${inlineMarkdown(label)}</a>`) : all;
  });
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  text = text
    .replace(/\*\*(?=\S)(.+?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?\S)__/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)(.+?\S)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*(?=\S)(.+?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_(?=\S)(.+?\S)_(?!_)/g, '$1<em>$2</em>');
  return text.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)]);
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function startsBlock(lines, index) {
  const line = lines[index] || '';
  return /^\s*$/.test(line)
    || /^ {0,3}(```|~~~)/.test(line)
    || /^ {0,3}#{1,6}\s+/.test(line)
    || /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line)
    || /^ {0,3}>\s?/.test(line)
    || /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || (index + 1 < lines.length && line.includes('|') && isTableDivider(lines[index + 1]));
}

/** Converts the supported Markdown subset to escaped, safe HTML. */
export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^ {0,3}(```|~~~)\s*([\w-]*)\s*$/);
    if (fence) {
      const content = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[1]}\\s*$`).test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      const language = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(content.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>'); i++; continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isTableDivider(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
      html.push(`<div class="table-scroll"><table><thead><tr>${headers.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, column) => `<td>${inlineMarkdown(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}>\s?/, ''));
      html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const list = line.match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^ {0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(`<li>${inlineMarkdown(item[2])}</li>`);
        i++;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && !startsBlock(lines, i)) paragraph.push(lines[i++].trim());
    html.push(`<p>${inlineMarkdown(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`);
  }
  return html.join('\n');
}
