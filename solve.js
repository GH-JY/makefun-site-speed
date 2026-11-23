// solve.js: a faster drop-in for makefun-site 1.0.0. Its run(input) returns the same output
// tree makefun-site 1.0.0's build returns for the same input, byte for byte.
// Dependency-free ES module. Single file so the harness loads one module.

// ---------------------------------------------------------------- text rules

const ESCAPABLE = new Uint8Array(128);
for (const ch of '\\`*_[]()#+-.!>') ESCAPABLE[ch.charCodeAt(0)] = 1;

const SPECIAL = new Uint8Array(128);
for (const ch of '\\`*[&<>"\'') SPECIAL[ch.charCodeAt(0)] = 1;

const WS = /\s/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function escapeHtml(text) {
  let out = '';
  let last = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      if (last < i) out += text.slice(last, i);
      out += c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;';
      last = i + 1;
    }
  }
  if (last === 0) return text;
  return last < n ? out + text.slice(last) : out;
}

function slugify(text) {
  const n = text.length;
  let ascii = true;
  for (let i = 0; i < n; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (ascii) {
    let out = '';
    let gap = false;
    for (let i = 0; i < n; i++) {
      let c = text.charCodeAt(i);
      let keep = false;
      if (c >= 65 && c <= 90) { c += 32; keep = true; }
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = true;
      if (!keep) { gap = out.length > 0; continue; }
      if (gap) { out += '-'; gap = false; }
      out += String.fromCharCode(c);
    }
    if (out.length > 64) out = out.slice(0, 64);
    let e = out.length;
    while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
    if (e !== out.length) out = out.slice(0, e);
    return out === '' ? 'untitled' : out;
  }
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(date) {
  const a = date.indexOf('-');
  const b = date.indexOf('-', a + 1);
  return `${Number(date.slice(b + 1))} ${MONTHS[Number(date.slice(a + 1, b)) - 1]} ${date.slice(0, a)}`;
}

const isSpace = (c) =>
  c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 160 || c === 5760 ||
  (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;

function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) {
      if (c === 32 || (c >= 9 && c <= 13)) inWord = false;
      else if (!inWord) { inWord = true; count++; }
    } else if (isSpace(c)) inWord = false;
    else if (!inWord) { inWord = true; count++; }
  }
  return count;
}

// ---------------------------------------------------------------- front matter

