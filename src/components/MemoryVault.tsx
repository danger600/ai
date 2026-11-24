import { CheckCircle2, Download, Edit3, Plus, Search, Trash2, Upload } from 'lucide-react';
import { ChangeEvent, useEffect, useState } from 'react';
import type { MemoryItem } from '../types';

export function MemoryVault() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('engineering');
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadMemories = async () => {
    const res = await fetch('/api/memories');
    const data = await res.json();
    setMemories(data.memories || []);
    setMemoryEnabled(Boolean(data.memoryEnabled));
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const toggleGlobal = async () => {
    const next = !memoryEnabled;
    await fetch('/api/memories/toggle-global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    setMemoryEnabled(next);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    if (editingId) {
      await fetch(`/api/memories/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category }),
      });
      setEditingId(null);
    } else {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category, approved: 1 }),
      });
    }
    setTitle('');
    setContent('');
    await loadMemories();
  };

  const toggleItemField = async (m: MemoryItem, field: 'approved' | 'enabled') => {
    await fetch(`/api/memories/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: m[field] ? 0 : 1 }),
    });
    await loadMemories();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    await loadMemories();
  };

  const handleExport = () => {
    const approved = memories.filter((m) => m.approved === 1);
    const blob = new Blob([JSON.stringify(approved, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remy-memory-vault-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Array<{ title: string; content: string; category?: string }>;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item.title && item.content) {
            await fetch('/api/memories', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: item.title,
                content: item.content,
                category: item.category || 'imported',
                approved: 1,
                source: 'import',
              }),
            });
          }
        }
        await loadMemories();
      }
    } finally {
      e.target.value = '';
    }
  };

  const filtered = memories.filter(
    (m) =>
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.content.toLowerCase().includes(search.toLowerCase()) ||
      m.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Personal Memory Vault</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Controlled long-term knowledge separated from chat history, CV records, and uploaded documents.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleGlobal}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                memoryEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {memoryEnabled ? 'Memory Injection: Enabled' : 'Memory Injection: Disabled'}
            </button>

            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export JSON</span>
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#101724] dark:text-slate-200 whitespace-nowrap shrink-0">
              <Upload className="h-3.5 w-3.5" />
              <span>Import JSON</span>
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>
        </div>

        {/* Add / Edit Memory Form */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
          <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
            {editingId ? 'Edit Memory Entry' : 'Add Approved Memory'}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory title"
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:col-span-2"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="engineering">engineering</option>
              <option value="identity">identity</option>
              <option value="preferences">preferences</option>
              <option value="projects">projects</option>
              <option value="general">general</option>
            </select>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder="Factual preference or context to remember (avoid storing raw API keys or passwords)..."
            className="mt-3 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <div className="mt-3 flex justify-end gap-2">
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setTitle('');
                  setContent('');
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{editingId ? 'Update Memory' : 'Save Memory'}</span>
            </button>
          </div>
        </div>

        {/* Search & List */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-800 dark:bg-[#101724]">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search stored memories..."
              className="w-full bg-transparent text-xs text-slate-900 outline-none dark:text-slate-100"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-[#101724]">
              No matching memories stored.
            </div>
          ) : (
            filtered.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]"
              >
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <span>{m.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {m.category} · {m.approved ? 'Approved' : 'Pending Approval'} · {m.enabled ? 'Active' : 'Paused'}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">{m.content}</p>
                </div>

                <div className="flex items-center gap-1.5">
                  {!m.approved && (
                    <button
                      type="button"
                      onClick={() => toggleItemField(m, 'approved')}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-500 hover:bg-emerald-500/10"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Approve</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleItemField(m, 'enabled')}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {m.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(m.id);
                      setTitle(m.title);
                      setContent(m.content);
                      setCategory(m.category);
                    }}
                    aria-label="Edit memory"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    aria-label="Delete memory"
                    className="rounded p-1.5 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
