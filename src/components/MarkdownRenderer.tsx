import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-xs text-slate-400">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy code'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderInlineFormatting(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[12px] text-blue-700 dark:bg-slate-800 dark:text-blue-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline decoration-blue-500/40 underline-offset-2 hover:text-blue-500 dark:text-blue-400"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function MarkdownRenderer({ content }: { content: string }) {
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2 text-[14.5px] leading-relaxed text-slate-700 dark:text-slate-200">
      {segments.map((segment, sIdx) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const firstNewline = segment.indexOf('\n');
          const language = firstNewline !== -1 ? segment.slice(3, firstNewline).trim() : '';
          const code = firstNewline !== -1 ? segment.slice(firstNewline + 1, -3) : segment.slice(3, -3);
          return <CodeBlock key={sIdx} language={language} code={code.trimEnd()} />;
        }

        const lines = segment.split('\n');
        return (
          <div key={sIdx} className="space-y-1.5">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lIdx} className="h-1.5" />;
              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lIdx} className="pt-2 text-sm font-semibold text-slate-900 dark:text-white">
                    {renderInlineFormatting(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h3 key={lIdx} className="pt-2 text-base font-semibold text-slate-900 dark:text-white">
                    {renderInlineFormatting(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h2 key={lIdx} className="pt-2 text-lg font-semibold text-slate-900 dark:text-white">
                    {renderInlineFormatting(trimmed.slice(2))}
                  </h2>
                );
              }
              if (/^[-*]\s+/.test(trimmed)) {
                return (
                  <div key={lIdx} className="flex gap-2.5 pl-1">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    <div className="flex-1">{renderInlineFormatting(trimmed.replace(/^[-*]\s+/, ''))}</div>
                  </div>
                );
              }
              if (/^\d+\.\s+/.test(trimmed)) {
                const match = trimmed.match(/^(\d+\.)\s+(.*)$/);
                if (match) {
                  return (
                    <div key={lIdx} className="flex gap-2 pl-1">
                      <span className="font-mono text-xs font-medium text-amber-600 dark:text-amber-400 pt-0.5 tabular-nums">
                        {match[1]}
                      </span>
                      <div className="flex-1">{renderInlineFormatting(match[2])}</div>
                    </div>
                  );
                }
              }
              return <p key={lIdx}>{renderInlineFormatting(line)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}