const KEYS = Object.freeze(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;
const BLANK_RE = /^[ \t]*$/;
const TRAIL = /[ \t]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  const n = text.length;
  if (n < 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45 ||
      (n > 3 && text.charCodeAt(3) !== 10)) return { error: 'no front matter' };
  let close = -1;
  let closeEnd = -1;
  let start = 4;
  while (start <= n) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? n : nl;
    if (end - start === 3 && text.charCodeAt(start) === 45 && text.charCodeAt(start + 1) === 45 && text.charCodeAt(start + 2) === 45) {
      close = start;
      closeEnd = end;
      break;
    }
    if (nl === -1) break;
    start = nl + 1;
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  let p = 4;
  let lineNo = 1;
  while (p < close) {
    const nl = text.indexOf('\n', p);
    const line = text.slice(p, nl);
    p = nl + 1;
    lineNo++;
    if (BLANK_RE.test(line) || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${lineNo} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(TRAIL, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === n ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- markdown

function fenceClose(line) {
  if (line.length < 3 || line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function isContinued(line) {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === 32) i++;
  return i >= 2 && i < line.length && !WS.test(line[i]);
}

function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c !== 32 && c !== 9) break;
    b--;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

// A backslash escapes the next character when that character is escapable, so runs of
// backslashes pair off from the left: a character is escaped when an odd number precede it.
function isEscaped(s, j) {
  let n = 0;
  for (let k = j - 1; k >= 0 && s.charCodeAt(k) === 92; k--) n++;
  return (n & 1) === 1;
}

function findUnescaped(s, ch, from) {
  const needle = String.fromCharCode(ch);
  let j = from;
  for (;;) {
    j = s.indexOf(needle, j);
    if (j === -1) return -1;
    if (isEscaped(s, j)) { j++; continue; }
    return j;
  }
}

function findStarPair(s, from) {
  let j = from;
  for (;;) {
    j = s.indexOf('**', j);
    if (j === -1) return -1;
    if (isEscaped(s, j)) { j++; continue; }
    return j;
  }
}

function findSingleStar(s, from) {
  let j = from;
  for (;;) {
    j = s.indexOf('*', j);
    if (j === -1) return -1;
    if (isEscaped(s, j)) { j++; continue; }
    if (j + 1 < s.length && s.charCodeAt(j + 1) === 42) { j += 2; continue; }
    return j;
  }
}

// The scanner leans on the engine's own substring search: a global regexp finds the next
// character that could open a construct, and indexOf finds closing stars, brackets and
// backticks, so runs of ordinary text are skipped in native code instead of per character.
const SPECIAL_RE = /[\\`*[&<>"']/g;

function inline(s, env) {
  const n = s.length;
  let out = '';
  let start = 0;
  SPECIAL_RE.lastIndex = 0;
  let m;
  while ((m = SPECIAL_RE.exec(s)) !== null) {
    const i = m.index;
    const c = s.charCodeAt(i);
    if (start < i) out += s.slice(start, i);
    if (c === 38) { out += '&amp;'; start = i + 1; continue; }
    if (c === 60) { out += '&lt;'; start = i + 1; continue; }
    if (c === 62) { out += '&gt;'; start = i + 1; continue; }
    if (c === 34) { out += '&quot;'; start = i + 1; continue; }
    if (c === 39) { out += '&#39;'; start = i + 1; continue; }
    if (c === 92) {
      if (i + 1 < n) {
        const d = s.charCodeAt(i + 1);
        if (d < 128 && ESCAPABLE[d] === 1) {
          out += d === 62 ? '&gt;' : s[i + 1];
          start = i + 2; SPECIAL_RE.lastIndex = i + 2; continue;
        }
      }
      out += '\\'; start = i + 1; SPECIAL_RE.lastIndex = i + 1; continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out += '<code>' + escapeHtml(s.slice(i + 1, j)) + '</code>';
        start = j + 1; SPECIAL_RE.lastIndex = start; continue;
      }
      out += '`'; start = i + 1; SPECIAL_RE.lastIndex = i + 1; continue;
    }
    if (c === 42) {
      if (i + 1 < n && s.charCodeAt(i + 1) === 42) {
        const j = findStarPair(s, i + 2);
        if (j > i + 2) {
          out += '<strong>' + inline(s.slice(i + 2, j), env) + '</strong>';
          start = j + 2; SPECIAL_RE.lastIndex = start; continue;
        }
        out += '**'; start = i + 2; SPECIAL_RE.lastIndex = i + 2; continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        out += '<em>' + inline(s.slice(i + 1, j), env) + '</em>';
        start = j + 1; SPECIAL_RE.lastIndex = start; continue;
      }
      out += '*'; start = i + 1; SPECIAL_RE.lastIndex = i + 1; continue;
    }
    const k = findUnescaped(s, 93, i + 1);
    let mm = -1;
    if (k !== -1 && k + 1 < n && s.charCodeAt(k + 1) === 40) mm = s.indexOf(')', k + 2);
    const target = mm === -1 ? '' : s.slice(k + 2, mm);
    if (target !== '' && !WS.test(target)) {
      out += '<a href="' + escapeHtml(env.link(target)) + '">' + inline(s.slice(i + 1, k), env) + '</a>';
      start = mm + 1; SPECIAL_RE.lastIndex = start; continue;
    }
    out += '['; start = i + 1; SPECIAL_RE.lastIndex = i + 1; continue;
  }
  if (start < n) out += s.slice(start, n);
  return out;
}

// One classifier per line: 0 blank, 1 fence open, 2 heading, 3 hr, 4 quote,
// 5 bullet, 6 ordered, 7 paragraph. Details of the matched shape land on `scan`.
const scan = { lang: '', start: 0, end: 0, depth: 0, startAt: 1, rest: '' };

function scanLine(line) {
  const n = line.length;
  if (n === 0) return 0;
  let k = 0;
  while (k < n) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) break;
    k++;
  }
  if (k === n) return 0;
  const c0 = line.charCodeAt(0);
  if (c0 === 96 && n >= 3 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96) {
    let i = 3;
    while (i < n) {
      const c = line.charCodeAt(i);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
      else break;
    }
    const lang = line.slice(3, i);
    let ok = true;
    while (i < n) {
      const c = line.charCodeAt(i);
      if (c !== 32 && c !== 9) { ok = false; break; }
      i++;
    }
    if (ok) { scan.lang = lang; return 1; }
  }
  if (c0 === 35) {
    let hashes = 0;
    while (hashes < n && line.charCodeAt(hashes) === 35) hashes++;
    if (hashes <= 6 && hashes < n) {
      const c = line.charCodeAt(hashes);
      if (c === 32 || c === 9) {
        let i = hashes;
        while (i < n) {
          const d = line.charCodeAt(i);
          if (d !== 32 && d !== 9) break;
          i++;
        }
        let end = n;
        while (end > i) {
          const d = line.charCodeAt(end - 1);
          if (d !== 32 && d !== 9) break;
          end--;
        }
        if (end !== i) { scan.start = i; scan.end = end; scan.depth = hashes; return 2; }
      }
    }
  }
  if (n >= 3) {
    const b = line.charCodeAt(1), c = line.charCodeAt(2);
    if ((c0 === 45 && b === 45 && c === 45) || (c0 === 42 && b === 42 && c === 42)) {
      let ok = true;
      for (let i = 3; i < n; i++) {
        const d = line.charCodeAt(i);
        if (d !== 32 && d !== 9) { ok = false; break; }
      }
      if (ok) return 3;
    }
  }
  if (c0 === 62) return 4;
  if (n >= 2 && (c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) { scan.rest = line.slice(2); return 5; }
  if (c0 >= 48 && c0 <= 57) {
    let i = 0;
    while (i < n) {
      const c = line.charCodeAt(i);
      if (c < 48 || c > 57) break;
      i++;
    }
    if (i <= 9 && i + 1 < n && line.charCodeAt(i) === 46 && line.charCodeAt(i + 1) === 32) {
      scan.startAt = Number(line.slice(0, i));
      scan.rest = line.slice(i + 2);
      return 6;
    }
  }
  return 7;
}

function renderMarkdown(src, env) {
  const lines = src.split('\n');
  const n = lines.length;
  const ids = new Set();
  let html = '';
  const toc = [];
  let excerpt = null;
  let words = 0;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    const code = scanLine(line);
    if (code === 0) { i++; continue; }
    if (code === 1) {
      words += wordsOf(line);
      const lang = scan.lang;
      const body = [];
      i++;
      while (i < n) {
        const cur = lines[i];
        words += wordsOf(cur);
        if (fenceClose(cur)) { i++; break; }
        body.push(cur);
        i++;
      }
      let codeText = '';
      for (let k = 0; k < body.length; k++) codeText += escapeHtml(body[k]) + '\n';
      const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
      html += `<pre><code${cls}>${codeText}</code></pre>\n`;
      continue;
    }
    if (code === 2) {
      words += wordsOf(line);
      const depth = scan.depth;
      const text = line.slice(scan.start, scan.end);
      const id = uniqueSlug(slugify(text), ids);
      const inner = inline(text, env);
      html += `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      if (depth === 2 || depth === 3) toc.push({ level: depth, id, html: inner });
      i++;
      continue;
    }
    if (code === 3) { words += wordsOf(line); html += '<hr>\n'; i++; continue; }
    if (code === 4) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const raw = lines[i];
        words += wordsOf(raw);
        i++;
        let q = raw.charCodeAt(1) === 32 ? raw.slice(2) : raw.slice(1);
        const t = trimLine(q);
        if (t !== '') body.push(t);
      }
      if (body.length === 0) html += '<blockquote>\n</blockquote>\n';
      else html += `<blockquote>\n<p>${inline(body.join('\n'), env)}</p>\n</blockquote>\n`;
      continue;
    }
    if (code === 5 || code === 6) {
      const isOrdered = code === 6;
      const startAt = isOrdered ? scan.startAt : 1;
      const firstRest = scan.rest;
      const items = [[trimLine(firstRest)]];
      words += wordsOf(line);
      i++;
      while (i < n) {
        const cur = lines[i];
        const c = scanLine(cur);
        let rest = null;
        if (isOrdered) {
          if (c === 6) rest = scan.rest;
        } else if (c === 5) rest = scan.rest;
        if (rest !== null) { words += wordsOf(cur); items.push([trimLine(rest)]); i++; }
        else if (isContinued(cur)) {
          words += wordsOf(cur);
          items[items.length - 1].push(trimLine(cur));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && startAt !== 1 ? `<ol start="${startAt}">` : `<${tag}>`;
      let list = open + '\n';
      for (let k = 0; k < items.length; k++) list += `<li>${inline(items[k].join('\n'), env)}</li>\n`;
      html += `${list}</${tag}>\n`;
      continue;
    }
    words += wordsOf(line);
    const body = [trimLine(line)];
    i++;
    while (i < n) {
      const cur = lines[i];
      const c = scanLine(cur);
      if (c === 0 || c === 1 || c === 2 || c === 3) break;
      words += wordsOf(cur);
      body.push(trimLine(cur));
      i++;
    }
    const inner = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = inner;
    html += `<p>${inner}</p>\n`;
  }
  return { html, toc, excerpt: excerpt ?? '', words };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = BLANK_RE.test(src.slice(lineStart, open)) && BLANK_RE.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

// node kinds: 0 text, 1 var, 2 raw, 3 if, 4 for, 5 include
function parseTemplate(name, src) {
  const root = { kind: -1, body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 0, text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t === 'var' ? 1 : 2, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 4, name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 3, not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 3 || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 4 : 3)) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === -1 ? parent.body : parent.kind === 4 ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 5, name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind === 4 ? 'for' : 'if'} is not closed`);
  return root.body;
}

function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '';
    for (let k = 0; k < v.length; k++) out += (k === 0 ? '' : ', ') + textOf(v[k]);
    return out;
  }
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function lookup(root, frames, path) {
  if (frames.length === 0 && path.length === 1) {
    const k = path[0];
    return Object.hasOwn(root, k) ? root[k] : undefined;
  }
  const first = path[0];
  let v;
  if (first === 'loop') {
    if (frames.length === 0) {
      if (!Object.hasOwn(root, 'loop')) return undefined;
      v = root.loop;
    } else v = frames[frames.length - 1].loop;
  } else {
    let found = false;
    for (let k = frames.length - 1; k >= 0; k--) {
      if (frames[k].name === first) { v = frames[k].value; found = true; break; }
    }
    if (!found) {
      if (!Object.hasOwn(root, first)) return undefined;
      v = root[first];
    }
  }
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

const framePool = [];

function renderNodes(nodes, frames, root, ctx, depth) {
  let out = '';
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    const kind = n.kind;
    if (kind === 0) { out += n.text; continue; }
    if (kind === 1) {
      const v = lookup(root, frames, n.path);
      out += typeof v === 'string' ? escapeHtml(v) : escapeHtml(textOf(v));
      continue;
    }
    if (kind === 2) {
      const v = lookup(root, frames, n.path);
      out += typeof v === 'string' ? v : textOf(v);
      continue;
    }
    if (kind === 3) {
      const v = truthy(lookup(root, frames, n.path));
      const branch = v !== n.not ? n.then : n.else;
      if (branch !== null) out += renderNodes(branch, frames, root, ctx, depth);
      continue;
    }
    if (kind === 4) {
      const xs = lookup(root, frames, n.path);
      if (Array.isArray(xs)) {
        const L = frames.length;
        let fr = framePool[L];
        if (fr === undefined) {
          fr = framePool[L] = { name: '', value: null, loop: { index: 0, first: false, last: false, length: 0 } };
        }
        fr.name = n.name;
        const loop = fr.loop;
        const len = xs.length;
        frames.push(fr);
        const bits = n.memo;
        if (bits === undefined) {
          for (let k = 0; k < len; k++) {
            fr.value = xs[k];
            loop.index = k + 1;
            loop.first = k === 0;
            loop.last = k === len - 1;
            loop.length = len;
            out += renderNodes(n.body, frames, root, ctx, depth);
          }
        } else {
          let caches = n.memoAt;
          if (caches === undefined) caches = n.memoAt = [];
          let slot = caches[depth];
          if (slot === undefined) slot = caches[depth] = [undefined, undefined, undefined, undefined];
          for (let k = 0; k < len; k++) {
            const el = xs[k];
            fr.value = el;
            loop.index = k + 1;
            loop.first = k === 0;
            loop.last = k === len - 1;
            loop.length = len;
            const vi = ((bits & 1) !== 0 && loop.first ? 1 : 0) | ((bits & 2) !== 0 && loop.last ? 2 : 0);
            let m = slot[vi];
            if (m === undefined) m = slot[vi] = new Map();
            let s = m.get(el);
            if (s === undefined) {
              s = renderNodes(n.body, frames, root, ctx, depth);
              m.set(el, s);
            }
            out += s;
          }
        }
        frames.pop();
      }
      continue;
    }
    // include
    const t = ctx.templates.get(n.name);
    if (t !== undefined && depth < INCLUDE_DEPTH) {
      if (n.cd !== undefined && depth + n.cd < INCLUDE_DEPTH) {
        let s = ctx.constCache.get(n);
        if (s === undefined) {
          s = renderNodes(t, frames, root, ctx, depth + 1);
          ctx.constCache.set(n, s);
        }
        out += s;
      } else out += renderNodes(t, frames, root, ctx, depth + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------- constant include sites
//
// root carries site, tags and recent, built once per case, and the page vars of the render
// in progress. A name outside those seven is never defined, and a for-name is only ever a
// loop variable, so both can be read as constants only when a const-sourced loop binds them.
// An include whose whole expansion reads nothing else renders the same string on every call
// of the case, so renderNodes may keep its output on the node.

const ROOT_VARY = new Set(['page', 'posts', 'pager', 'tag']);
const loopNames = new Set();

function nameConst(name, scope) {
  const s = scope.get(name);
  if (s !== undefined) return s;
  if (ROOT_VARY.has(name) || name === 'loop' || loopNames.has(name)) return false;
  return true;
}

function expansionConst(nodes, scope, templates, visiting) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.kind;
    if (k === 1 || k === 2) {
      if (!nameConst(n.path[0], scope)) return false;
    } else if (k === 3) {
      if (!nameConst(n.path[0], scope)) return false;
      if (!expansionConst(n.then, scope, templates, visiting)) return false;
      if (n.else !== null && !expansionConst(n.else, scope, templates, visiting)) return false;
    } else if (k === 4) {
      const was = scope.get(n.name);
      const wasLoop = scope.get('loop');
      const ok = nameConst(n.path[0], scope);
      scope.set(n.name, ok);
      scope.set('loop', ok);
      const bodyOk = expansionConst(n.body, scope, templates, visiting);
      if (was === undefined) scope.delete(n.name); else scope.set(n.name, was);
      if (wasLoop === undefined) scope.delete('loop'); else scope.set('loop', wasLoop);
      if (!ok || !bodyOk) return false;
    } else if (k === 5) {
      const t = templates.get(n.name);
      if (t === undefined) continue;
      if (visiting.has(n.name)) return false;
      visiting.add(n.name);
      const ok = expansionConst(t, scope, templates, visiting);
      visiting.delete(n.name);
      if (!ok) return false;
    }
  }
  return true;
}

function expansionDepth(nodes, templates) {
  let d = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.kind;
    let a = 0;
    if (k === 3) {
      a = expansionDepth(n.then, templates);
      if (n.else !== null) { const b = expansionDepth(n.else, templates); if (b > a) a = b; }
    } else if (k === 4) a = expansionDepth(n.body, templates);
    else if (k === 5) {
      const t = templates.get(n.name);
      if (t !== undefined) a = 1 + expansionDepth(t, templates);
    }
    if (a > d) d = a;
  }
  return d;
}

// A loop body may be rendered once per element and kept when nothing but that element, the
// loop's own first/last flags and build constants can reach it. LOOP_OUT marks reads of the
// loop that encloses the body being checked; reads of inner loops stay element-derived.
const LOOP_OUT = {};

function memoConst(nodes, scope, templates, visiting, reads) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const k = n.kind;
    if (k === 1 || k === 2 || k === 3) {
      const first = n.path[0];
      if (first === 'loop' && scope.get('loop') === LOOP_OUT) {
        if (n.path.length > 1) {
          const prop = n.path[1];
          if (prop === 'first') reads.bits |= 1;
          else if (prop === 'last') reads.bits |= 2;
          else return false;
        }
      } else if (!nameConst(first, scope)) return false;
      if (k === 3) {
        if (!memoConst(n.then, scope, templates, visiting, reads)) return false;
        if (n.else !== null && !memoConst(n.else, scope, templates, visiting, reads)) return false;
      }
    } else if (k === 4) {
      const was = scope.get(n.name);
      const wasLoop = scope.get('loop');
      const ok = nameConst(n.path[0], scope) === true;
      scope.set(n.name, ok);
      scope.set('loop', ok);
      const bodyOk = memoConst(n.body, scope, templates, visiting, reads);
      if (was === undefined) scope.delete(n.name); else scope.set(n.name, was);
      if (wasLoop === undefined) scope.delete('loop'); else scope.set('loop', wasLoop);
      if (!ok || !bodyOk) return false;
    } else if (k === 5) {
      const t = templates.get(n.name);
      if (t === undefined) continue;
      if (visiting.has(n.name)) return false;
      visiting.add(n.name);
      const ok = memoConst(t, scope, templates, visiting, reads);
      visiting.delete(n.name);
      if (!ok) return false;
    }
  }
  return true;
}

