import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  AGENTS,
  buildContextAugmentation,
  buildLocalFallbackReply,
  checkOllamaAvailability,
  executeWithModelFallback,
  formatAiErrorMessage,
  getChatThinkingLevel,
  getGeminiClient,
  routeAgent,
  sanitizeModelName,
  withTimeout,
} from './server/ai.ts';
import { createDatabaseBackup, db, getDatabaseHealth, initDatabase } from './server/db.ts';
import { ingestDocument, parseUploadedDocument, searchLocalChunks } from './server/documents.ts';
import { generateWindowsPythonBundleZip } from './server/pythonExporter.ts';
import { isPermissionGranted, isSettingEnabled, logAudit, maskSecrets, validateSafeUrl } from './server/security.ts';
import {
  analyzeGithubRepository,
  fetchLiveCurrencyRates,
  fetchOpenMeteoWeather,
  getSystemTelemetry,
  runIsolatedPython,
  runSandboxedJavascript,
} from './server/tools.ts';

initDatabase();

const app = express();
const PORT = 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  const dbHealth = getDatabaseHealth();
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  res.json({
    ok: true,
    product: 'REMY THE GRIVER PRO',
    dbHealth,
    geminiConfigured: hasGemini,
    timestamp: new Date().toISOString(),
  });
});

// Bootstrap core app state
app.get('/api/bootstrap', (_req: Request, res: Response) => {
  const user = db.prepare('SELECT * FROM users LIMIT 1').get();
  const settingsRows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of settingsRows) settings[row.key] = row.value;

  const conversations = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50')
    .all();
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY id').all();
  const providers = db.prepare('SELECT * FROM provider_configs ORDER BY priority ASC').all();

  const hidePrivate = settings.hide_private_features === 'true';
  const safeUser = hidePrivate
    ? { full_name: 'Private Workspace', brand_name: 'REMY THE GRIVER PRO', education: '', location: '', github_url: '', email: '' }
    : user;

  res.json({
    user: safeUser,
    settings,
    conversations,
    agents: AGENTS.map(({ id, name, role, description, sensitiveScopes }) => ({
      id,
      name,
      role,
      description,
      sensitiveScopes,
    })),
    permissions,
    providers,
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
  });
});

// Conversations & Messages
app.get('/api/conversations', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all();
  res.json(rows);
});

app.post('/api/conversations', (req: Request, res: Response) => {
  const id = `conv-${crypto.randomUUID().slice(0, 8)}`;
  const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 120) : 'New Session';
  const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId : 'auto';
  const model = sanitizeModelName(req.body?.model);
  const language = typeof req.body?.language === 'string' ? req.body.language : 'en';

  db.prepare(
    `INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)`
  ).run(id, title, agentId, model, language);

  const created = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  res.json(created);
});

app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
  const messages = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(messages);
});

app.patch('/api/conversations/:id/save', (req: Request, res: Response) => {
  const saved = req.body?.saved ? 1 : 0;
  db.prepare("UPDATE conversations SET saved = ?, updated_at = datetime('now') WHERE id = ?").run(saved, req.params.id);
  res.json({ ok: true, saved: Boolean(saved) });
});

