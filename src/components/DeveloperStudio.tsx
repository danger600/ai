import { BookOpen, Code2, GitBranch, Play, RefreshCw, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

const SAMPLE_SNIPPET = `// Isolated VM Sandbox Test (Node VM, 1000ms timeout)
const projects = [
  { name: "KIVUMU SMART CAMPUS", progress: 78 },
  { name: "UBUBIKO SMART", progress: 64 },
  { name: "REMY THE GRIVER PRO", progress: 90 }
];

const average = projects.reduce((acc, p) => acc + p.progress, 0) / projects.length;
console.log("Active projects:", projects.length);
console.log("Average completion:", average.toFixed(1) + "%");
average;`;

interface GithubAnalysisResult {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  defaultBranch: string;
  htmlUrl: string;
  files: Array<{ path: string; type: string; size?: number }>;
  readmeSnippet: string;
}

export function DeveloperStudio({ model }: { model: string }) {
  const [code, setCode] = useState(SAMPLE_SNIPPET);
  const [stack, setStack] = useState('JavaScript / TypeScript');
  const [aiOutput, setAiOutput] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);

  const [vmOutput, setVmOutput] = useState<{
    allowed: boolean;
    output: string;
    result?: string;
    error?: string;
    durationMs: number;
  } | null>(null);
  const [runningVm, setRunningVm] = useState(false);
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);

  const [repoInput, setRepoInput] = useState('https://github.com/danger600');
  const [githubData, setGithubData] = useState<GithubAnalysisResult | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [loadingGithub, setLoadingGithub] = useState(false);

  const runAiTask = async (task: string) => {
    if (!code.trim() || loadingAi) return;
    setLoadingAi(true);
    setAiOutput('');
    try {
      const res = await fetch('/api/studio/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, code, language: stack, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Developer AI request failed');
      setAiOutput(data.result);
    } catch (err) {
      setAiOutput(`Error: ${err instanceof Error ? err.message : 'Request failed'}`);
    } finally {
      setLoadingAi(false);
    }
  };

  const handleRunVm = async () => {
    if (!approvalConfirmed) return;
    setRunningVm(true);
    try {
      const res = await fetch('/api/studio/run-vm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      setVmOutput(data);
    } finally {
      setRunningVm(false);
    }
  };

  const handleAnalyzeGithub = async () => {
    if (!repoInput.trim() || loadingGithub) return;
    setLoadingGithub(true);
    setGithubError(null);
    setGithubData(null);
    try {
      const res = await fetch('/api/studio/analyze-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'GitHub inspection failed');
      setGithubData(data);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : 'GitHub lookup failed');
    } finally {
      setLoadingGithub(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">AI Developer Studio</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Code engineering, SQL & architecture analysis, isolated JavaScript VM sandbox, and GitHub repository inspection.
            </p>
          </div>
          <select
            value={stack}
            onChange={(e) => setStack(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200"
          >
            <option>JavaScript / TypeScript</option>
            <option>Python 3.12</option>
            <option>React & Node.js / Express</option>
            <option>MySQL / SQLite / Database Schema</option>
          </select>
        </div>

        {/* Main Studio Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Code Editor + Sandbox */}
          <div className="space-y-4 lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101724]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <Code2 className="h-4 w-4 text-blue-500" />
                  <span>Workspace Buffer</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Explain & Debug', task: 'Explain this code, identify edge cases or bugs, and suggest fixes.' },
                    { label: 'Refactor', task: 'Refactor this code for clarity, type safety, and maintainability.' },
                    { label: 'Unit Tests', task: 'Write comprehensive automated unit tests (pytest or vitest) for this code.' },
                    { label: 'Security Review', task: 'Audit this code for security vulnerabilities and input validation issues.' },
                    { label: 'README / Docs', task: 'Generate clean API documentation and a concise README section for this module.' },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      disabled={loadingAi}
                      onClick={() => runAiTask(btn.task)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-500/50 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-blue-400 whitespace-nowrap shrink-0"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full resize-y bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-100 outline-none"
              />

              {/* Explicit Approval & VM Sandbox Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-[#0D131F]">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={approvalConfirmed}
                    onChange={(e) => setApprovalConfirmed(e.target.checked)}
                    className="rounded border-slate-400 text-blue-600"
                  />
                  <span>Approve isolated JavaScript VM execution (1000ms limit, no filesystem/shell)</span>
                </label>

                <button
                  type="button"
                  disabled={!approvalConfirmed || runningVm}
                  onClick={handleRunVm}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{runningVm ? 'Running...' : 'Run in Isolated VM'}</span>
                </button>
              </div>
            </div>

            {vmOutput && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                    <Terminal className="h-4 w-4 text-amber-500" />
                    <span>Isolated VM Console</span>
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums">{vmOutput.durationMs} ms</span>
                </div>
                {vmOutput.error ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-400">
                    {vmOutput.error}
                  </div>
                ) : (
                  <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">
                    {vmOutput.output || '(no console output)'}
                    {vmOutput.result !== undefined ? `\n=> Return value: ${vmOutput.result}` : ''}
                  </pre>
                )}
              </div>
            )}
          </div>

          {/* AI Engineering Output */}
          <div className="flex flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101724] lg:col-span-5">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span>Engineering Analysis</span>
              </div>
              {loadingAi && <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {aiOutput ? (
                <MarkdownRenderer content={aiOutput} />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
                  <ShieldAlert className="mb-2 h-6 w-6 text-slate-400" />
                  <p>Select an engineering action above to analyze, refactor, audit, or generate tests.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* GitHub Repository Analyzer */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">GitHub Repository Inspector</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter an owner/repo (e.g., danger600/remy-the-griver-pro or facebook/react) to inspect public structure and README.
              </p>
            </div>
            <div className="flex flex-1 max-w-md items-center gap-2">
              <input
                type="text"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="owner/repo or https://github.com/owner/repo"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                disabled={loadingGithub}
                onClick={handleAnalyzeGithub}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 whitespace-nowrap shrink-0"
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>{loadingGithub ? 'Fetching...' : 'Inspect Repo'}</span>
              </button>
            </div>
          </div>

          {githubError && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
              {githubError}
            </div>
          )}

          {githubData && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 dark:border-slate-800 md:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <a
                    href={githubData.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {githubData.fullName}
                  </a>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {githubData.stars} stars · {githubData.forks} forks · {githubData.language || 'Mixed'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {githubData.description || 'No description provided.'}
                </p>
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Root Files & Directories</div>
                  <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {githubData.files.map((f) => (
                      <div key={f.path} className="truncate">
                        {f.type === 'dir' ? '[dir] ' : ''}
                        {f.path}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <BookOpen className="h-3.5 w-3.5 text-amber-500" />
                  <span>README Preview</span>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-300">
                  {githubData.readmeSnippet || 'No README found.'}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