function collectLoopNames(nodes, templates, seen) {
  for (const n of nodes) {
    if (n.kind === 3) {
      collectLoopNames(n.then, templates, seen);
      if (n.else !== null) collectLoopNames(n.else, templates, seen);
    } else if (n.kind === 4) {
      loopNames.add(n.name);
      collectLoopNames(n.body, templates, seen);
    } else if (n.kind === 5 && !seen.has(n.name)) {
      const t = templates.get(n.name);
      if (t !== undefined) { seen.add(n.name); collectLoopNames(t, templates, seen); }
    }
  }
}

function walkSites(nodes, scope, templates) {
  for (const n of nodes) {
    const k = n.kind;
    if (k === 3) {
      walkSites(n.then, scope, templates);
      if (n.else !== null) walkSites(n.else, scope, templates);
    } else if (k === 4) {
      const was = scope.get(n.name);
      const wasLoop = scope.get('loop');
      const ok = nameConst(n.path[0], scope);
      scope.set(n.name, ok);
      scope.set('loop', ok);
      walkSites(n.body, scope, templates);
      const reads = { bits: 0 };
      const memoScope = new Map();
      memoScope.set(n.name, true);
      memoScope.set('loop', LOOP_OUT);
      if (memoConst(n.body, memoScope, templates, new Set(), reads)) n.memo = reads.bits;
      if (was === undefined) scope.delete(n.name); else scope.set(n.name, was);
      if (wasLoop === undefined) scope.delete('loop'); else scope.set('loop', wasLoop);
    } else if (k === 5) {
      const t = templates.get(n.name);
      if (t === undefined) continue;
      if (expansionConst(t, scope, templates, new Set([n.name]))) n.cd = expansionDepth(t, templates);
    }
  }
}

