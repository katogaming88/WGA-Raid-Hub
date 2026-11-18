import { Fragment, type ReactNode } from 'react';

// The light Markdown a team writes its About text in (#1548, #1546): bold,
// italic, a heading, a bullet list and a link. Built as React elements, never
// as HTML, so nothing a team types can run. Links open only when they start
// with https://.
//
// A news post (#1230) also takes pictures, `![what it shows](https://...)`,
// with an optional caption in quotes after the address, `(https://... "Caption")`,
// switched on with `pictures`: only from https:// (or this machine, for a
// local stack), so a post can't pull in anything else.

const LINK = String.raw`\[[^\]]+\]\(https:\/\/[^\s)]+\)`;
const PICTURE_URL = String.raw`(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost)[:/])[^\s)]+`;
const INLINE = new RegExp(String.raw`(\*\*[^*]+\*\*|\*[^*]+\*|${LINK})`, 'g');
const INLINE_WITH_PICTURES = new RegExp(
  String.raw`(\*\*[^*]+\*\*|\*[^*]+\*|!\[[^\]]*\]\(${PICTURE_URL}(?: "[^"]*")?\)|${LINK})`,
  'g'
);
const PICTURE = new RegExp(String.raw`^!\[([^\]]*)\]\((${PICTURE_URL})(?: "([^"]*)")?\)$`);

function inline(text: string, key: string, pictures: boolean): ReactNode[] {
  return text.split(pictures ? INLINE_WITH_PICTURES : INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    const picture = pictures ? PICTURE.exec(part) : null;
    if (picture) return <img key={k} className="markdown-picture" src={picture[2]} alt={picture[1]} loading="lazy" />;
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
// run of lines starting "- " is a list, anything else a paragraph. A heading
// line is a block of its own, so the line after it needs no blank line.
// `headingLevel` is the tag a heading gets, for a page whose own title is the
// h1.
export function Markdown({
  text,
  pictures = false,
  headingLevel = 3
}: {
  text: string;
  pictures?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const blocks = text
    .replace(/\r\n/g, '\n')
    .replace(/^(#{1,3} .+)$/gm, '\n$1\n')
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
                <li key={j}>{inline(l.slice(2), `${i}-${j}`, pictures)}</li>
              ))}
            </ul>
          );
        }
        // A picture on a line of its own is a figure, with its caption if it has one.
        const figure = pictures && lines.length === 1 ? PICTURE.exec((lines[0] ?? '').trim()) : null;
        if (figure) {
          return (
            <figure key={i} className="markdown-figure">
              <img className="markdown-picture" src={figure[2]} alt={figure[1]} loading="lazy" />
              {figure[3] && <figcaption>{figure[3]}</figcaption>}
            </figure>
          );
        }
        const heading = /^#{1,3} (.+)$/.exec(lines[0] ?? '');
        if (heading && lines.length === 1)
          return <Heading key={i}>{inline(heading[1] ?? '', String(i), pictures)}</Heading>;
        return (
          <p key={i}>
            {lines.map((l, j) =>
              j ? [<br key={`b${j}`} />, ...inline(l, `${i}-${j}`, pictures)] : inline(l, `${i}-${j}`, pictures)
            )}
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
