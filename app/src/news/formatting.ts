// What the editor's formatting buttons type (#1230): each takes the post's
// text and the selection and answers the new text and the new selection, so
// the buttons are plain functions with nothing to render. The formatting is
// the one lib/markdown.tsx reads: ## headings, - lists, **bold**, [links](url)
// and ![pictures](url).

export type Edit = { text: string; start: number; end: number };

const splice = (text: string, from: number, to: number, insert: string) =>
  text.slice(0, from) + insert + text.slice(to);

// The lines a selection touches: a selection that ends right after a line
// break doesn't take the line below it.
function lineRange(text: string, start: number, end: number): [number, number] {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const last = end > start ? end - 1 : end;
  const found = text.indexOf('\n', last);
  return [from, found === -1 ? text.length : found];
}

// Puts `prefix` on every line a selection touches, or takes it off when each
// of them already has it. A cursor stays a cursor, at the end of the line;
// a selection stays selected.
function prefixLines(text: string, start: number, end: number, prefix: string): Edit {
  const [from, to] = lineRange(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const all = lines.every((l) => l.startsWith(prefix));
  const block = lines.map((l) => (all ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l)).join('\n');
  const out = splice(text, from, to, block);
  return start === end
    ? { text: out, start: from + block.length, end: from + block.length }
    : { text: out, start: from, end: from + block.length };
}

export const heading = (text: string, start: number, end: number): Edit => prefixLines(text, start, end, '## ');
export const list = (text: string, start: number, end: number): Edit => prefixLines(text, start, end, '- ');

export function bold(text: string, start: number, end: number): Edit {
  const picked = text.slice(start, end);
  if (picked === '') {
    return { text: splice(text, start, end, '**bold**'), start: start + 2, end: start + 6 };
  }
  if (picked.length > 4 && picked.startsWith('**') && picked.endsWith('**')) {
    return { text: splice(text, start, end, picked.slice(2, -2)), start, end: end - 4 };
  }
  return { text: splice(text, start, end, `**${picked}**`), start: start + 2, end: end + 2 };
}

// [the selection](https://) with the address left selected to paste over; a
// selected address becomes the link's target instead.
export function link(text: string, start: number, end: number): Edit {
  const picked = text.slice(start, end);
  if (/^https?:\/\/\S+$/.test(picked)) {
    return { text: splice(text, start, end, `[link text](${picked})`), start: start + 1, end: start + 10 };
  }
  const label = picked || 'link text';
  const at = start + label.length + 3;
  return { text: splice(text, start, end, `[${label}](https://)`), start: at, end: at + 8 };
}

// A picture on a paragraph of its own, the cursor after it.
export function picture(text: string, start: number, end: number, url: string, alt: string): Edit {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const snippet = `${lead}![${alt.replace(/[[\]]/g, '')}](${url})${trail}`;
  const caret = start + snippet.length - trail.length;
  return { text: splice(text, start, end, snippet), start: caret, end: caret };
}
