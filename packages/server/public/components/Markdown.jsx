// Minimal safe markdown renderer — NO innerHTML.
// Supports: code blocks (```), inline code (`), bold (**), italic (*),
// bullet/numbered lists, headings (#..######), links [text](url), paragraphs.

const URL_RE = /^https?:\/\/[^\s)]+$/i;

function renderInline(text, keyPrefix) {
  const out = [];
  let i = 0;
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) {
      out.push(text.slice(i, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        React.createElement('code', { key: keyPrefix + 'c' + m.index, className: 'md-code' }, tok.slice(1, -1))
      );
    } else if (tok.startsWith('**')) {
      out.push(React.createElement('strong', { key: keyPrefix + 'b' + m.index }, tok.slice(2, -2)));
    } else if (tok.startsWith('*')) {
      out.push(React.createElement('em', { key: keyPrefix + 'e' + m.index }, tok.slice(1, -1)));
    } else if (tok.startsWith('[')) {
      const closeBracket = tok.indexOf('](');
      const linkText = tok.slice(1, closeBracket);
      const url = tok.slice(closeBracket + 2, -1);
      if (URL_RE.test(url)) {
        out.push(
          React.createElement(
            'a',
            { key: keyPrefix + 'a' + m.index, href: url, target: '_blank', rel: 'noopener noreferrer', className: 'md-link' },
            linkText
          )
        );
      } else {
        out.push(linkText);
      }
    }
    i = m.index + tok.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function renderBlock(block, key) {
  if (block.type === 'code') {
    return (
      <pre key={key} className="md-pre">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === 'heading') {
    const level = Math.min(6, block.level);
    const Tag = `h${level}`;
    return React.createElement(Tag, { key, className: 'md-h' }, renderInline(block.text, key + 'h'));
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const Tag = block.type === 'ul' ? 'ul' : 'ol';
    return React.createElement(
      Tag,
      { key, className: 'md-list' },
      block.items.map((it, i) => (
        <li key={key + 'li' + i}>{renderInline(it, key + 'li' + i + 'i')}</li>
      ))
    );
  }
  if (block.type === 'p') {
    return <p key={key} className="md-p">{renderInline(block.text, key + 'p')}</p>;
  }
  return null;
}

function parseMarkdown(src) {
  const lines = src.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Code fence
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }
    // Heading
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      blocks.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }
    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    // Blank line
    if (line.trim() === '') { i++; continue; }
    // Paragraph — consume consecutive non-blank, non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length) blocks.push({ type: 'p', text: paraLines.join(' ') });
  }
  return blocks;
}

const Markdown = ({ text }) => {
  const blocks = React.useMemo(() => parseMarkdown(String(text || '')), [text]);
  return <div className="md-root">{blocks.map((b, i) => renderBlock(b, 'b' + i))}</div>;
};

window.Markdown = Markdown;