export function markConstSites(templates) {
  loopNames.clear();
  for (const nodes of templates.values()) collectLoopNames(nodes, templates, new Set());
  for (const nodes of templates.values()) walkSites(nodes, new Map(), templates);
}

// ---------------------------------------------------------------- the build pipeline

const REPORT_FILE = 'build-report.txt';
const RESERVED = Object.freeze(['posts', 'tags', 'page']);

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

function readSources(b) {
  const files = b.input.files.slice().sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    const p = f.path;
    if (p.endsWith('.md')) {
      const c = f.content;
      b.sources.push({ path: p, text: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else b.statics.push({ path: p, content: f.content });
  }
}

function frontMatterPlugin(b) {
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own = null;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== null) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;
}

function permalinks(b) {
  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    return set;
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }
}

function markdownPlugin(b) {
  const staticPaths = new Set(b.statics.map((f) => f.path));
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    const env = {
      link(target) {
        if (SCHEME.test(target) || target.charCodeAt(0) === 47 || target.charCodeAt(0) === 35) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null) {
          const page = b.bySource.get(path);
          if (page !== undefined) return `${page.url}${frag}`;
          if (staticPaths.has(path)) return `${b.base}/${path}${frag}`;
        }
        b.broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = md.words;
  }
}

function collections(b) {
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  const last = posts.length - 1;
  for (let k = 0; k <= last; k++) {
    const p = posts[k];
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === last ? null : posts[k + 1];
  }
}

