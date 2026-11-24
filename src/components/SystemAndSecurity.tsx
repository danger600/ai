import {
  Activity,
  Cpu,
  Database,
  Download,
  FolderCheck,
  HardDrive,
  Lock,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PermissionItem, SystemTelemetryResponse } from '../types';

export function SystemMonitor() {
  const [data, setData] = useState<SystemTelemetryResponse | null>(null);
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');
  const [ollamaProbe, setOllamaProbe] = useState<{
    available: boolean;
    models: string[];
    error?: string;
  } | null>(null);
  const [probing, setProbing] = useState(false);

  const fetchTelemetry = async () => {
    const res = await fetch('/api/system/telemetry');
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, 4000);
    return () => clearInterval(timer);
  }, []);

  const probeOllama = async () => {
    setProbing(true);
    try {
      const res = await fetch('/api/system/ollama-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: ollamaUrl }),
      });
      const json = await res.json();
      setOllamaProbe(json);
    } finally {
      setProbing(false);
    }
  };

  if (!data) {
    return <div className="p-6 text-sm text-slate-500">Reading system telemetry...</div>;
  }

  const { telemetry, dbHealth, providers } = data;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">System Telemetry & Provider Health</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Live server OS metrics, SQLite integrity diagnostics, and cloud/local AI availability checks.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchTelemetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Now</span>
          </button>
        </div>

        {/* Live Telemetry Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>CPU Load</span>
              <Cpu className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {telemetry.cpuUsagePercent}%
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-blue-600" style={{ width: `${telemetry.cpuUsagePercent}%` }} />
            </div>
            <div className="mt-2 truncate text-[11px] text-slate-500">{telemetry.cpuCores} cores · {telemetry.cpuModel}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>System RAM</span>
              <Activity className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
              {telemetry.ramUsagePercent}%
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-amber-500" style={{ width: `${telemetry.ramUsagePercent}%` }} />
            </div>
            <div className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums">
              {telemetry.ramUsedGb} GB / {telemetry.ramTotalGb} GB
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>SQLite Integrity</span>
              <Database className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-emerald-500 uppercase">
              {dbHealth.integrity}
            </div>
            <div className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums">
              DB Size: {(dbHealth.sizeBytes / 1024).toFixed(1)} KB · Process RSS: {telemetry.processRssMb} MB
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Host Runtime</span>
              <HardDrive className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 font-mono text-sm font-semibold text-slate-900 dark:text-white">
              {telemetry.nodeVersion}
            </div>
            <div className="mt-1 truncate text-xs text-slate-500">{telemetry.platform}</div>
            <div className="mt-2 font-mono text-[11px] text-slate-400 tabular-nums">
              {new Date(telemetry.serverTimeIso).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Provider Availability & Ollama Probe */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">AI Provider Availability</h2>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div>
                  <div className="font-medium text-slate-900 dark:text-white">Gemini Cloud Provider</div>
                  <div className="font-mono text-[11px] text-slate-500">Model: {providers.gemini.model}</div>
                </div>
                <span
                  className={`font-mono font-medium ${
                    providers.gemini.available ? 'text-emerald-500' : 'text-amber-500'
                  }`}
                >
                  {providers.gemini.available ? 'Connected' : 'Key Missing'}
                </span>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-900 dark:text-white">Local Ollama Probe</div>
                  <span
                    className={`font-mono font-medium ${
                      (ollamaProbe ?? providers.ollama).available ? 'text-emerald-500' : 'text-slate-500'
                    }`}
                  >
                    {(ollamaProbe ?? providers.ollama).available ? 'Detected' : 'Not Detected'}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    disabled={probing}
                    onClick={probeOllama}
                    className="rounded bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
                  >
                    {probing ? 'Probing...' : 'Check Endpoint'}
                  </button>
                </div>
                {(ollamaProbe ?? providers.ollama).error && (
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Status: {(ollamaProbe ?? providers.ollama).error} (Never assumed installed without verification)
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">SQLite Table Record Counts</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {Object.entries(dbHealth.tables).map(([table, count]) => (
                <div key={table} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500">{table}</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-slate-900 dark:text-white tabular-nums">
                    {count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SecurityOverviewData {
  permissions: PermissionItem[];
  folders: Array<{ id: string; folder_path: string; access_level: string }>;
  apps: Array<{ id: string; app_name: string; executable_path: string }>;
  auditLogs: Array<{ id: number; action: string; actor: string; target: string; decision: string; details: string; created_at: string }>;
  backups: Array<{ filename: string; sizeBytes: number }>;
}

export function SecurityCenter() {
  const [overview, setOverview] = useState<SecurityOverviewData | null>(null);
  const [newFolder, setNewFolder] = useState('');
  const [newAppName, setNewAppName] = useState('');
  const [newAppPath, setNewAppPath] = useState('');
  const [sampleSecret, setSampleSecret] = useState('Authorization: Bearer sk-test1234567890abcdef1234567890');
  const [maskedResult, setMaskedResult] = useState('');
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const loadOverview = async () => {
    const res = await fetch('/api/security/overview');
    const data = await res.json();
    setOverview(data);
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const togglePermission = async (p: PermissionItem) => {
    await fetch(`/api/security/permissions/${encodeURIComponent(p.scope)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ granted: !p.granted }),
    });
    await loadOverview();
  };

  const addFolder = async () => {
    if (!newFolder.trim()) return;
    await fetch('/api/security/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: newFolder, accessLevel: 'read' }),
    });
    setNewFolder('');
    await loadOverview();
  };

  const removeFolder = async (id: string) => {
    await fetch(`/api/security/folders/${id}`, { method: 'DELETE' });
    await loadOverview();
  };

  const addApp = async () => {
    if (!newAppName.trim() || !newAppPath.trim()) return;
    await fetch('/api/security/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: newAppName, executablePath: newAppPath }),
    });
    setNewAppName('');
    setNewAppPath('');
    await loadOverview();
  };

  const removeApp = async (id: string) => {
    await fetch(`/api/security/apps/${id}`, { method: 'DELETE' });
    await loadOverview();
  };

  const triggerBackup = async () => {
    const res = await fetch('/api/security/backup', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setBackupNotice(`SQLite backup created: ${data.filename} (${(data.sizeBytes / 1024).toFixed(1)} KB)`);
      await loadOverview();
    }
  };

  const runMaskTest = async () => {
    const res = await fetch('/api/security/mask-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sample: sampleSecret }),
    });
    const data = await res.json();
    setMaskedResult(data.masked);
  };

  if (!overview) {
    return <div className="p-6 text-sm text-slate-500">Loading security policy...</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Security Center & Permission Gatekeeper</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Centralized least-privilege policies, SQLite approved folders/apps, audit trail, and database backups.
            </p>
          </div>
          <button
            type="button"
            onClick={triggerBackup}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
          >
            <Database className="h-4 w-4" />
            <span>Create SQLite Backup</span>
          </button>
        </div>

        {backupNotice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600 dark:text-emerald-300">
            {backupNotice}
          </div>
        )}

        {/* Permissions Grid */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <Shield className="h-4 w-4 text-blue-500" />
            <span>Central Permission Scopes</span>
          </div>
          <div className="space-y-2.5">
            {overview.permissions.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs dark:border-slate-800"
              >
                <div>
                  <div className="font-mono font-semibold text-slate-900 dark:text-white">{p.scope}</div>
                  <div className="text-slate-500">{p.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => togglePermission(p)}
                  className={`rounded-lg border px-3 py-1.5 font-medium whitespace-nowrap shrink-0 ${
                    p.granted
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-500'
                  }`}
                >
                  {p.granted ? 'Granted' : 'Revoked'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Approved Folders & Apps */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <FolderCheck className="h-4 w-4 text-amber-500" />
              <span>Approved Folders (SQLite)</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="C:\\Users\\Remy\\Projects"
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button type="button" onClick={addFolder} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {overview.folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] dark:border-slate-800"
                >
                  <span className="truncate pr-2 text-slate-700 dark:text-slate-300">{f.folder_path}</span>
                  <button type="button" onClick={() => removeFolder(f.id)} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Lock className="h-4 w-4 text-blue-500" />
              <span>Approved Applications & Secret Masking</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="App name"
                className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-2"
              />
              <input
                type="text"
                value={newAppPath}
                onChange={(e) => setNewAppPath(e.target.value)}
                placeholder="Executable path"
                className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-2"
              />
              <button type="button" onClick={addApp} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">
                Add
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {overview.apps.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800"
                >
                  <div className="truncate pr-2">
                    <span className="font-medium text-slate-900 dark:text-white">{a.app_name}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-500">{a.executable_path}</span>
                  </div>
                  <button type="button" onClick={() => removeApp(a.id)} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Secret Masking Verification</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sampleSecret}
                  onChange={(e) => setSampleSecret(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <button type="button" onClick={runMaskTest} className="rounded bg-slate-900 px-3 py-1 text-[11px] text-white dark:bg-blue-600">
                  Mask
                </button>
              </div>
              {maskedResult && <div className="mt-1.5 font-mono text-[11px] text-emerald-500">{maskedResult}</div>}
            </div>
          </div>
        </div>

        {/* Audit Logs */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Security Audit Log</h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              Backups stored: {overview.backups.length}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Target</th>
                  <th className="py-2 pr-3 font-medium">Decision</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {overview.auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                      {log.created_at}
                    </td>
                    <td className="py-2 pr-3 font-mono text-slate-800 dark:text-slate-200">{log.action}</td>
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-500 max-w-[180px] truncate">{log.target}</td>
                    <td
                      className={`py-2 pr-3 font-mono font-medium ${
                        log.decision === 'allowed'
                          ? 'text-emerald-500'
                          : log.decision === 'denied'
                          ? 'text-red-500'
                          : 'text-blue-500'
                      }`}
                    >
                      {log.decision}
                    </td>
                    <td className="py-2 text-slate-600 dark:text-slate-400">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({
  theme,
  onToggleTheme,
  model,
  setModel,
  language,
  setLanguage,
  hidePrivateFeatures,
  onToggleHidePrivate,
  strictLocalMode,
  onToggleStrictLocal,
}: {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  model: string;
  setModel: (m: string) => void;
  language: string;
  setLanguage: (l: string) => void;
  hidePrivateFeatures: boolean;
  onToggleHidePrivate: () => void;
  strictLocalMode: boolean;
  onToggleStrictLocal: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="border-b border-slate-200 pb-4 dark:border-slate-800">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Application Settings & Privacy Controls</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Configure Obsidian Dark or Clean Daylight themes, privacy visibility, local-only lock, and Windows Python export.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Visual Theme</h2>
            <p className="mt-1 text-xs text-slate-500">Switch between Obsidian Dark and Clean Daylight mode.</p>
            <button
              type="button"
              onClick={onToggleTheme}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-blue-600" />}
              <span>{theme === 'dark' ? 'Switch to Clean Daylight' : 'Switch to Obsidian Dark'}</span>
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Default Model & Language</h2>
            <div className="mt-3 space-y-2.5">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (General)</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
                <option value="gemini-4-carbon">Gemini 4 Carbon (Deep Reasoning)</option>
                <option value="gemini-4-neon">Gemini 4 Neon (Interactive Pro)</option>
              </select>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="en">English</option>
                <option value="rw">Kinyarwanda</option>
                <option value="fr">Français</option>
                <option value="sw">Kiswahili</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Privacy Shield & Local-Only Mode</h2>
          <p className="mt-1 text-xs text-slate-500">
            Hide personal vaults when sharing your screen, or lock all outbound cloud AI & web search requests at the server gatekeeper.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onToggleHidePrivate}
              className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-xs font-medium ${
                hidePrivateFeatures
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <span>Hide Private Features (CV, Memory, Docs, History)</span>
              <span className="font-mono">{hidePrivateFeatures ? 'HIDDEN' : 'VISIBLE'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleStrictLocal}
              className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-xs font-medium ${
                strictLocalMode
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <span>Strict Local-Only Mode (Block Cloud AI)</span>
              <span className="font-mono">{strictLocalMode ? 'ACTIVE' : 'OFF'}</span>
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Windows 10/11 Python CustomTkinter Companion Bundle
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Download the modular Python 3.12 + CustomTkinter + SQLite + pytest starter project package for Windows desktop execution (`main.py`, `backend/core/security.py`, `backend/database/db.py`, `gui/app.py`, `tests/test_security.py`).
          </p>
          <a
            href="/api/export/windows-python-bundle"
            download="REMY-THE-GRIVER-PRO-Windows-Desktop.zip"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
          >
            <Download className="h-4 w-4" />
            <span>Download Windows Python Desktop Bundle (.zip)</span>
          </a>
        </div>

        {!hidePrivateFeatures && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600 dark:border-slate-800 dark:bg-[#101724] dark:text-slate-400">
            <div className="font-semibold text-slate-900 dark:text-white">REMY THE GRIVER PRO — About</div>
            <div className="mt-1">Tagline: Your Personal AI. Your Rules.</div>
            <div>Developer: Remy Nsanzimana | Personal Brand: BULL MAN — THE BULL MAN ON TOP</div>
            <div>Education: Level 5 Software Development, EAV KIVUMU TSS, Rwanda · Location: Kigali, Gasabo, Rwanda</div>
            <div className="mt-1">
              GitHub:{' '}
              <a href="https://github.com/danger600" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                https://github.com/danger600
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