app.delete('/api/conversations/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Streaming AI Chat (SSE with AbortController cancellation + Multi-Agent Orchestrator)
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  const {
    conversationId,
    prompt,
    agentId = 'auto',
    model = 'gemini-4-hydrogen',
    language = 'en',
    includeMemory = true,
    includeCv = false,
    attachedDocumentIds = [],
    replaceLastPair = false,
  } = req.body as {
    conversationId?: string;
    prompt?: string;
    agentId?: string;
    model?: string;
    language?: string;
    includeMemory?: boolean;
    includeCv?: boolean;
    attachedDocumentIds?: string[];
    replaceLastPair?: boolean;
  };

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'Prompt text is required.' });
    return;
  }

  let convId = conversationId;
  if (!convId) {
    convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
    const autoTitle = prompt.trim().slice(0, 64) + (prompt.trim().length > 64 ? '...' : '');
    db.prepare(`INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)`).run(
      convId,
      autoTitle,
      agentId,
      sanitizeModelName(model),
      language
    );
  } else {
    const existingConv = db.prepare('SELECT id, title FROM conversations WHERE id = ?').get(convId) as
      | { id: string; title: string }
      | undefined;
    if (!existingConv) {
      const autoTitle = prompt.trim().slice(0, 64) + (prompt.trim().length > 64 ? '...' : '');
      db.prepare(`INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)`).run(
        convId,
        autoTitle,
        agentId,
        sanitizeModelName(model),
        language
      );
    } else if (existingConv.title === 'New Session') {
      const autoTitle = prompt.trim().slice(0, 64) + (prompt.trim().length > 64 ? '...' : '');
      db.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(autoTitle, convId);
    }
  }

  if (replaceLastPair) {
    const lastMsgs = db
      .prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 2')
      .all(convId) as Array<{ id: string }>;
    for (const m of lastMsgs) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
    }
  }

  const userMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)`).run(
    userMsgId,
    convId,
    prompt.trim()
  );

  // Orchestrate agent
  const routing = routeAgent(prompt, agentId);
  const selectedModel = sanitizeModelName(model);

  // Local RAG context (explicitly attached docs first, or global search inside buildContextAugmentation)
  let docContextText = '';
  const citations: Array<{ filename: string; pageOrRow: string; excerpt: string }> = [];
  if (Array.isArray(attachedDocumentIds) && attachedDocumentIds.length > 0) {
    for (const docId of attachedDocumentIds) {
      const matches = searchLocalChunks(prompt, docId, 3);
      for (const m of matches) {
        docContextText += `[${m.filename} | ${m.pageOrRow}]\n${m.content}\n\n`;
        citations.push({ filename: m.filename, pageOrRow: m.pageOrRow, excerpt: m.content.slice(0, 160) });
      }
    }
  }

  const augmentation = buildContextAugmentation({
    prompt: prompt.trim(),
    language,
    includeMemory: Boolean(includeMemory),
    includeCv: Boolean(includeCv),
    docContextText: docContextText || undefined,
  });
  const { contextBlock, cvBlockedByPolicy } = augmentation;
  if (citations.length === 0 && augmentation.globalRagMatches.length > 0) {
    citations.push(...augmentation.globalRagMatches);
  }

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent('meta', {
    conversationId: convId,
    userMessageId: userMsgId,
    agent: { id: routing.agent.id, name: routing.agent.name, role: routing.agent.role },
    routingReason: routing.reason,
    model: selectedModel,
    cvBlockedByPolicy,
    citations,
  });

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'chat_stream', 'denied', 'Strict Local-Only Privacy Mode is active');
    const localReply = buildLocalFallbackReply({
      prompt: prompt.trim(),
      agentName: routing.agent.name,
      memoriesUsed: augmentation.memoriesUsed,
      cvIncluded: augmentation.cvIncluded,
      cvRawText: augmentation.cvRawText,
      cvBlockedByPolicy,
      citations,
      language,
      reason: 'Strict Local-Only Privacy Mode is active. Delivered full local knowledge + verified workspace context (no external cloud calls).',
    });
    sendEvent('chunk', { text: localReply });
    const assistantMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
    ).run(assistantMsgId, convId, localReply, routing.agent.id, 'local-context-only', 0, citations.length > 0 ? JSON.stringify(citations) : null);
    sendEvent('done', { assistantMessageId: assistantMsgId, tokensUsed: 0, cancelled: false });
    res.end();
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    const cleanMsg =
      'GEMINI_API_KEY is not configured in environment secrets. Delivered comprehensive local knowledge + Memory/RAG context.';
    const localReply = buildLocalFallbackReply({
      prompt: prompt.trim(),
      agentName: routing.agent.name,
      memoriesUsed: augmentation.memoriesUsed,
      cvIncluded: augmentation.cvIncluded,
      cvRawText: augmentation.cvRawText,
      cvBlockedByPolicy,
      citations,
      language,
      reason: cleanMsg,
    });
    sendEvent('chunk', { text: localReply });
    const assistantMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
    ).run(assistantMsgId, convId, localReply, routing.agent.id, 'local-knowledge', 0, citations.length > 0 ? JSON.stringify(citations) : null);
    sendEvent('done', { assistantMessageId: assistantMsgId, tokensUsed: 0, cancelled: false });
    res.end();
    return;
  }

  let effectiveModel = selectedModel;
  let hasLiveChunk = false;
  let fastDraftSent = false;

  // Guarantee < 2s visual response without aborting Cloud AI streaming
  const fastDraftTimer = setTimeout(() => {
    if (!hasLiveChunk && !abortController.signal.aborted && !res.writableEnded) {
      fastDraftSent = true;
      const draftText = buildLocalFallbackReply({
        prompt: prompt.trim(),
        agentName: routing.agent.name,
        memoriesUsed: augmentation.memoriesUsed,
        cvIncluded: augmentation.cvIncluded,
        cvRawText: augmentation.cvRawText,
        cvBlockedByPolicy,
        citations,
        language,
        reason: `Instant <2s guide shown while ${selectedModel} streams live...`,
      });
      sendEvent('draft', { text: draftText });
    }
  }, 1500);

  try {
    const history = db
      .prepare(
        'SELECT role, content FROM (SELECT role, content, rowid FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 20) ORDER BY rowid ASC'
      )
      .all(convId) as Array<{ role: string; content: string }>;

    const historyText = history
      .slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const fullSystem = [
      routing.agent.systemPrompt,
      contextBlock,
      cvBlockedByPolicy
        ? 'NOTE: User requested CV context, but CV External AI transmission is LOCKED in Security Center. Inform the user politely if they ask about private CV details.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const fullContents = historyText ? `Previous conversation:\n${historyText}\n\nCurrent request:\n${prompt.trim()}` : prompt.trim();

    let fullReply = '';
    const { result: streamResult, modelUsed, fallbackUsed } = await executeWithModelFallback(
      selectedModel,
      async (candidateModel, remainingMs) => {
        const startedAt = Date.now();
        const stream = await withTimeout(
          ai.models.generateContentStream({
            model: candidateModel,
            contents: fullContents,
            config: {
              systemInstruction: fullSystem,
              thinkingConfig: {
                thinkingLevel: getChatThinkingLevel(candidateModel),
              },
            },
          }),
          Math.min(remainingMs, 9000),
          'TIMEOUT_2S'
        );
        const iterator = stream[Symbol.asyncIterator]();
        const timeLeftForFirstChunk = Math.max(1500, Math.min(remainingMs - (Date.now() - startedAt), 9000));
        const firstStep = await withTimeout(iterator.next(), timeLeftForFirstChunk, 'TIMEOUT_2S');
        const collected: string[] = [];
        if (!firstStep.done) {
          const firstText = firstStep.value?.text ?? '';
          if (firstText) {
            hasLiveChunk = true;
            clearTimeout(fastDraftTimer);
            collected.push(firstText);
            sendEvent('chunk', { text: firstText, replaceDraft: fastDraftSent });
            fastDraftSent = false;
          }
          while (!abortController.signal.aborted) {
            const nextStep = await iterator.next();
            if (nextStep.done) break;
            const text = nextStep.value?.text ?? '';
            if (text) {
              hasLiveChunk = true;
              clearTimeout(fastDraftTimer);
              collected.push(text);
              sendEvent('chunk', { text, replaceDraft: fastDraftSent });
              fastDraftSent = false;
            }
          }
        }
        return collected.join('');
      },
      20000
    );

    clearTimeout(fastDraftTimer);
    fullReply = streamResult;
    effectiveModel = modelUsed;
    if (fallbackUsed) {
      sendEvent('meta', {
        conversationId: convId,
        userMessageId: userMsgId,
        agent: { id: routing.agent.id, name: routing.agent.name, role: routing.agent.role },
        routingReason: `${routing.reason} (Auto-switched to ${modelUsed})`,
        model: modelUsed,
        cvBlockedByPolicy,
        citations,
      });
    }

    if (!fullReply.trim()) {
      fullReply = abortController.signal.aborted
        ? '[Generation cancelled by user]'
        : buildLocalFallbackReply({
            prompt: prompt.trim(),
            agentName: routing.agent.name,
            memoriesUsed: augmentation.memoriesUsed,
            cvIncluded: augmentation.cvIncluded,
            cvRawText: augmentation.cvRawText,
            cvBlockedByPolicy,
            citations,
            language,
            reason: 'Cloud provider returned an empty stream; delivered comprehensive local knowledge response.',
          });
      if (!abortController.signal.aborted) {
        sendEvent('chunk', { text: fullReply, replaceDraft: true });
      }
    }

    const assistantMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const approxTokens = Math.ceil((prompt.length + fullReply.length) / 4);
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
    ).run(
      assistantMsgId,
      convId,
      fullReply,
      routing.agent.id,
      effectiveModel,
      approxTokens,
      citations.length > 0 ? JSON.stringify(citations) : null
    );

    db.prepare("UPDATE conversations SET agent_id = ?, model = ?, language = ?, updated_at = datetime('now') WHERE id = ?").run(
      routing.agent.id,
      effectiveModel,
      language,
      convId
    );

    sendEvent('done', {
      assistantMessageId: assistantMsgId,
      tokensUsed: approxTokens,
      cancelled: abortController.signal.aborted,
    });
    res.end();
  } catch (err) {
    clearTimeout(fastDraftTimer);
    const cleanErrMsg = formatAiErrorMessage(err);
    logAudit('ai_stream_error', 'ai_engine', effectiveModel, 'info', cleanErrMsg);
    const localReply = buildLocalFallbackReply({
      prompt: prompt.trim(),
      agentName: routing.agent.name,
      memoriesUsed: augmentation.memoriesUsed,
      cvIncluded: augmentation.cvIncluded,
      cvRawText: augmentation.cvRawText,
      cvBlockedByPolicy,
      citations,
      language,
      reason: cleanErrMsg,
    });
    const assistantMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
    ).run(
      assistantMsgId,
      convId,
      localReply,
      routing.agent.id,
      'local-fallback',
      0,
      citations.length > 0 ? JSON.stringify(citations) : null
    );
    sendEvent('chunk', { text: localReply, replaceDraft: true });
    sendEvent('error', { message: cleanErrMsg });
    sendEvent('done', { assistantMessageId: assistantMsgId, tokensUsed: 0, cancelled: false });
    res.end();
  }
});

// Developer Studio
app.post('/api/studio/run-vm', (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code.trim()) {
    res.status(400).json({ error: 'Code is required' });
    return;
  }
  const result = runSandboxedJavascript(code);
  res.json(result);
});

app.post('/api/studio/run-python', async (req: Request, res: Response) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code.trim()) {
    res.status(400).json({ error: 'Python code is required' });
    return;
  }
  const result = await runIsolatedPython(code);
  res.json(result);
});

app.post('/api/studio/analyze-github', async (req: Request, res: Response) => {
  try {
    const repoUrl = typeof req.body?.repoUrl === 'string' ? req.body.repoUrl : '';
    const data = await analyzeGithubRepository(repoUrl);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'GitHub analysis failed' });
  }
});

app.post('/api/studio/ai-assist', async (req: Request, res: Response) => {
  const { task, code, language = 'Python 3.11+', model = 'gemini-4-hydrogen' } = req.body as {
    task: string;
    code: string;
    language?: string;
    model?: string;
  };
  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'studio.ai_assist', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Use the isolated local Python runner or disable Strict Local Mode in Settings.' });
    return;
  }
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }
  try {
    const { result: response } = await executeWithModelFallback(model, (candidateModel) =>
      ai.models.generateContent({
        model: candidateModel,
        contents: `Task: ${task}\nTarget Language/Stack: ${language}\n\nInput Code / Context:\n${code}`,
        config: {
          systemInstruction:
            'You are the Software Engineering Agent in REMY THE GRIVER PRO. Write clean, idiomatic Python 3.11+ code by default unless another language is explicitly requested. Provide crisp, production-ready code, explanations, SQL schemas, READMEs, or pytest/unittest suites in Markdown.',
        },
      })
    );
    res.json({ result: response.text ?? '' });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

// Document Intelligence & Local RAG
app.get('/api/documents', (_req: Request, res: Response) => {
  const docs = db.prepare('SELECT * FROM documents ORDER BY created_at DESC').all();
  res.json(docs);
});

app.post('/api/documents/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  try {
    const ingested = await ingestDocument(req.file.buffer, req.file.originalname, req.file.mimetype);
    logAudit('document_ingested', 'user', req.file.originalname, 'allowed', `Indexed ${ingested.chunkCount} chunks locally`);
    res.json(ingested);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Document parsing failed' });
  }
});

app.get('/api/documents/:id/chunks', (req: Request, res: Response) => {
  const chunks = db
    .prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC')
    .all(req.params.id);
  res.json(chunks);
});

app.delete('/api/documents/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  logAudit('document_deleted', 'user', String(req.params.id), 'info', 'Removed document and chunks from local vault');
  res.json({ ok: true });
});

app.post('/api/documents/search', (req: Request, res: Response) => {
  const { query, documentId } = req.body as { query?: string; documentId?: string };
  if (!query || !query.trim()) {
    res.status(400).json({ error: 'Search query required' });
    return;
  }
  const results = searchLocalChunks(query, documentId, 6);
  res.json({ results });
});

app.post('/api/documents/ask', async (req: Request, res: Response) => {
  const { question, documentId, model = 'gemini-4-hydrogen' } = req.body as {
    question?: string;
    documentId?: string;
    model?: string;
  };
  if (!question?.trim()) {
    res.status(400).json({ error: 'Question is required' });
    return;
  }
  const chunks = searchLocalChunks(question, documentId, 5);
  if (chunks.length === 0) {
    res.json({
      answer: 'No matching indexed document chunks were found locally for that query. Upload a document or refine your keywords.',
      citations: [],
    });
    return;
  }

  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'documents.ask', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Use Local Offline Search on the left to query chunks without external AI.' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }
  try {
    const context = chunks
      .map((c) => `[Source: ${c.filename} | ${c.pageOrRow}]\n${c.content}`)
      .join('\n\n---\n\n');
    const { result: response } = await executeWithModelFallback(model, (candidateModel) =>
      ai.models.generateContent({
        model: candidateModel,
        contents: `Document Context:\n${context}\n\nQuestion: ${question}`,
        config: {
          systemInstruction:
            'Answer strictly based on the provided document excerpts. Cite each claim using [Source: filename | pageOrRow]. If the excerpts lack the answer, state that clearly.',
        },
      })
    );
    res.json({
      answer: response.text ?? '',
      citations: chunks.map((c) => ({
        filename: c.filename,
        pageOrRow: c.pageOrRow,
        score: c.score,
        excerpt: c.content.slice(0, 200),
      })),
    });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

// CV & Career Intelligence
app.get('/api/cv', (_req: Request, res: Response) => {
  const profile = db.prepare("SELECT * FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as Record<string, unknown>;
  const versions = db
    .prepare("SELECT * FROM cv_versions WHERE cv_id = 'remy-primary-cv' ORDER BY created_at DESC")
    .all();
  const externalAllowed = isPermissionGranted('cv.external_ai');
  res.json({ profile, versions, externalAllowed });
});

app.patch('/api/cv/privacy', (req: Request, res: Response) => {
  const allowExternal = Boolean(req.body?.allowExternal);
  db.prepare("UPDATE permissions SET granted = ?, updated_at = datetime('now') WHERE scope = 'cv.external_ai'").run(
    allowExternal ? 1 : 0
  );
  db.prepare("UPDATE cv_profiles SET private_locked = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'").run(
    allowExternal ? 0 : 1
  );
  logAudit(
    'cv_privacy_changed',
    'user',
    'cv.external_ai',
    allowExternal ? 'allowed' : 'info',
    allowExternal ? 'User unlocked CV for explicit AI career analysis' : 'User locked CV to strictly local private mode'
  );
  res.json({ ok: true, externalAllowed: allowExternal });
});

app.post('/api/cv/versions', (req: Request, res: Response) => {
  const { versionLabel, targetRole = '', rawText, notes = '' } = req.body as {
    versionLabel?: string;
    targetRole?: string;
    rawText?: string;
    notes?: string;
  };
  if (!versionLabel?.trim() || !rawText?.trim()) {
    res.status(400).json({ error: 'Version label and CV content are required' });
    return;
  }
  const id = `cv-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO cv_versions (id, cv_id, version_label, target_role, raw_text, notes) VALUES (?, 'remy-primary-cv', ?, ?, ?, ?)`
  ).run(id, versionLabel.trim(), targetRole.trim(), rawText.trim(), notes.trim());
  db.prepare("UPDATE cv_profiles SET raw_text = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'").run(
    rawText.trim()
  );
  const created = db.prepare('SELECT * FROM cv_versions WHERE id = ?').get(id);
  res.json(created);
});

app.post('/api/cv/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No CV file provided' });
    return;
  }
  try {
    const parsed = await parseUploadedDocument(req.file.buffer, req.file.originalname, req.file.mimetype);
    const id = `cv-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO cv_versions (id, cv_id, version_label, target_role, raw_text, notes) VALUES (?, 'remy-primary-cv', ?, ?, ?, ?)`
    ).run(
      id,
      `Imported: ${req.file.originalname}`,
      'Uploaded Document',
      parsed.rawText,
      `Parsed locally (${parsed.pageCount} pages, ${parsed.chunks.length} chunks)`
    );
    logAudit('cv_file_parsed_locally', 'user', req.file.originalname, 'allowed', 'Parsed locally without external transmission');
    res.json({ id, filename: req.file.originalname, rawText: parsed.rawText });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'CV parsing failed' });
  }
});

app.post('/api/cv/compare-local', (req: Request, res: Response) => {
  const { jobDescription = '' } = req.body as { jobDescription?: string };
  const profile = db.prepare("SELECT skills_json, raw_text FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as {
    skills_json: string;
    raw_text: string;
  };
  const skills = JSON.parse(profile.skills_json) as string[];
  const jdLower = jobDescription.toLowerCase();

  const matchedSkills: string[] = [];
  const missingFromJd: string[] = [];
  for (const s of skills) {
    const tokens = s.toLowerCase().split(/[\s./]+/).filter((t) => t.length >= 2);
    if (tokens.some((t) => jdLower.includes(t))) {
      matchedSkills.push(s);
    } else {
      missingFromJd.push(s);
    }
  }

  // Extract technical terms in JD that are not in CV
  const techDictionary = [
    'typescript', 'python', 'docker', 'kubernetes', 'aws', 'azure', 'postgresql', 'graphql',
    'redis', 'next.js', 'tailwind', 'pytest', 'ci/cd', 'linux', 'fastapi', 'django', 'react',
    'node.js', 'express', 'mongodb', 'mysql', 'supabase', 'git', 'rest', 'blockchain',
  ];
  const cvLower = profile.raw_text.toLowerCase();
  const jdKeywordsFound = techDictionary.filter((k) => jdLower.includes(k));
  const gapsInCv = jdKeywordsFound.filter((k) => !cvLower.includes(k));
  const matchRatio =
    jdKeywordsFound.length > 0
      ? Math.round(((jdKeywordsFound.length - gapsInCv.length) / jdKeywordsFound.length) * 100)
      : matchedSkills.length > 0
      ? Math.min(100, Math.round((matchedSkills.length / skills.length) * 100))
      : 0;

  res.json({
    mode: 'local_private_analysis',
    matchScorePercent: matchRatio,
    matchedSkills,
    jdKeywordsFound,
    gapsInCv,
    unusedCvSkills: missingFromJd,
  });
});

app.post('/api/cv/ai-coach', async (req: Request, res: Response) => {
  const { mode, jobDescription = '', model = 'gemini-4-hydrogen' } = req.body as {
    mode: 'optimize' | 'cover_letter' | 'interview' | 'career_plan';
    jobDescription?: string;
    model?: string;
  };

  if (!isPermissionGranted('cv.external_ai')) {
    logAudit('cv_ai_blocked', 'security_gatekeeper', mode, 'denied', 'CV external transmission is locked');
    res.status(403).json({
      error:
        'CV Privacy Lock is active. Enable "Explicitly Allow CV AI Analysis" in the CV Vault or Security Center before sending CV details to AI.',
    });
    return;
  }

  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'cv.ai_coach', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Use "Run Local Match (Offline)" instead.' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }

  const profile = db.prepare("SELECT raw_text FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as { raw_text: string };

  const taskPrompts: Record<string, string> = {
    optimize: 'Analyze this verified CV against the target job description (if provided). Suggest concrete wording improvements and missing skills to study WITHOUT inventing any fake duties, jobs, certificates, or awards.',
    cover_letter: 'Draft a tailored, authentic cover letter using ONLY the verified facts in the CV (EAV KIVUMU TSS, Kigali Rwanda, selected projects, and April 2026 ICT SMART SOLUTION internship). Never invent past employment or awards.',
    interview: 'Generate 8 realistic technical and behavioral interview questions tailored to Remy Nsanzimana’s stack (React, Node, Express, MySQL, MongoDB, Python, REST APIs) and selected projects, with brief guidance on answering.',
    career_plan: 'Create a practical 90-day career and skill roadmap building on Level 5 Software Development, Python, React/Node, and cloud fundamentals.',
  };

  try {
    logAudit('cv_ai_coach_run', 'user', mode, 'allowed', 'User explicitly authorized CV AI coaching');
    const { result: response } = await executeWithModelFallback(model, (candidateModel) =>
      ai.models.generateContent({
        model: candidateModel,
        contents: `VERIFIED CV:\n${profile.raw_text}\n\nTARGET JOB DESCRIPTION:\n${jobDescription || '(None provided)'}\n\nTASK:\n${taskPrompts[mode] || taskPrompts.optimize}`,
        config: {
          systemInstruction:
            'You are the Career & CV Agent. Strictly adhere to verified facts in the CV. Never fabricate employment history, academic grades, certificates, or awards.',
        },
      })
    );
    res.json({ result: response.text ?? '' });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

// Memory Vault
app.get('/api/memories', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all();
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'memory_enabled'").get() as { value: string } | undefined;
  res.json({ memories: rows, memoryEnabled: setting?.value !== 'false' });
});

app.post('/api/memories', (req: Request, res: Response) => {
  const { title, content, category = 'general', approved = 1, source = 'user' } = req.body as {
    title?: string;
    content?: string;
    category?: string;
    approved?: number;
    source?: string;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Title and content are required' });
    return;
  }
  const id = `mem-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO memories (id, title, content, category, approved, enabled, source) VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, title.trim(), content.trim(), category.trim(), approved ? 1 : 0, source);
  res.json(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
});

