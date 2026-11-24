import { FileText, Search, Trash2, Upload } from 'lucide-react';
import { ChangeEvent, useEffect, useState } from 'react';
import type { DocumentChunk, DocumentItem } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface RagCitation {
  filename: string;
  pageOrRow: string;
  score: number;
  excerpt: string;
}

export function DocumentHub({
  documents,
  onRefreshDocuments,
  model,
}: {
  documents: DocumentItem[];
  onRefreshDocuments: () => void;
  model: string;
}) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    Array<{ chunkId: string; filename: string; pageOrRow: string; content: string; score: number }>
  >([]);

  const [question, setQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaCitations, setQaCitations] = useState<RagCitation[]>([]);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!selectedDocId && documents.length > 0) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

  useEffect(() => {
    if (!selectedDocId) {
      setChunks([]);
      return;
    }
    fetch(`/api/documents/${selectedDocId}/chunks`)
      .then((r) => r.json())
      .then((data) => setChunks(Array.isArray(data) ? data : []))
      .catch(() => setChunks([]));
  }, [selectedDocId]);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onRefreshDocuments();
      setSelectedDocId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document ingestion failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (selectedDocId === id) setSelectedDocId(null);
    onRefreshDocuments();
  };

  const handleLocalSearch = async () => {
    if (!searchQuery.trim()) return;
    const res = await fetch('/api/documents/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, documentId: selectedDocId || undefined }),
    });
    const data = await res.json();
    setSearchResults(data.results || []);
  };

  const handleAskDocument = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, documentId: selectedDocId || undefined, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Document Q&A failed');
      setQaAnswer(data.answer || '');
      setQaCitations(data.citations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Q&A request failed');
    } finally {
      setAsking(false);
    }
  };

  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Document Intelligence & Local RAG</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Private local parsing, chunking, and semantic search for PDF, DOCX, TXT, Markdown, CSV, XLSX, and source code.
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap shrink-0">
            <Upload className="h-4 w-4" />
            <span>{uploading ? 'Indexing...' : 'Upload Document'}</span>
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.py,.js,.ts,.tsx,.json,.sql,.html"
              onChange={handleUpload}
              className="hidden"
            />
          </label>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-500">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Indexed Documents + Local Search */}
          <div className="space-y-4 lg:col-span-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
              <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">
                Indexed Vault ({documents.length})
              </h2>
              {documents.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No documents indexed yet. Upload a PDF, DOCX, spreadsheet, or code file to inspect chunks locally.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 transition-colors ${
                        selectedDocId === doc.id
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-white truncate">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          <span className="truncate">{doc.filename}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          {Math.max(1, Math.round(doc.size_bytes / 1024))} KB · {doc.page_count} pages · Local
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(doc.id);
                        }}
                        aria-label={`Delete ${doc.filename}`}
                        className="rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Local Offline Semantic Search */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#101724]">
              <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Local Offline Search</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search indexed text locally..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleLocalSearch}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-blue-600"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              </div>

              {searchResults.length > 0 && (
                <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                  {searchResults.map((r) => (
                    <div key={r.chunkId} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                      <div className="font-mono text-[11px] text-blue-500">
                        {r.filename} · {r.pageOrRow} · Score {r.score}
                      </div>
                      <p className="mt-1 line-clamp-3 text-slate-600 dark:text-slate-300">{r.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center & Right: Chunk Inspector & Citation Q&A */}
          <div className="space-y-4 lg:col-span-8">
            {/* Q&A with Citations */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Document Question Answering & Synthesis</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Retrieves top local chunks first and grounds AI responses with page and row citations.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask for an executive summary, key takeaways, or specific figures..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={asking || !question.trim()}
                  onClick={handleAskDocument}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {asking ? 'Analyzing...' : 'Ask Document'}
                </button>
              </div>

              {qaAnswer && (
                <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <MarkdownRenderer content={qaAnswer} />
                  {qaCitations.length > 0 && (
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                      <div className="mb-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Retrieved Citations</div>
                      <div className="space-y-1.5">
                        {qaCitations.map((c, idx) => (
                          <div key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                            <span className="font-mono text-blue-500">
                              [{c.filename} · {c.pageOrRow}]
                            </span>{' '}
                            {c.excerpt}...
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Extracted Chunks Viewer */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#101724]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {selectedDoc ? `Extracted Chunks — ${selectedDoc.filename}` : 'Extracted Chunks'}
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums">{chunks.length} chunks</span>
              </div>

              {chunks.length === 0 ? (
                <p className="text-xs text-slate-500">Select or upload a document to inspect extracted text chunks.</p>
              ) : (
                <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                  {chunks.map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-slate-500">
                        <span>
                          Chunk #{c.chunk_index} · {c.page_or_row}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                        {c.content}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
