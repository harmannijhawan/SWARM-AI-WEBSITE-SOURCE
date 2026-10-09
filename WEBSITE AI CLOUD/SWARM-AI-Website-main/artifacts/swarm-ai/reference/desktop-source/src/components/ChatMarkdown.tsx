import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { api } from '../lib/api';

function plain(n: ReactNode): string { return Children.toArray(n).map(x => isValidElement<{ children?: ReactNode }>(x) ? plain(x.props.children) : String(x)).join(''); }
function CodeBlock({ children }: { children?: ReactNode }) {
  const text = plain(children);
  const child = Children.toArray(children)[0];
  const lang = isValidElement<{ className?: string }>(child) ? child.props.className?.match(/language-([\w-]+)/)?.[1] ?? 'txt' : 'txt';
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url;
    a.download = `swarm-code.${({ python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh' } as Record<string,string>)[lang] ?? lang}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="chat-code"><div className="chat-code-toolbar"><span>{lang}</span><button onClick={e => { const button = e.currentTarget; void navigator.clipboard.writeText(text).then(() => { button.textContent = 'Copied'; }).catch(() => undefined); }}>Copy code</button><button onClick={download}>Download</button></div><pre>{children}</pre></div>;
}
export function ChatMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ pre: CodeBlock, a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) void api.openExternal(href); }}>{children}</a> }}>{text}</ReactMarkdown></div>;
}