app.patch('/api/memories/:id', (req: Request, res: Response) => {
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(req.params.id) as
    | { title: string; content: string; category: string; approved: number; enabled: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Memory not found' });
    return;
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : existing.title;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : existing.content;
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : existing.category;
  const approved = req.body?.approved !== undefined ? (req.body.approved ? 1 : 0) : existing.approved;
  const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : existing.enabled;

  db.prepare(
    `UPDATE memories SET title = ?, content = ?, category = ?, approved = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(title, content, category, approved, enabled, String(req.params.id));
  res.json(db.prepare('SELECT * FROM memories WHERE id = ?').get(String(req.params.id)));
});

app.delete('/api/memories/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM memories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/memories/toggle-global', (req: Request, res: Response) => {
  const enabled = Boolean(req.body?.enabled);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('memory_enabled', ?, datetime('now'))").run(
    enabled ? 'true' : 'false'
  );
  res.json({ ok: true, memoryEnabled: enabled });
});

// Productivity Center
app.get('/api/productivity', (_req: Request, res: Response) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  const notes = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
  const reminders = db.prepare('SELECT * FROM reminders ORDER BY remind_at ASC').all();
  res.json({ projects, tasks, notes, reminders });
});

app.post('/api/productivity/tasks', (req: Request, res: Response) => {
  const { title, description = '', priority = 'medium', projectId = null, dueDate = null } = req.body as {
    title?: string;
    description?: string;
    priority?: string;
    projectId?: string | null;
    dueDate?: string | null;
  };
  if (!title?.trim()) {
    res.status(400).json({ error: 'Task title is required' });
    return;
  }
  const id = `task-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, priority, status, due_date) VALUES (?, ?, ?, ?, ?, 'todo', ?)`
  ).run(id, projectId, title.trim(), description, priority, dueDate);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.patch('/api/productivity/tasks/:id', (req: Request, res: Response) => {
  const { status, priority, title } = req.body as { status?: string; priority?: string; title?: string };
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as
    | { status: string; priority: string; title: string }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  db.prepare('UPDATE tasks SET status = ?, priority = ?, title = ? WHERE id = ?').run(
    status || existing.status,
    priority || existing.priority,
    title || existing.title,
    String(req.params.id)
  );
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(String(req.params.id)));
});

app.delete('/api/productivity/tasks/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/productivity/notes', (req: Request, res: Response) => {
  const { title, content, category = 'general' } = req.body as { title?: string; content?: string; category?: string };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Note title and content are required' });
    return;
  }
  const id = `note-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO notes (id, title, content, category) VALUES (?, ?, ?, ?)`).run(
    id,
    title.trim(),
    content.trim(),
    category
  );
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
});

app.delete('/api/productivity/notes/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/productivity/reminders', (req: Request, res: Response) => {
  const { title, remindAt } = req.body as { title?: string; remindAt?: string };
  if (!title?.trim() || !remindAt?.trim()) {
    res.status(400).json({ error: 'Reminder title and date/time are required' });
    return;
  }
  const id = `rem-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO reminders (id, title, remind_at) VALUES (?, ?, ?)`).run(id, title.trim(), remindAt.trim());
  res.json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
});

app.patch('/api/productivity/reminders/:id', (req: Request, res: Response) => {
  const completed = req.body?.completed ? 1 : 0;
  db.prepare('UPDATE reminders SET completed = ? WHERE id = ?').run(completed, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/productivity/reminders/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/productivity/weather', async (req: Request, res: Response) => {
  try {
    const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim() : 'Kigali';
    const weather = await fetchOpenMeteoWeather(city);
    res.json(weather);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Weather fetch failed' });
  }
});

app.get('/api/productivity/currency', async (req: Request, res: Response) => {
  try {
    const base = typeof req.query.base === 'string' ? req.query.base : 'USD';
    const data = await fetchLiveCurrencyRates(base);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Currency fetch failed' });
  }
});

// Web Research Engine (Real Google Search Grounding)
app.post('/api/research/search', async (req: Request, res: Response) => {
  const { query, model = 'gemini-4-hydrogen' } = req.body as { query?: string; model?: string };
  if (!query?.trim()) {
    res.status(400).json({ error: 'Research query is required' });
    return;
  }
  if (!isPermissionGranted('research.web_search')) {
    logAudit('web_search_blocked', 'security_gatekeeper', query, 'denied', 'research.web_search permission disabled');
    res.status(403).json({ error: 'Web Search is disabled in Security Center permissions.' });
    return;
  }

  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'research.search', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Outbound Web Research is blocked.' });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }

  try {
    logAudit('web_research_query', 'research_agent', query, 'allowed', 'Executed Google Search grounded research');
    const { result: response } = await executeWithModelFallback(model, (candidateModel) =>
      ai.models.generateContent({
        model: candidateModel,
        contents: query.trim(),
        config: {
          tools: [{ googleSearch: {} }],
          systemInstruction:
            'You are the Research Agent for REMY THE GRIVER PRO. Provide structured findings separated clearly into "Verified Sourced Facts" and "Analytical Synthesis". Never fabricate URLs or unverified claims.',
        },
      })
    );

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        const check = validateSafeUrl(chunk.web.uri);
        if (check.safe) {
          sources.push({
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri,
          });
        }
      }
    }

    res.json({
      query: query.trim(),
      summary: response.text ?? '',
      sources,
    });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

// System Monitor & Providers
app.get('/api/system/telemetry', async (_req: Request, res: Response) => {
  const telemetry = getSystemTelemetry();
  const dbHealth = getDatabaseHealth();
  const ollama = await checkOllamaAvailability();
  const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  res.json({
    telemetry,
    dbHealth,
    providers: {
      gemini: { available: hasGemini, model: 'gemini-4-hydrogen' },
      ollama,
    },
  });
});

app.post('/api/system/ollama-probe', async (req: Request, res: Response) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : undefined;
  const result = await checkOllamaAvailability(endpoint);
  res.json(result);
});

// Security Center
app.get('/api/security/overview', (_req: Request, res: Response) => {
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY id').all();
  const folders = db.prepare('SELECT * FROM approved_folders ORDER BY added_at DESC').all();
  const apps = db.prepare('SELECT * FROM approved_apps ORDER BY added_at DESC').all();
  const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 60').all();
  const backupsDir = path.resolve(process.cwd(), 'storage', 'backups');
  const backups = fs.existsSync(backupsDir)
    ? fs.readdirSync(backupsDir).map((f) => ({
        filename: f,
        sizeBytes: fs.statSync(path.join(backupsDir, f)).size,
      }))
    : [];

  res.json({ permissions, folders, apps, auditLogs, backups });
});

app.patch('/api/security/permissions/:scope', (req: Request, res: Response) => {
  const granted = req.body?.granted ? 1 : 0;
  const scope = String(req.params.scope);
  db.prepare("UPDATE permissions SET granted = ?, updated_at = datetime('now') WHERE scope = ?").run(granted, scope);
  if (scope === 'cv.external_ai') {
    db.prepare("UPDATE cv_profiles SET private_locked = ? WHERE id = 'remy-primary-cv'").run(granted ? 0 : 1);
  }
  logAudit('permission_toggled', 'user', scope, granted ? 'allowed' : 'denied', `Set to ${granted ? 'granted' : 'revoked'}`);
  res.json({ ok: true, granted: Boolean(granted) });
});

app.post('/api/security/folders', (req: Request, res: Response) => {
  const folderPath = typeof req.body?.folderPath === 'string' ? req.body.folderPath.trim() : '';
  const accessLevel = typeof req.body?.accessLevel === 'string' ? req.body.accessLevel : 'read';
  if (!folderPath) {
    res.status(400).json({ error: 'Folder path is required' });
    return;
  }
  const id = `fld-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO approved_folders (id, folder_path, access_level) VALUES (?, ?, ?)').run(
    id,
    folderPath,
    accessLevel
  );
  logAudit('folder_approved', 'user', folderPath, 'allowed', `Access: ${accessLevel}`);
  res.json(db.prepare('SELECT * FROM approved_folders WHERE id = ?').get(id));
});

