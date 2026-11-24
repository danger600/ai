import { Bot, ExternalLink, Globe, Play, Puzzle, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AgentInfo, PluginItem } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

export function WebResearchPanel({ model }: { model: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    query: string;
    summary: string;
    sources: Array<{ title: string; uri: string }>;
  } | null>(null);

  const runSearch = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Web search failed');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Verified Web Research Engine</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Live Google Search grounding separating verified sourced facts from AI synthesis. URLs are validated before display.
          </p>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 dark:border-slate-700 dark:bg-[#101724]">
            <Globe className="h-4 w-4 text-blue-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="Search live web information (e.g., Python 3.13 release highlights or Rwanda tech ecosystem 2026)..."
              className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
            />
          </div>
          <button
            type="button"
            disabled={loading || !query.trim()}
            onClick={runSearch}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Search className="h-4 w-4" />
            <span>{loading ? 'Searching...' : 'Search Web'}</span>
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-500">
            {error}
          </div>
        )}

        {result && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724] lg:col-span-8">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Research Synthesis</h2>
              <MarkdownRenderer content={result.summary} />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724] lg:col-span-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                Verified Sources ({result.sources.length})
              </h2>
              {result.sources.length === 0 ? (
                <p className="text-xs text-slate-500">No external source URLs were returned by the search provider.</p>
              ) : (
                <ul className="space-y-2.5">
                  {result.sources.map((s, idx) => (
                    <li key={idx} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                      <a
                        href={s.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start justify-between gap-2 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <span className="line-clamp-2">{s.title}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      </a>
                      <div className="mt-1 truncate font-mono text-[10px] text-slate-400">{s.uri}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentsDirectory({
  agents,
  selectedAgentId,
  onSelectAgent,
}: {
  agents: AgentInfo[];
  selectedAgentId: string;
  onSelectAgent: (agentId: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Multi-Agent Intelligence</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            10 specialized agents coordinated by the central orchestrator. Agents cannot bypass the Security Gatekeeper.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {agents.map((a) => {
            const active = selectedAgentId === a.id;
            return (
              <div
                key={a.id}
                className={`flex flex-col justify-between rounded-xl border p-4 transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-500/5 dark:bg-blue-500/10'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101724]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <Bot className="h-4 w-4 text-amber-500" />
                      <span>{a.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">{a.role}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{a.description}</p>
                  {a.sensitiveScopes.length > 0 && (
                    <div className="mt-2 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                      Requires scope: {a.sensitiveScopes.join(', ')}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => onSelectAgent(a.id)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    Activate in Chat
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PluginsRegistry() {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [runResult, setRunResult] = useState<{ name: string; output: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPlugins = async () => {
    const res = await fetch('/api/plugins');
    const data = await res.json();
    setPlugins(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const togglePlugin = async (p: PluginItem) => {
    await fetch(`/api/plugins/${p.id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled, approved: true }),
    });
    await loadPlugins();
  };

  const runPlugin = async (p: PluginItem) => {
    setError(null);
    setRunResult(null);
    const res = await fetch(`/api/plugins/${p.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Plugin run blocked');
      return;
    }
    setRunResult({ name: p.name, output: data.output });
    await loadPlugins();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Controlled Plugin & Extension Registry</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Plugins execute in isolation and require explicit approval plus central permission scope validation.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-500">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {plugins.map((p) => {
            const perms = JSON.parse(p.permissions_json) as string[];
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]"
              >
                <div className="min-w-[240px] flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <Puzzle className="h-4 w-4 text-blue-500" />
                    <span>{p.name}</span>
                    <span className="font-mono text-xs font-normal text-slate-500">v{p.version}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.description}</p>
                  <div className="mt-1.5 font-mono text-[11px] text-slate-500">
                    Permissions: {perms.join(', ')} · Last status: {p.last_status}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => togglePlugin(p)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      p.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                    }`}
                  >
                    {p.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runPlugin(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Run</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {runResult && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="mb-2 text-xs font-semibold text-slate-900 dark:text-white">
              Isolated Output — {runResult.name}
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">
              {runResult.output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
