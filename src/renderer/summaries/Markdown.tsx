// The little Markdown Claude Code's summaries use: paragraphs, bullet and numbered lists, headings, **bold** and
// `code`. Built from React elements: nothing in the text becomes HTML.
import type { ReactNode } from 'react';

type ListBlock = { type: 'ul'; items: string[] } | { type: 'ol'; items: string[] };
export type MarkdownBlock = { type: 'p'; text: string } | { type: 'h'; text: string } | ListBlock;

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Splits the text into blocks. A line indented under a list item continues it. */
export function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  // In an object: TypeScript doesn't follow a variable that the helpers below set.
  const open: { list: ListBlock | null } = { list: null };
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const endList = () => {
    if (open.list) blocks.push(open.list);
    open.list = null;
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      endParagraph();
      const list: ListBlock = open.list !== null && open.list.type === type ? open.list : { type, items: [] };
      if (list !== open.list) {
        endList();
        open.list = list;
      }
      list.items.push((bullet ?? numbered)![1]!.trim());
    } else if (line.trim() === '') {
      endParagraph();
      endList();
    } else if (heading) {
      endParagraph();
      endList();
      blocks.push({ type: 'h', text: heading[1]!.trim() });
    } else if (open.list && /^\s+\S/.test(line)) {
      open.list.items[open.list.items.length - 1] += ` ${line.trim()}`;
    } else {
      endList();
      paragraph.push(line.trim());
    }
  }
  endParagraph();
  endList();
  return blocks;
}

/** **bold** and `code` within a line; anything else is plain text. */
export function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) parts.push(<strong key={parts.length}>{inline(match[1])}</strong>);
    else parts.push(<code key={parts.length}>{match[2]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {markdownBlocks(text).map((block, index) => {
        if (block.type === 'p') return <p key={index}>{inline(block.text)}</p>;
        if (block.type === 'h') return <p key={index} className="markdown-heading">{inline(block.text)}</p>;
        const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
        return block.type === 'ul' ? <ul key={index}>{items}</ul> : <ol key={index}>{items}</ol>;
      })}
    </div>
  );
}