app.delete('/api/security/folders/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM approved_folders WHERE id = ?').run(req.params.id);
  logAudit('folder_revoked', 'user', String(req.params.id), 'info', 'Removed approved folder');
  res.json({ ok: true });
});

app.post('/api/security/apps', (req: Request, res: Response) => {
  const { appName, executablePath } = req.body as { appName?: string; executablePath?: string };
  if (!appName?.trim() || !executablePath?.trim()) {
    res.status(400).json({ error: 'Application name and path are required' });
    return;
  }
  const id = `app-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare('INSERT INTO approved_apps (id, app_name, executable_path, allowed) VALUES (?, ?, ?, 1)').run(
    id,
    appName.trim(),
    executablePath.trim()
  );
  logAudit('app_approved', 'user', appName.trim(), 'allowed', executablePath.trim());
  res.json(db.prepare('SELECT * FROM approved_apps WHERE id = ?').get(id));
});

app.delete('/api/security/apps/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM approved_apps WHERE id = ?').run(req.params.id);
  logAudit('app_revoked', 'user', String(req.params.id), 'info', 'Removed approved application');
  res.json({ ok: true });
});

app.post('/api/security/backup', async (_req: Request, res: Response) => {
  try {
    const backup = await createDatabaseBackup();
    logAudit('sqlite_backup_created', 'user', backup.filename, 'allowed', `${backup.sizeBytes} bytes`);
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backup failed' });
  }
});

app.post('/api/security/mask-test', (req: Request, res: Response) => {
  const sample = typeof req.body?.sample === 'string' ? req.body.sample : '';
  res.json({ masked: maskSecrets(sample) });
});

// Plugins
app.get('/api/plugins', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM plugins ORDER BY created_at ASC').all();
  res.json(rows);
});

app.patch('/api/plugins/:id/toggle', (req: Request, res: Response) => {
  const enabled = req.body?.enabled ? 1 : 0;
  const approved = req.body?.approved !== undefined ? (req.body.approved ? 1 : 0) : enabled;
  db.prepare('UPDATE plugins SET enabled = ?, approved = ? WHERE id = ?').run(enabled, approved, req.params.id);
  logAudit('plugin_toggled', 'user', String(req.params.id), enabled ? 'allowed' : 'info', `Enabled=${enabled}`);
  res.json(db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id));
});

app.post('/api/plugins/:id/run', async (req: Request, res: Response) => {
  const plugin = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id) as
    | { id: string; name: string; enabled: number; approved: number }
    | undefined;
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not found' });
    return;
  }
  if (!plugin.enabled || !plugin.approved || !isPermissionGranted('plugins.execute')) {
    logAudit('plugin_exec_blocked', 'security_gatekeeper', plugin.name, 'denied', 'Plugin disabled or permission revoked');
    res.status(403).json({ error: 'Plugin execution denied: plugin must be approved, enabled, and plugins.execute granted.' });
    return;
  }

  let output = '';
  try {
    if (plugin.id === 'plug-kigali-brief') {
      const weather = await fetchOpenMeteoWeather('Kigali');
      const openTasks = db.prepare("SELECT title, priority FROM tasks WHERE status != 'done' LIMIT 5").all() as Array<{
        title: string;
        priority: string;
      }>;
      output = `Kigali Weather: ${weather.temperatureC}°C (${weather.condition}), Humidity ${weather.humidityPercent}%.\nOpen Tasks (${openTasks.length}):\n${openTasks.map((t) => `- [${t.priority}] ${t.title}`).join('\n')}`;
    } else if (plugin.id === 'plug-code-complexity') {
      const code = typeof req.body?.input === 'string' ? req.body.input : 'function sample(x) { return x > 0 ? x : 0; }';
      const lines = code.split(/\r?\n/).length;
      const branches = (code.match(/\b(if|else|for|while|switch|case|\?|&&|\|\|)\b/g) || []).length + 1;
      output = `Lines of Code: ${lines}\nEstimated Cyclomatic Branches: ${branches}\nStatus: Isolated static inspection complete.`;
    } else {
      const profile = db.prepare("SELECT skills_json FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as {
        skills_json: string;
      };
      const skills = JSON.parse(profile.skills_json) as string[];
      output = `Local CV Keyword Audit: ${skills.length} verified technical skill areas indexed locally (${skills.slice(0, 6).join(', ')}...).`;
    }

    db.prepare("UPDATE plugins SET last_run = datetime('now'), last_status = 'success' WHERE id = ?").run(plugin.id);
    logAudit('plugin_executed', 'plugin_host', plugin.name, 'allowed', 'Isolated execution succeeded');
    res.json({ ok: true, output });
  } catch (err) {
    db.prepare("UPDATE plugins SET last_run = datetime('now'), last_status = 'error' WHERE id = ?").run(plugin.id);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Plugin execution failed' });
  }
});

// Settings & Python Desktop Bundle Export
app.patch('/api/settings', (req: Request, res: Response) => {
  const updates = req.body as Record<string, string>;
  const stmt = db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))");
  for (const [key, val] of Object.entries(updates)) {
    if (typeof val === 'string') {
      stmt.run(key, val);
    }
  }
  res.json({ ok: true });
});

// Media Studio: Real Gemini Interactions API Image & Video Generation
app.post('/api/media/generate-image', async (req: Request, res: Response) => {
  const { prompt, aspectRatio = '1:1' } = req.body as {
    prompt?: string;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  };
  if (!prompt?.trim()) {
    res.status(400).json({ error: 'Image prompt is required.' });
    return;
  }
  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'media.generate_image', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Disable Strict Local Mode in Settings to generate cloud media.' });
    return;
  }
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }
  try {
    logAudit('media_image_generate', 'user', aspectRatio, 'allowed', prompt.trim().slice(0, 100));
    const interaction = await ai.interactions.create({
      model: 'gemini-3.1-flash-lite-image',
      input: prompt.trim(),
      response_modalities: ['image', 'text'],
      generation_config: {
        image_config: {
          aspect_ratio: aspectRatio,
          image_size: '1K',
        },
      },
    } as never);

    const outputImage = (interaction as unknown as {
      output_image?: { data?: string; mime_type?: string };
      output_text?: string;
      steps?: Array<{
        type?: string;
        content?: Array<{ type?: string; data?: string; mime_type?: string; text?: string }>;
      }>;
    }).output_image;

    let imageData = outputImage?.data;
    let mimeType = outputImage?.mime_type || 'image/png';
    let textNote = (interaction as unknown as { output_text?: string }).output_text || '';

    const steps = (interaction as unknown as {
      steps?: Array<{
        type?: string;
        content?: Array<{ type?: string; data?: string; mime_type?: string; text?: string }>;
      }>;
    }).steps;

    if (!imageData && Array.isArray(steps)) {
      for (const step of steps) {
        if (step.type === 'model_output' && Array.isArray(step.content)) {
          const imgPart = step.content.find((c) => c.type === 'image' && c.data);
          if (imgPart?.data) {
            imageData = imgPart.data;
            mimeType = imgPart.mime_type || 'image/png';
          }
          const txtPart = step.content.find((c) => c.type === 'text' && c.text);
          if (txtPart?.text && !textNote) {
            textNote = txtPart.text;
          }
        }
      }
    }

    if (!imageData) {
      res.status(502).json({ error: 'Gemini image model did not return image bytes.' });
      return;
    }

    res.json({
      model: 'gemini-3.1-flash-lite-image',
      aspectRatio,
      mimeType,
      imageDataUrl: `data:${mimeType};base64,${imageData}`,
      textNote,
    });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

app.post('/api/media/generate-video', async (req: Request, res: Response) => {
  const { prompt, aspectRatio = '16:9', duration = '8s', resolution = '720p' } = req.body as {
    prompt?: string;
    aspectRatio?: '16:9' | '9:16';
    duration?: string;
    resolution?: '360p' | '720p' | '1080p';
  };
  if (!prompt?.trim()) {
    res.status(400).json({ error: 'Video prompt is required.' });
    return;
  }
  if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
    res.status(400).json({ error: 'Video aspectRatio must be 16:9 or 9:16.' });
    return;
  }
  if (isSettingEnabled('strict_local_mode')) {
    logAudit('strict_local_blocked', 'security_gatekeeper', 'media.generate_video', 'denied', 'Strict Local-Only Privacy Mode is active');
    res.status(403).json({ error: 'Strict Local-Only Privacy Mode is active. Disable Strict Local Mode in Settings to generate cloud video.' });
    return;
  }
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({ error: 'GEMINI_API_KEY is not configured in environment secrets.' });
    return;
  }
  try {
    logAudit('media_video_generate', 'user', `${aspectRatio}/${duration}`, 'allowed', prompt.trim().slice(0, 100));
    const interaction = await ai.interactions.create(
      {
        model: 'gemini-omni-1.2-flash',
        input: prompt.trim(),
        background: false,
        store: false,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: aspectRatio,
          duration,
          resolution,
        },
      } as never,
      { timeout: 300000 }
    );

    const typedInteraction = interaction as unknown as {
      output_video?: { data?: string; uri?: string; mime_type?: string };
      steps?: Array<{
        type?: string;
        content?: Array<{ type?: string; data?: string; uri?: string; mime_type?: string }>;
      }>;
    };

    let videoData = typedInteraction.output_video?.data;
    let videoUri = typedInteraction.output_video?.uri;
    let mimeType = typedInteraction.output_video?.mime_type || 'video/mp4';

    if (!videoData && !videoUri && Array.isArray(typedInteraction.steps)) {
      for (const step of typedInteraction.steps) {
        if (step.type === 'model_output' && Array.isArray(step.content)) {
          const vidPart = step.content.find((c) => c.type === 'video' && (c.data || c.uri));
          if (vidPart) {
            videoData = vidPart.data;
            videoUri = vidPart.uri;
            mimeType = vidPart.mime_type || 'video/mp4';
            break;
          }
        }
      }
    }

    if (!videoData && !videoUri) {
      res.status(502).json({ error: 'Gemini Omni video model completed without returning video output.' });
      return;
    }

    res.json({
      model: 'gemini-omni-1.2-flash',
      aspectRatio,
      duration,
      resolution,
      mimeType,
      videoDataUrl: videoData ? `data:${mimeType};base64,${videoData}` : undefined,
      videoUri,
    });
  } catch (err) {
    res.status(503).json({ error: formatAiErrorMessage(err) });
  }
});

app.get('/api/export/windows-python-bundle', async (_req: Request, res: Response) => {
  if (!isPermissionGranted('workspace.export')) {
    res.status(403).json({ error: 'Workspace export permission is disabled in Security Center.' });
    return;
  }
  const zipBuf = await generateWindowsPythonBundleZip();
  logAudit('python_bundle_exported', 'user', 'REMY-THE-GRIVER-PRO-Windows-Desktop.zip', 'allowed', `${zipBuf.length} bytes`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="REMY-THE-GRIVER-PRO-Windows-Desktop.zip"');
  res.send(zipBuf);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`REMY THE GRIVER PRO server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
