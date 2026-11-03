import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { h } from '../dom.ts';

marked.setOptions({ breaks: true, gfm: true });

export function md(text: string | undefined | null) {
  const el = h('div.md');
  el.innerHTML = DOMPurify.sanitize(marked.parse(text ?? '', { async: false }) as string);
  return el;
}
