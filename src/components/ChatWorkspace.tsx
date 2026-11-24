import { jsPDF } from 'jspdf';
import {
  Check,
  Code2,
  Copy,
  FileText,
  Film,
  Globe,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  Shield,
  Square,
  UserCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { AgentInfo, ChatMessage, DocumentItem, NavSection } from '../types';
import { BullManMark } from './BullManMark';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ChatWorkspaceProps {
  conversationId: string | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onConversationCreated: (convId: string) => void;
  agents: AgentInfo[];
  selectedAgentId: string;
  setSelectedAgentId: (id: string) => void;
  model: string;
  setModel: (m: string) => void;
  language: string;
  setLanguage: (l: string) => void;
  onActiveAgentChange: (info: { name: string; reason: string }) => void;
  onNavigate: (sec: NavSection) => void;
  documents: DocumentItem[];
  onDocumentUploaded: () => void;
  hidePrivateFeatures: boolean;
}

interface SpeechRecLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function ChatWorkspace({
  conversationId,
  messages,
  setMessages,
  onConversationCreated,
  agents,
  selectedAgentId,
  setSelectedAgentId,
  model,
  setModel,
  language,
  setLanguage,
  onActiveAgentChange,
  onNavigate,
  documents,
  onDocumentUploaded,
  hidePrivateFeatures,
}: ChatWorkspaceProps) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [includeMemory, setIncludeMemory] = useState(true);
  const [includeCv, setIncludeCv] = useState(false);
  const [attachedDocIds, setAttachedDocIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Voice STT + audio meter state
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>([15, 25, 18, 30, 20, 26, 14]);

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecLike | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Global Esc key interruption for TTS, STT, and streaming
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (streaming) stopGeneration();
        if (listening) stopVoiceCapture();
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          setSpeakingId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    return () => {
      stopVoiceCapture();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopGeneration = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  };

  const stopVoiceCapture = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    setListening(false);
    setAudioLevels([15, 25, 18, 30, 20, 26, 14]);
  };

  const startVoiceCapture = async () => {
    if (listening) {
      stopVoiceCapture();
      return;
    }
    setVoiceNote(null);

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecLike;
      webkitSpeechRecognition?: new () => SpeechRecLike;
    };
    const Rec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!Rec) {
      setVoiceNote('Speech recognition is unavailable in this browser engine. Type your prompt or switch to Chromium/Edge.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 7 }, (_, i) => Math.max(12, Math.min(100, Math.round((data[i] / 255) * 100))));
        setAudioLevels(bars);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setVoiceNote('Microphone access denied or unavailable. Check browser permissions.');
      return;
    }

    const langTagMap: Record<string, string> = {
      en: 'en-US',
      fr: 'fr-FR',
      sw: 'sw-KE',
      rw: 'rw-RW',
    };

    const rec = new Rec();
    rec.lang = langTagMap[language] || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    if (language === 'rw') {
      setVoiceNote('Kinyarwanda STT uses browser speech engine support; switch to English/French if your OS lacks rw-RW.');
    }

    rec.onresult = (ev) => {
      let transcript = '';
      for (let i = 0; i < ev.results.length; i++) {
        transcript += ev.results[i][0].transcript + ' ';
      }
      setInput(transcript.trim());
    };
    rec.onerror = (ev) => {
      setVoiceNote(`Voice capture note: ${ev.error}`);
      stopVoiceCapture();
    };
    rec.onend = () => {
      stopVoiceCapture();
    };

    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  };

  const toggleSpeak = (msg: ChatMessage) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speakingId === msg.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(msg.content.replace(/```[\s\S]*?```/g, 'Code block omitted.'));
    const langTagMap: Record<string, string> = { en: 'en-US', fr: 'fr-FR', sw: 'sw-KE', rw: 'en-US' };
    utter.lang = langTagMap[language] || 'en-US';
    utter.onend = () => setSpeakingId(null);
    utter.onerror = () => setSpeakingId(null);
    setSpeakingId(msg.id);
    window.speechSynthesis.speak(utter);
  };

  const sendMessage = async (overridePrompt?: string, replaceLastPair = false) => {
    const text = (overridePrompt ?? input).trim();
    if (!text || streaming) return;

    setErrorMsg(null);
    if (!overridePrompt) setInput('');

    const tempUserId = `tmp-u-${Date.now()}`;
    const tempAiId = `tmp-a-${Date.now()}`;

    setMessages((prev) => {
      const base = replaceLastPair ? prev.slice(0, Math.max(0, prev.length - 2)) : prev;
      return [
        ...base,
        {
          id: tempUserId,
          conversation_id: conversationId || 'pending',
          role: 'user',
          content: text,
          created_at: new Date().toISOString(),
        },
        {
          id: tempAiId,
          conversation_id: conversationId || 'pending',
          role: 'assistant',
          content: '',
          created_at: new Date().toISOString(),
        },
      ];
    });

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    let firstChunkReceived = false;
    let showingDraft = false;
    const watchdogTimer = setTimeout(() => {
      if (!firstChunkReceived) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAiId && !m.content.trim()
              ? { ...m, content: '> **Preparing full step-by-step response (<2s)...**' }
              : m
          )
        );
      }
    }, 1850);

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          conversationId,
          prompt: text,
          agentId: selectedAgentId,
          model,
          language,
          includeMemory,
          includeCv,
          attachedDocumentIds: attachedDocIds,
          replaceLastPair,
        }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errJson.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const lines = evt.split('\n');
          let eventType = 'message';
          let dataRaw = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: ')) dataRaw = line.slice(6).trim();
          }
          if (!dataRaw) continue;
          const payload = JSON.parse(dataRaw);

          if (eventType === 'meta') {
            if (payload.conversationId && !conversationId) {
              onConversationCreated(payload.conversationId);
            }
            if (payload.agent) {
              onActiveAgentChange({
                name: payload.agent.name,
                reason: payload.routingReason || '',
              });
            }
            if (payload.cvBlockedByPolicy) {
              setErrorMsg(
                'Private CV Lock active: enable "Explicitly Allow CV AI Analysis" in CV & Career Hub or Security Center to share CV context with AI.'
              );
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAiId
                  ? {
                      ...m,
                      agent_id: payload.agent?.id,
                      model: payload.model,
                      citations: payload.citations,
                    }
                  : m
              )
            );
          } else if (eventType === 'draft') {
            firstChunkReceived = true;
            showingDraft = true;
            clearTimeout(watchdogTimer);
            setMessages((prev) =>
              prev.map((m) => (m.id === tempAiId ? { ...m, content: payload.text || '' } : m))
            );
          } else if (eventType === 'chunk') {
            const shouldReplace = !firstChunkReceived || showingDraft || Boolean(payload.replaceDraft);
            firstChunkReceived = true;
            showingDraft = false;
            clearTimeout(watchdogTimer);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAiId
                  ? {
                      ...m,
                      content:
                        (shouldReplace || m.content.startsWith('> **Preparing full step-by-step response')
                          ? ''
                          : m.content) + (payload.text || ''),
                    }
                  : m
              )
            );
          } else if (eventType === 'error') {
            firstChunkReceived = true;
            clearTimeout(watchdogTimer);
            const cleanErr = payload.message || 'AI generation failed';
            setErrorMsg(cleanErr);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAiId && (!m.content.trim() || m.content.startsWith('> **Preparing full step-by-step response'))
                  ? { ...m, content: `> **Provider Notice:** ${cleanErr}` }
                  : m
              )
            );
          } else if (eventType === 'done') {
            firstChunkReceived = true;
            clearTimeout(watchdogTimer);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempAiId
                  ? {
                      ...m,
                      id: payload.assistantMessageId || m.id,
                      tokens_used: payload.tokensUsed,
                    }
                  : m
              )
            );
          }
        }
      }
      clearTimeout(watchdogTimer);
      // Guarantee no empty "Thinking..." bubble remains if stream ended cleanly without chunks
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAiId && !m.content.trim()
            ? { ...m, content: 'No response returned by the provider. Please try Regenerate or switch model.' }
            : m
        )
      );
    } catch (err) {
      clearTimeout(watchdogTimer);
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Streaming failed';
        setErrorMsg(msg);
        setMessages((prev) => prev.filter((m) => m.id !== tempAiId || m.content.length > 0));
      }
    } finally {
      clearTimeout(watchdogTimer);
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleFileAttach = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setAttachedDocIds((prev) => Array.from(new Set([...prev, data.id])));
      onDocumentUploaded();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Attachment upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportChatPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text('REMY THE GRIVER PRO — Session Export', 40, 48);
    doc.setFontSize(10);
    doc.text(`Exported: ${new Date().toLocaleString()} | Developer: Remy Nsanzimana`, 40, 66);

    let y = 94;
    for (const m of messages) {
      const prefix = m.role === 'user' ? 'Remy: ' : 'Assistant: ';
      const lines = doc.splitTextToSize(prefix + m.content, 515);
      for (const line of lines) {
        if (y > 780) {
          doc.addPage();
          y = 48;
        }
        doc.text(line, 40, y);
        y += 14;
      }
      y += 10;
    }
    doc.save(`remy-griver-session-${Date.now()}.pdf`);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Message stream */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl pt-4">
            <div className="flex items-start gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
              <BullManMark className="h-12 w-12 shrink-0" />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white text-balance">
                  {hidePrivateFeatures ? 'Private Mode — AI Workspace' : 'Welcome back, Remy Nsanzimana'}
                </h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {hidePrivateFeatures
                    ? 'Private personal vaults (CV, Memory, Documents, History, Security Center) are hidden from view.'
                    : 'Your Personal AI. Your Rules. Select a specialized workflow below or ask anything across engineering, documents, career, or planning.'}
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedAgentId('engineering');
                  setInput('Review my Express + SQLite architecture and suggest clean TypeScript unit tests.');
                }}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
              >
                <Code2 className="h-5 w-5 shrink-0 text-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">Code Assistant</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Python, React, SQL</div>
                </div>
              </button>

              {!hidePrivateFeatures && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('documents')}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
                  >
                    <FileText className="h-5 w-5 shrink-0 text-amber-500" />
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">Analyze Files</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Local PDF, DOCX, CSV</div>
                    </div>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => onNavigate('research')}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
              >
                <Globe className="h-5 w-5 shrink-0 text-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">Search the Web</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Verified source links</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('productivity')}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
              >
                <UserCheck className="h-5 w-5 shrink-0 text-emerald-500" />
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">Manage Tasks</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Projects & reminders</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('media')}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
              >
                <Film className="h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-white">Media Studio</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Image & Video AI</div>
                </div>
              </button>

              {!hidePrivateFeatures && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate('cv')}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
                  >
                    <FileText className="h-5 w-5 shrink-0 text-amber-500" />
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">CV & Career Hub</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Private skill matcher</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('security')}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111928] dark:hover:border-blue-500/50 dark:hover:bg-[#162032]"
                  >
                    <Shield className="h-5 w-5 shrink-0 text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-white">Security Center</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Permissions & audit</div>
                    </div>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((msg, index) => {
              const isUser = msg.role === 'user';
              const isLastAssistant = !isUser && index === messages.length - 1;
              return (
                <div key={msg.id} className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && <BullManMark className="mt-0.5 h-8 w-8 shrink-0" />}

                  <div className={`max-w-[85%] ${isUser ? 'order-1' : ''}`}>
                    <div className={`mb-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 ${isUser ? 'justify-end' : ''}`}>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {isUser
                          ? hidePrivateFeatures
                            ? 'User'
                            : 'Remy Nsanzimana'
                          : agents.find((a) => a.id === msg.agent_id)?.name || 'REMY THE GRIVER PRO'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {msg.model && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{msg.model}</span>
                        </>
                      )}
                    </div>

                    {isUser ? (
                      editingId === msg.id ? (
                        <div className="rounded-lg border border-blue-500 bg-white p-3 dark:bg-[#111928]">
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={3}
                            className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none dark:text-white"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const text = editDraft.trim();
                                setEditingId(null);
                                if (text) sendMessage(text, true);
                              }}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
                            >
                              Resubmit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="group relative rounded-xl bg-blue-600 px-4 py-3 text-sm leading-relaxed text-white">
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          {index >= messages.length - 2 && !streaming && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(msg.id);
                                setEditDraft(msg.content);
                              }}
                              title="Edit and resubmit"
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-blue-100/80 hover:text-white"
                            >
                              <Pencil className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-[#101724]">
                        {msg.content ? (
                          <MarkdownRenderer content={msg.content} />
                        ) : (
                          <span className="text-sm text-slate-400">Thinking...</span>
                        )}

                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-3 border-t border-slate-200 pt-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            <div className="font-medium text-slate-700 dark:text-slate-300">Local RAG Sources:</div>
                            <ul className="mt-1 space-y-1">
                              {msg.citations.map((c, idx) => (
                                <li key={idx} className="font-mono text-[11px]">
                                  {c.filename} · {c.pageOrRow}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {msg.content && (
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => handleCopy(msg.id, msg.content)}
                              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              {copiedId === msg.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleSpeak(msg)}
                              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              {speakingId === msg.id ? <VolumeX className="h-3.5 w-3.5 text-amber-500" /> : <Volume2 className="h-3.5 w-3.5" />}
                              <span>{speakingId === msg.id ? 'Stop Audio (Esc)' : 'Read Aloud'}</span>
                            </button>
                            {isLastAssistant && !streaming && (
                              <button
                                type="button"
                                onClick={() => {
                                  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                                  if (lastUser) sendMessage(lastUser.content, true);
                                }}
                                className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Regenerate</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={exportChatPdf}
                              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              <span>Export PDF</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="order-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-semibold text-amber-400">
                      RN
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Error & Voice Notice */}
      {(errorMsg || voiceNote) && (
        <div className="mx-6 mb-2 flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span>{errorMsg || voiceNote}</span>
          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setVoiceNote(null);
            }}
            className="ml-3 rounded p-0.5 hover:bg-amber-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Bottom Action Dock */}
      <div className="border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-[#0C121E]">
        <div className="mx-auto max-w-4xl">
          {/* Context Attachments & Toggles */}
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              {!hidePrivateFeatures && (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={includeMemory}
                      onChange={(e) => setIncludeMemory(e.target.checked)}
                      className="rounded border-slate-400 text-blue-600"
                    />
                    <span>Use Memory Vault</span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={includeCv}
                      onChange={(e) => setIncludeCv(e.target.checked)}
                      className="rounded border-slate-400 text-blue-600"
                    />
                    <span>Include CV (Permission-Gated)</span>
                  </label>
                </>
              )}
              {attachedDocIds.length > 0 && (
                <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                  <span>Attached Docs ({attachedDocIds.length}):</span>
                  {attachedDocIds.map((id) => {
                    const doc = documents.find((d) => d.id === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setAttachedDocIds((prev) => prev.filter((x) => x !== id))}
                        className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] hover:bg-blue-500/20"
                      >
                        <span>{doc?.filename || id}</span>
                        <X className="h-3 w-3" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {listening && (
              <div className="flex items-center gap-2 text-blue-500">
                <span className="font-medium">Listening (Esc to stop)</span>
                <div className="flex h-4 items-end gap-0.5">
                  {audioLevels.map((lvl, idx) => (
                    <span
                      key={idx}
                      style={{ height: `${lvl}%` }}
                      className="w-1 rounded-full bg-amber-400 transition-all duration-75"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input Box */}
          <div className="rounded-xl border border-slate-300 bg-slate-50 p-2.5 focus-within:border-blue-500 dark:border-slate-700 dark:bg-[#111928]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Ask REMY THE GRIVER PRO... (Enter to send, Shift+Enter for newline, Esc to stop)"
              className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-slate-900 placeholder-slate-400 outline-none dark:text-slate-100"
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.py,.js,.ts,.tsx,.json"
                  onChange={handleFileAttach}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{uploading ? 'Indexing...' : 'Attach'}</span>
                </button>

                <button
                  type="button"
                  onClick={startVoiceCapture}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    listening
                      ? 'border-amber-500 bg-amber-500/15 text-amber-500'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                  <span>{listening ? 'Stop Mic' : 'Voice'}</span>
                </button>

                <select
                  aria-label="Select AI Model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (General)</option>
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
                  <option value="gemini-4-carbon">Gemini 4 Carbon (Deep Reasoning)</option>
                  <option value="gemini-4-neon">Gemini 4 Neon (Interactive Pro)</option>
                  <option value="gpt-4o-mini">GPT-4o mini (OpenAI Responses API)</option>
                  <option value="gpt-4o">GPT-4o (OpenAI Responses API)</option>
                </select>

                <select
                  aria-label="Select Agent"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="auto">Auto Orchestrator</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Select Language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="en">English</option>
                  <option value="rw">Kinyarwanda</option>
                  <option value="fr">Français</option>
                  <option value="sw">Kiswahili</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                {streaming && (
                  <button
                    type="button"
                    onClick={stopGeneration}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={streaming || !input.trim()}
                  onClick={() => sendMessage()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