function ownTagNames(s) {
  const tags = s.data.tags;
  if (tags === undefined || tags.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (let k = 0; k < tags.length; k++) {
    const name = tags[k];
    const slug = slugify(name);
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push(name);
    }
  }
  return out;
}

function tagsPlugin(b) {
  const bySlug = new Map();
  for (const p of b.posts) {
    const refs = [];
    const names = ownTagNames(p);
    for (let k = 0; k < names.length; k++) {
      const name = names[k];
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      refs.push(tag);
    }
    p.tagRefs = refs;
  }
  for (const s of b.sources) {
    if (s.post) continue;
    const names = ownTagNames(s);
    const refs = [];
    for (let k = 0; k < names.length; k++) {
      const name = names[k];
      const slug = slugify(name);
      const tag = bySlug.get(slug);
      refs.push(tag !== undefined ? tag : { name, slug, url: '', posts: [] });
    }
    s.tagRefs = refs;
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
}

function tagRefOf(t) {
  let r = t.ref;
  if (r === undefined) r = t.ref = { name: t.name, slug: t.slug, url: t.url };
  return r;
}

function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map(tagRefOf),
  };
}

function linkOf(s) {
  if (s === null) return null;
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  };
}

function pageOf(s) {
  const c = s.card;
  return {
    title: c.title,
    url: c.url,
    date: c.date,
    date_long: c.date_long,
    summary: c.summary,
    excerpt: c.excerpt,
    reading_minutes: c.reading_minutes,
    tags: c.tags,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

function layoutsPlugin(b) {
  for (const s of b.sources) s.card = cardOf(s);
  b.cards = new Map(b.posts.map((p) => [p, p.card]));
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => p.card);
  const ctx = { templates: b.templates, constCache: new Map() };
  markConstSites(b.templates);
  const root = { site, tags: allTags, recent, page: undefined, posts: undefined, pager: undefined, tag: undefined };
  const render = (name, vars) => {
    const nodes = b.templates.get(name);
    if (nodes === undefined) return null;
    root.page = vars.page;
    root.posts = vars.posts;
    root.pager = vars.pager;
    root.tag = vars.tag;
    return renderNodes(nodes, [], root, ctx, 0);
  };
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of b.tags) {
    if (!b.templates.has('tag')) break;
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) },
    });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }
}

function reportPlugin(b) {
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  let pages = 0;
  for (const s of b.sources) if (!s.post) pages++;
  lines.push(`built ${pages} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
}

function build(input) {
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (const name of names) {
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    cards: null,
    output: {},
  };
  readSources(b);
  frontMatterPlugin(b);
  permalinks(b);
  markdownPlugin(b);
  collections(b);
  tagsPlugin(b);
  layoutsPlugin(b);
  reportPlugin(b);
  return b.output;
}

export function run(input) {
  return build(input);
}

// Debug exports for local profiling; the harness only needs run().
export { build, parseFrontMatter, renderMarkdown, parseTemplate, wordsOf, inline };
export const __stages = { readSources, frontMatterPlugin, permalinks, markdownPlugin, collections, tagsPlugin, layoutsPlugin, reportPlugin };
