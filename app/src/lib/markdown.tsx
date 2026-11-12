import { Fragment, type ReactNode } from 'react';

// The light Markdown a team writes its About text in (#1548, #1546): bold,
// italic, a heading, a bullet list and a link. Built as React elements, never
// as HTML, so nothing a team types can run. Links open only when they start
// with https://.

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https:\/\/[^\s)]+\))/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={k}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={k} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
}

// Blocks are separated by a blank line: a line starting "# " is a heading, a
// run of lines starting "- " is a list, anything else a paragraph.
export function Markdown({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .filter((b) => b.trim());
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        if (lines.length > 0 && lines.every((l) => /^[-*] /.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2), `${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        const heading = /^#{1,3} (.+)$/.exec(lines[0] ?? '');
        if (heading && lines.length === 1) return <h3 key={i}>{inline(heading[1] ?? '', String(i))}</h3>;
        return (
          <p key={i}>
            {lines.map((l, j) => (j ? [<br key={`b${j}`} />, ...inline(l, `${i}-${j}`)] : inline(l, `${i}-${j}`)))}
          </p>
        );
      })}
    </>
  );
}

// The plain first line of some Markdown, for a team's card blurb.
export function firstPlainLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line
    .replace(/^#{1,3} /, '')
    .replace(/^[-*] /, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}
