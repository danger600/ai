import { BookOpen, Code2, Download, GitBranch, Play, RefreshCw, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

const PYTHON_SAMPLE_SNIPPET = `# Isolated Python 3 Sandbox (python3 -I -B, 3000ms limit, no shell/network)
projects = [
    {"name": "KIVUMU SMART CAMPUS", "progress": 78},
    {"name": "UBUBIKO SMART", "progress": 64},
    {"name": "REMY THE GRIVER PRO", "progress": 94},
]

average = sum(p["progress"] for p in projects) / len(projects)
print(f"Active Python/Full-Stack Projects: {len(projects)}")
for p in projects:
    print(f" - {p['name']}: {p['progress']}%")
print(f"Average completion: {average:.1f}%")`;

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
  const [code, setCode] = useState(PYTHON_SAMPLE_SNIPPET);
  const [stack, setStack] = useState('Python 3.11+ (Pure Python)');
  const [aiOutput, setAiOutput] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);

  const [runOutput, setRunOutput] = useState<{
    allowed: boolean;
    output: string;
    result?: string;
    error?: string;
    durationMs: number;
    pythonVersion?: string;
  } | null>(null);
  const [runningSandbox, setRunningSandbox] = useState(false);
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

  const handleRunPython = async () => {
    if (!approvalConfirmed) return;
    setRunningSandbox(true);
    try {
      const res = await fetch('/api/studio/run-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      setRunOutput(data);
    } finally {
      setRunningSandbox(false);
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
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">AI Python Developer Studio</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Pure Python 3.11+ engineering, isolated python3 -I sandbox runner, SQLite/CustomTkinter assistance, and Windows Desktop ZIP export.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200"
            >
              <option>Python 3.11+ (Pure Python)</option>
              <option>Python CustomTkinter + SQLite</option>
              <option>Python FastAPI / REST Backend</option>
              <option>SQLite / MySQL Database Schema</option>
            </select>
            <a
              href="/api/export/windows-python-bundle"
              download="REMY-THE-GRIVER-PRO-Windows-Desktop.zip"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Python App (.zip)</span>
            </a>
          </div>
        </div>

        {/* Main Studio Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Code Editor + Python Sandbox */}
          <div className="space-y-4 lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#101724]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <Code2 className="h-4 w-4 text-blue-500" />
                  <span>Python Workspace Buffer (.py)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'Explain & Debug', task: 'Explain this Python code, identify edge cases or bugs, and suggest clean Python fixes.' },
                    { label: 'Refactor Python', task: 'Refactor this code into clean, type-annotated Python 3.11+ functions.' },
                    { label: 'Pytest / Unittest', task: 'Write comprehensive automated Python unittest / pytest test cases for this code.' },
                    { label: 'Security Review', task: 'Audit this Python code for security vulnerabilities, path traversal, subprocess risks, and input validation issues.' },
                    { label: 'Docstrings & README', task: 'Generate clean Google-style Python docstrings and README usage docs.' },
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

              {/* Explicit Approval & Python Sandbox Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-[#0D131F]">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={approvalConfirmed}
                    onChange={(e) => setApprovalConfirmed(e.target.checked)}
                    className="rounded border-slate-400 text-blue-600"
                  />
                  <span>Approve isolated Python 3 execution (python3 -I, 3000ms limit, AST-gated)</span>
                </label>

                <button
                  type="button"
                  disabled={!approvalConfirmed || runningSandbox}
                  onClick={handleRunPython}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{runningSandbox ? 'Running Python...' : 'Run Python Code'}</span>
                </button>
              </div>
            </div>

            {runOutput && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                    <Terminal className="h-4 w-4 text-amber-500" />
                    <span>Isolated Python Console ({runOutput.pythonVersion || 'python3'})</span>
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums">{runOutput.durationMs} ms</span>
                </div>
                {runOutput.error && (
                  <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-400">
                    {runOutput.error}
                  </div>
                )}
                {(!runOutput.error || runOutput.output) && (
                  <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-emerald-300">
                    {runOutput.output || '(no stdout output)'}
                    {runOutput.result !== undefined ? `\n=> Return value: ${runOutput.result}` : ''}
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
                <span>Python Engineering Analysis</span>
              </div>
              {loadingAi && <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {aiOutput ? (
                <MarkdownRenderer content={aiOutput} />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
                  <ShieldAlert className="mb-2 h-6 w-6 text-slate-400" />
                  <p>Select a Python engineering action above or run your Python snippet in the isolated sandbox.</p>
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
                Enter an owner/repo (e.g., danger600/remy-the-griver-pro) to inspect public structure and README.
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
