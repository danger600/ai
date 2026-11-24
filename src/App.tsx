import {
  Activity,
  Bookmark,
  Bot,
  Brain,
  Briefcase,
  CheckSquare,
  Code2,
  Eye,
  EyeOff,
  FileText,
  Film,
  Globe,
  History,
  Menu,
  MessageSquarePlus,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Puzzle,
  Settings,
  Shield,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BullManMark } from './components/BullManMark';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CvVault } from './components/CvVault';
import { DeveloperStudio } from './components/DeveloperStudio';
import { DocumentHub } from './components/DocumentHub';
import { MediaStudio } from './components/MediaStudio';
import { MemoryVault } from './components/MemoryVault';
import { ProductivityCenter } from './components/ProductivityCenter';
import { AgentsDirectory, PluginsRegistry, WebResearchPanel } from './components/ResearchAndAgents';
import { SecurityCenter, SettingsPanel, SystemMonitor } from './components/SystemAndSecurity';
import type {
  AgentInfo,
  ChatMessage,
  Conversation,
  DocumentItem,
  NavSection,
  SystemTelemetryResponse,
} from './types';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof MessageSquarePlus }> = [
  { id: 'chat', label: 'AI Workspace', icon: MessageSquarePlus },
  { id: 'history', label: 'Conversation History', icon: History },
  { id: 'agents', label: 'AI Agents', icon: Bot },
  { id: 'studio', label: 'Developer Studio', icon: Code2 },
  { id: 'media', label: 'Media Studio', icon: Film },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'cv', label: 'CV Vault', icon: Briefcase },
  { id: 'memory', label: 'Memory Vault', icon: Brain },
  { id: 'productivity', label: 'Productivity', icon: CheckSquare },
  { id: 'research', label: 'Web Research', icon: Globe },
  { id: 'system', label: 'System Monitor', icon: Activity },
  { id: 'security', label: 'Security Center', icon: Shield },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [section, setSection] = useState<NavSection>('chat');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(true);

  const [selectedAgentId, setSelectedAgentId] = useState<string>('auto');
  const [activeAgentDisplay, setActiveAgentDisplay] = useState<{ name: string; reason: string }>({
    name: 'Main Assistant Agent',
    reason: 'Ready for multi-agent orchestration',
  });
  const [model, setModel] = useState<string>('gemini-4-hydrogen');
  const [language, setLanguage] = useState<string>('en');
  const [telemetry, setTelemetry] = useState<SystemTelemetryResponse | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'saved'>('all');
  const [hidePrivateFeatures, setHidePrivateFeatures] = useState(false);
  const [strictLocalMode, setStrictLocalMode] = useState(false);

  const PRIVATE_SECTIONS: NavSection[] = ['history', 'documents', 'cv', 'memory', 'security'];

  const refreshBootstrap = async () => {
    const res = await fetch('/api/bootstrap');
    if (res.ok) {
      const data = await res.json();
      setAgents(data.agents || []);
      setConversations(data.conversations || []);
      setGeminiConfigured(Boolean(data.geminiConfigured));
      if (data.settings?.theme === 'light' || data.settings?.theme === 'dark') {
        setTheme(data.settings.theme);
      }
      if (data.settings?.default_model) setModel(data.settings.default_model);
      if (data.settings?.language) setLanguage(data.settings.language);
      setHidePrivateFeatures(data.settings?.hide_private_features === 'true');
      setStrictLocalMode(data.settings?.strict_local_mode === 'true');
    }
  };

  const refreshDocuments = async () => {
    const res = await fetch('/api/documents');
    if (res.ok) {
      setDocuments(await res.json());
    }
  };

  const refreshTelemetry = async () => {
    const res = await fetch('/api/system/telemetry');
    if (res.ok) {
      setTelemetry(await res.json());
    }
  };

  useEffect(() => {
    refreshBootstrap();
    refreshDocuments();
    refreshTelemetry();
    const timer = setInterval(refreshTelemetry, 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: next }),
    });
  };

  const toggleHidePrivate = async () => {
    const next = !hidePrivateFeatures;
    setHidePrivateFeatures(next);
    if (next && PRIVATE_SECTIONS.includes(section)) {
      setSection('chat');
    }
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hide_private_features: next ? 'true' : 'false' }),
    });
  };

  const toggleStrictLocal = async () => {
    const next = !strictLocalMode;
    setStrictLocalMode(next);
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strict_local_mode: next ? 'true' : 'false' }),
    });
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setSection('chat');
    setSidebarOpen(false);
  };

  const loadConversation = async (convId: string) => {
    setActiveConvId(convId);
    const res = await fetch(`/api/conversations/${convId}/messages`);
    if (res.ok) {
      const rows = (await res.json()) as Array<ChatMessage & { citations_json?: string | null }>;
      setMessages(
        rows.map((r) => ({
          ...r,
          citations: r.citations_json ? JSON.parse(r.citations_json) : undefined,
        }))
      );
    }
    setSection('chat');
    setSidebarOpen(false);
  };

  const toggleSaveConv = async (conv: Conversation) => {
    await fetch(`/api/conversations/${conv.id}/save`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: !conv.saved }),
    });
    await refreshBootstrap();
  };

  const deleteConv = async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    await refreshBootstrap();
  };

  const activeNavTitle = NAV_ITEMS.find((n) => n.id === section)?.label || 'AI Workspace';
  const filteredConversations = conversations.filter((c) => (historyFilter === 'saved' ? c.saved === 1 : true));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#090D16] dark:text-slate-100">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-[#0C121E] lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <BullManMark className="h-9 w-9 shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-bold tracking-tight text-slate-900 dark:text-amber-400">
                REMY THE GRIVER PRO
              </div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                Your Personal AI. Your Rules.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-slate-400 hover:text-slate-600 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span>New Chat</span>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-1">
          {NAV_ITEMS.filter((item) => !(hidePrivateFeatures && PRIVATE_SECTIONS.includes(item.id))).map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setSidebarOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-amber-500/15 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            <span className="flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-3.5 w-3.5 text-amber-400" /> : <Sun className="h-3.5 w-3.5 text-amber-500" />}
              <span>{theme === 'dark' ? 'Obsidian Dark' : 'Clean Daylight'}</span>
            </span>
            <span className="text-[11px] text-slate-400">Switch</span>
          </button>
        </div>
      </aside>

      {/* Center Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb | Actions */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-8 border-b border-slate-200 bg-white px-5 dark:border-slate-800 dark:bg-[#0C121E]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="font-display font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                REMY THE GRIVER PRO
              </span>
              <span className="text-slate-400">/</span>
              <span className="text-slate-600 dark:text-slate-300 truncate">{activeNavTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleHidePrivate}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                hidePrivateFeatures
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {hidePrivateFeatures ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{hidePrivateFeatures ? 'Private Hidden' : 'Hide Private'}</span>
            </button>
            <button
              type="button"
              onClick={() => setRightPanelOpen((v) => !v)}
              className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {rightPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              <span>Context Panel</span>
            </button>
          </div>
        </header>

        {/* Main Workspace + Right Context Panel */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-hidden">
            {section === 'chat' && (
              <ChatWorkspace
                conversationId={activeConvId}
                messages={messages}
                setMessages={setMessages}
                onConversationCreated={(convId) => {
                  setActiveConvId(convId);
                  refreshBootstrap();
                }}
                agents={agents}
                selectedAgentId={selectedAgentId}
                setSelectedAgentId={setSelectedAgentId}
                model={model}
                setModel={setModel}
                language={language}
                setLanguage={setLanguage}
                onActiveAgentChange={setActiveAgentDisplay}
                onNavigate={setSection}
                documents={documents}
                onDocumentUploaded={refreshDocuments}
                hidePrivateFeatures={hidePrivateFeatures}
              />
            )}

            {section === 'history' && (
              <div className="h-full overflow-y-auto p-6">
                <div className="mx-auto max-w-4xl space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                    <div>
                      <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Conversation History</h1>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Resume, bookmark, or delete SQLite-persisted assistant sessions.
                      </p>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#101724]">
                      <button
                        type="button"
                        onClick={() => setHistoryFilter('all')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          historyFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                            : 'text-slate-500'
                        }`}
                      >
                        All ({conversations.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryFilter('saved')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          historyFilter === 'saved'
                            ? 'bg-white text-slate-900 shadow-sm dark:bg-blue-600 dark:text-white'
                            : 'text-slate-500'
                        }`}
                      >
                        Saved ({conversations.filter((c) => c.saved === 1).length})
                      </button>
                    </div>
                  </div>

                  {filteredConversations.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-[#101724]">
                      No conversations recorded yet. Start a new chat to persist sessions here.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredConversations.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-[#101724]"
                        >
                          <button
                            type="button"
                            onClick={() => loadConversation(c.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-sm font-medium text-slate-900 hover:text-blue-500 dark:text-white">
                              {c.title}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                              {c.model} · {c.language.toUpperCase()} · {new Date(c.updated_at).toLocaleString()}
                            </div>
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleSaveConv(c)}
                              aria-label="Bookmark conversation"
                              className={`rounded p-1.5 ${
                                c.saved ? 'text-amber-500' : 'text-slate-400 hover:text-slate-700'
                              }`}
                            >
                              <Bookmark className={`h-4 w-4 ${c.saved ? 'fill-current' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteConv(c.id)}
                              aria-label="Delete conversation"
                              className="rounded p-1.5 text-slate-400 hover:text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {section === 'agents' && (
              <AgentsDirectory
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={(id) => {
                  setSelectedAgentId(id);
                  const found = agents.find((a) => a.id === id);
                  if (found) {
                    setActiveAgentDisplay({ name: found.name, reason: 'Manually selected from Agents Directory' });
                  }
                  setSection('chat');
                }}
              />
            )}

            {section === 'studio' && <DeveloperStudio model={model} />}
            {section === 'media' && <MediaStudio />}
            {section === 'documents' && (
              <DocumentHub documents={documents} onRefreshDocuments={refreshDocuments} model={model} />
            )}
            {section === 'cv' && <CvVault model={model} />}
            {section === 'memory' && <MemoryVault />}
            {section === 'productivity' && <ProductivityCenter />}
            {section === 'research' && <WebResearchPanel model={model} />}
            {section === 'system' && <SystemMonitor />}
            {section === 'security' && <SecurityCenter />}
            {section === 'plugins' && <PluginsRegistry />}
            {section === 'settings' && (
              <SettingsPanel
                theme={theme}
                onToggleTheme={toggleTheme}
                model={model}
                setModel={setModel}
                language={language}
                setLanguage={setLanguage}
                hidePrivateFeatures={hidePrivateFeatures}
                onToggleHidePrivate={toggleHidePrivate}
                strictLocalMode={strictLocalMode}
                onToggleStrictLocal={toggleStrictLocal}
              />
            )}
          </main>

          {/* Right Context Panel */}
          {rightPanelOpen && (
            <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0C121E] xl:flex">
              <div className="space-y-5">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Active AI Engine</div>
                  <div className="mt-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Provider</span>
                      <span className={`font-medium ${geminiConfigured ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {geminiConfigured ? 'Gemini Connected' : 'Key Required'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-slate-500">Model</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">{model}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-slate-500">Language</span>
                      <span className="font-mono uppercase text-slate-800 dark:text-slate-200">{language}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Orchestrated Agent</div>
                  <div className="mt-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="font-medium text-amber-600 dark:text-amber-400">{activeAgentDisplay.name}</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{activeAgentDisplay.reason}</p>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Live System Status</div>
                  <div className="mt-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                    <div className="flex justify-between">
                      <span className="text-slate-500">CPU Load</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {telemetry ? `${telemetry.telemetry.cpuUsagePercent}%` : '—'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex justify-between">
                      <span className="text-slate-500">RAM Usage</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                        {telemetry ? `${telemetry.telemetry.ramUsagePercent}%` : '—'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex justify-between">
                      <span className="text-slate-500">SQLite</span>
                      <span className="font-mono uppercase text-emerald-500">
                        {telemetry ? telemetry.dbHealth.integrity : '—'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex justify-between">
                      <span className="text-slate-500">Ollama Local</span>
                      <span className="font-mono text-slate-500">
                        {telemetry?.providers.ollama.available ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Workspace Context</div>
                  <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                    <div className="flex justify-between">
                      <span>Privacy Mode</span>
                      <span className="font-mono text-amber-500">{hidePrivateFeatures ? 'Hidden' : 'Standard'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cloud Gate</span>
                      <span className="font-mono text-emerald-500">{strictLocalMode ? 'Local-Only' : 'Hybrid'}</span>
                    </div>
                    {!hidePrivateFeatures && (
                      <>
                        <div className="flex justify-between">
                          <span>Indexed Docs</span>
                          <span className="font-mono tabular-nums">{documents.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Saved Chats</span>
                          <span className="font-mono tabular-nums">{conversations.filter((c) => c.saved === 1).length}</span>
                        </div>
                        <div className="pt-1 text-[11px] text-slate-500">
                          Developer: Remy Nsanzimana · BULL MAN
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
