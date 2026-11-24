import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { db } from './db.ts';
import { searchLocalChunks } from './documents.ts';
import { isPermissionGranted, logAudit } from './security.ts';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  keywords: string[];
  sensitiveScopes: string[];
}

export const AGENTS: AgentDefinition[] = [
  {
    id: 'main',
    name: 'Main Assistant Agent',
    role: 'Primary Orchestrator',
    description: 'General knowledge, step-by-step tutorials, multilingual assistance (EN/RW/FR/SW), and cross-domain reasoning.',
    systemPrompt:
      'You are REMY THE GRIVER PRO, the personal AI assistant of Remy Nsanzimana (BULL MAN). Give direct, comprehensive, well-structured, step-by-step answers to every general or technical question. Use clear Markdown headings, numbered steps, examples, and practical advice. Never fabricate citations, files, or test results.',
    keywords: ['hello', 'help', 'explain', 'summarize', 'translate', 'how', 'what', 'why', 'guide', 'step'],
    sensitiveScopes: [],
  },
  {
    id: 'engineering',
    name: 'Software Engineering Agent',
    role: 'Code & Architecture Specialist',
    description: 'Python, JavaScript, React, Node.js, Express, MySQL, MongoDB, SQL, debugging, and unit tests.',
    systemPrompt:
      'You are the Software Engineering Agent inside REMY THE GRIVER PRO. Provide thorough, production-grade TypeScript, JavaScript, React, Node.js, SQL, and Python engineering solutions, step-by-step implementations, debugging, and unit tests. Never suggest running destructive shell commands without user confirmation.',
    keywords: ['code', 'python', 'javascript', 'react', 'node', 'sql', 'bug', 'error', 'debug', 'refactor', 'test', 'api', 'database', 'github'],
    sensitiveScopes: ['studio.vm_exec'],
  },
  {
    id: 'research',
    name: 'Research Agent',
    role: 'Verified Web Synthesis',
    description: 'Live web research, source comparison, and separating verified facts from inference.',
    systemPrompt:
      'You are the Research Agent. Provide deep, structured analysis separating verified source facts from analytical conclusions. Never invent URLs or citations.',
    keywords: ['research', 'search', 'latest', 'news', 'compare', 'source', 'web', 'citation'],
    sensitiveScopes: ['research.web_search'],
  },
  {
    id: 'documents',
    name: 'Document Analysis Agent',
    role: 'Local RAG & Extraction',
    description: 'Analyzes uploaded PDF, DOCX, XLSX, CSV, Markdown, and source files with page/row citations.',
    systemPrompt:
      'You are the Document Analysis Agent. Ground every answer in the supplied document chunks and explicitly reference the filename and page/row citation.',
    keywords: ['document', 'pdf', 'docx', 'csv', 'xlsx', 'file', 'chunk', 'extract', 'report'],
    sensitiveScopes: [],
  },
  {
    id: 'career',
    name: 'Career & CV Agent',
    role: 'Private Career Strategist',
    description: 'CV review, job comparison, cover letters, and interview prep using only verified profile facts.',
    systemPrompt:
      'You are the Career and CV Agent for Remy Nsanzimana. Never invent employment history, internship duties, academic grades, certificates, or awards. Only work with verified facts provided by the user.',
    keywords: ['cv', 'resume', 'career', 'job', 'interview', 'cover letter', 'portfolio', 'skills', 'internship'],
    sensitiveScopes: ['cv.external_ai'],
  },
  {
    id: 'productivity',
    name: 'Productivity Agent',
    role: 'Planning & Execution',
    description: 'Task prioritization, daily planning, project tracking (KIVUMU SMART CAMPUS, UBUBIKO SMART), and notes.',
    systemPrompt:
      'You are the Productivity Agent. Help structure actionable tasks, realistic schedules, and weekly engineering progress reports.',
    keywords: ['task', 'todo', 'plan', 'schedule', 'reminder', 'note', 'project', 'productivity', 'deadline'],
    sensitiveScopes: [],
  },
  {
    id: 'system',
    name: 'System Assistant Agent',
    role: 'Telemetry & Diagnostics',
    description: 'Interprets CPU, RAM, storage, SQLite health, and local/cloud provider diagnostics.',
    systemPrompt:
      'You are the System Assistant Agent. Diagnose system resource health, database integrity, and provider connectivity accurately.',
    keywords: ['cpu', 'ram', 'memory', 'disk', 'system', 'health', 'ollama', 'sqlite', 'diagnostic'],
    sensitiveScopes: [],
  },
  {
    id: 'education',
    name: 'Learning & Education Agent',
    role: 'Structured Tutor',
    description: 'Step-by-step explanations, study plans, and software development fundamentals.',
    systemPrompt:
      'You are the Learning and Education Agent. Teach general topics, software engineering, algorithms, media creation, databases, and blockchain fundamentals step by step with clear examples and exercises.',
    keywords: ['learn', 'study', 'teach', 'tutorial', 'concept', 'fundamentals', 'blockchain', 'exercise'],
    sensitiveScopes: [],
  },
  {
    id: 'security',
    name: 'Security Review Agent',
    role: 'AppSec & Gatekeeper Auditor',
    description: 'Audits code and workflows for path traversal, injection, secret leaks, and least-privilege controls.',
    systemPrompt:
      'You are the Security Review Agent. Audit code, permissions, URLs, and input validation rigorously. Flag insecure patterns and enforce least privilege.',
    keywords: ['security', 'vulnerability', 'audit', 'xss', 'sql injection', 'traversal', 'permission', 'secret', 'encrypt'],
    sensitiveScopes: [],
  },
  {
    id: 'planning',
    name: 'Project Planning Agent',
    role: 'Architecture & Milestones',
    description: 'Breaks complex software builds into phases, milestones, schemas, and risk checklists.',
    systemPrompt:
      'You are the Project Planning Agent. Break initiatives into concrete milestones, database models, API contracts, and verification tests.',
    keywords: ['architecture', 'roadmap', 'milestone', 'phase', 'plan', 'design', 'schema', 'spec'],
    sensitiveScopes: [],
  },
];

export function routeAgent(prompt: string, explicitAgentId?: string): {
  agent: AgentDefinition;
  autoRouted: boolean;
  reason: string;
} {
  if (explicitAgentId && explicitAgentId !== 'auto') {
    const found = AGENTS.find((a) => a.id === explicitAgentId);
    if (found) {
      return { agent: found, autoRouted: false, reason: `Selected by user: ${found.name}` };
    }
  }
  const lower = prompt.toLowerCase();
  let bestAgent = AGENTS[0];
  let bestScore = 0;
  let matchedWord = '';

  for (const agent of AGENTS) {
    if (agent.id === 'main') continue;
    let score = 0;
    let firstMatch = '';
    for (const kw of agent.keywords) {
      if (lower.includes(kw)) {
        score += 1;
        if (!firstMatch) firstMatch = kw;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
      matchedWord = firstMatch;
    }
  }

  return {
    agent: bestAgent,
    autoRouted: true,
    reason: bestScore > 0 ? `Intent matched "${matchedWord}" -> ${bestAgent.name}` : 'Defaulted to Main Assistant Agent',
  };
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export const SUPPORTED_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-carbon',
  'gemini-4-neon',
] as const;

const FALLBACK_MODEL_CHAIN: Record<string, string[]> = {
  'gemini-4-hydrogen': ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
  'gemini-3.1-flash-lite': ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
  'gemini-4-carbon': ['gemini-4-carbon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
  'gemini-4-neon': ['gemini-4-neon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
};

export function sanitizeModelName(model?: string): string {
  if (model && (SUPPORTED_MODELS as readonly string[]).includes(model)) {
    return model;
  }
  return 'gemini-4-hydrogen';
}

export function getChatThinkingLevel(model: string): ThinkingLevel {
  if (model === 'gemini-3.1-flash-lite') return ThinkingLevel.MINIMAL;
  if (model === 'gemini-4-carbon') return ThinkingLevel.MEDIUM;
  return ThinkingLevel.LOW;
}

export function formatAiErrorMessage(err: unknown): string {
  let raw = err instanceof Error ? err.message : String(err ?? 'Unknown AI provider error');

  for (let depth = 0; depth < 3; depth += 1) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as {
          error?: { code?: number; message?: string; status?: string };
          message?: string;
        };
        if (parsed.error?.message) {
          raw = parsed.error.message;
          continue;
        }
        if (parsed.message) {
          raw = parsed.message;
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }

  if (raw.includes('TIMEOUT_2S') || raw.toLowerCase().includes('timed out')) {
    return 'Cloud AI response timed out; delivered comprehensive local knowledge response.';
  }
  if (raw.includes('503') || raw.toUpperCase().includes('UNAVAILABLE') || raw.toLowerCase().includes('high demand')) {
    return 'Cloud AI model is temporarily experiencing high demand (503 Service Unavailable). Delivered local knowledge response.';
  }
  if (raw.includes('429') || raw.toUpperCase().includes('RESOURCE_EXHAUSTED')) {
    return 'Cloud AI rate limit reached (429). Delivered local knowledge response.';
  }
  if (raw.includes('401') || raw.includes('403') || raw.toLowerCase().includes('api key')) {
    return 'Cloud AI authentication error. Verify GEMINI_API_KEY configuration.';
  }
  return raw;
}

export function isRetryableProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('TIMEOUT_2S') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.toLowerCase().includes('high demand') ||
    msg.toLowerCase().includes('timed out') ||
    msg.toLowerCase().includes('fetch')
  );
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage = 'TIMEOUT_2S'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkOllamaAvailability(endpointUrl?: string): Promise<{
  available: boolean;
  endpoint: string;
  models: string[];
  error?: string;
}> {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'ollama_url'").get() as { value: string } | undefined;
  const endpoint = (endpointUrl || row?.value || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { available: false, endpoint, models: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return {
      available: true,
      endpoint,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch (err) {
    return {
      available: false,
      endpoint,
      models: [],
      error: err instanceof Error ? err.message : 'Local Ollama daemon not reachable',
    };
  }
}

export async function withExponentialBackoff<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableProviderError(err) || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 150 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
      attempt += 1;
    }
  }
  throw lastError;
}

export async function executeWithModelFallback<T>(
  primaryModel: string,
  runner: (candidateModel: string, remainingMs: number) => Promise<T>,
  totalFirstReplyBudgetMs = 20000
): Promise<{ result: T; modelUsed: string; fallbackUsed: boolean }> {
  const cleanPrimary = sanitizeModelName(primaryModel);
  const candidates = FALLBACK_MODEL_CHAIN[cleanPrimary] ?? [cleanPrimary, 'gemini-3.1-flash-lite'];
  const deadline = Date.now() + totalFirstReplyBudgetMs;
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const remaining = deadline - Date.now();
    if (remaining <= 150) {
      throw lastError ?? new Error('TIMEOUT_2S: Exceeded AI response budget');
    }
    const sliceMs = i === 0 && candidates.length > 1 ? Math.min(remaining, Math.max(950, Math.floor(remaining * 0.6))) : remaining;
    try {
      const result = await runner(candidate, sliceMs);
      return { result, modelUsed: candidate, fallbackUsed: i > 0 };
    } catch (err) {
      lastError = err;
      if (!isRetryableProviderError(err)) {
        throw err;
      }
      logAudit('ai_model_fallback', 'ai_engine', candidate, 'info', `Fast switch from ${candidate}: ${formatAiErrorMessage(err)}`);
    }
  }
  throw lastError;
}

export function buildContextAugmentation(options: {
  prompt?: string;
  language: string;
  includeMemory: boolean;
  includeCv: boolean;
  docContextText?: string;
}): {
  contextBlock: string;
  cvBlockedByPolicy: boolean;
  memoriesUsed: Array<{ title: string; content: string; category: string }>;
  cvIncluded: boolean;
  cvRawText: string | null;
  globalRagMatches: Array<{ filename: string; pageOrRow: string; excerpt: string }>;
} {
  const parts: string[] = [];
  let cvBlockedByPolicy = false;
  let memoriesUsed: Array<{ title: string; content: string; category: string }> = [];
  let cvIncluded = false;
  let cvRawText: string | null = null;
  const globalRagMatches: Array<{ filename: string; pageOrRow: string; excerpt: string }> = [];

  const langMap: Record<string, string> = {
    en: 'English',
    rw: 'Kinyarwanda (clear, natural Kinyarwanda)',
    fr: 'French (Français)',
    sw: 'Swahili (Kiswahili)',
  };
  parts.push(`Respond in language: ${langMap[options.language] ?? 'English'}.`);

  if (options.includeMemory) {
    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'memory_enabled'").get() as
      | { value: string }
      | undefined;
    if (!setting || setting.value === 'true') {
      const mems = db
        .prepare('SELECT title, content, category FROM memories WHERE approved = 1 AND enabled = 1 ORDER BY updated_at DESC LIMIT 12')
        .all() as Array<{ title: string; content: string; category: string }>;
      if (mems.length > 0) {
        memoriesUsed = mems;
        parts.push(
          'APPROVED LONG-TERM MEMORIES:\n' +
            mems.map((m) => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')
        );
      }
    }
  }

  if (options.includeCv) {
    if (isPermissionGranted('cv.external_ai')) {
      const cv = db.prepare("SELECT raw_text FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as
        | { raw_text: string }
        | undefined;
      if (cv) {
        cvIncluded = true;
        cvRawText = cv.raw_text;
        parts.push('USER-APPROVED PRIVATE CV PROFILE:\n' + cv.raw_text);
        logAudit('cv_transmitted_to_ai', 'user_action', 'remy-primary-cv', 'allowed', 'User explicitly authorized CV transmission');
      }
    } else {
      cvBlockedByPolicy = true;
      logAudit('cv_transmission_blocked', 'security_gatekeeper', 'remy-primary-cv', 'denied', 'CV external AI permission is locked');
    }
  }

  let combinedDocText = options.docContextText || '';
  if (!combinedDocText && options.prompt) {
    const matches = searchLocalChunks(options.prompt, undefined, 4);
    for (const m of matches) {
      combinedDocText += `[${m.filename} | ${m.pageOrRow}]\n${m.content}\n\n`;
      globalRagMatches.push({ filename: m.filename, pageOrRow: m.pageOrRow, excerpt: m.content.slice(0, 160) });
    }
  }

  if (combinedDocText) {
    parts.push('RETRIEVED LOCAL DOCUMENT CHUNKS:\n' + combinedDocText);
  }

  return { contextBlock: parts.join('\n\n'), cvBlockedByPolicy, memoriesUsed, cvIncluded, cvRawText, globalRagMatches };
}

interface GeneralKnowledgeTopic {
  id: string;
  keywords: string[];
  title: string;
  answerMarkdown: string;
}

const GENERAL_KNOWLEDGE_TOPICS: GeneralKnowledgeTopic[] = [
  {
    id: 'image_generation',
    keywords: ['generate image', 'create image', 'ai image', 'image step by step', 'text to image', 'make picture', 'draw image', 'illustration', 'stable diffusion', 'midjourney', 'dalle', 'imagen'],
    title: 'How to Generate an Image Step by Step (AI & Production Workflow)',
    answerMarkdown: `### Step-by-Step Guide: Generating High-Quality Images with AI

1. **Define Your Visual Goal & Subject**
   - Decide the **main subject** (person, product, architecture, landscape, UI concept).
   - Clarify the **purpose** (social post, app hero banner, diagram, concept art, thumbnail) so you pick the right aspect ratio (\`1:1\`, \`16:9\`, \`9:16\`, or \`4:3\`).

2. **Choose the Right Image Model / Tool**
   - **In REMY THE GRIVER PRO:** Open **Media Studio** in the left navigation bar and select **Image Generation** (\`gemini-3.1-flash-lite-image\`).
   - **Local / Open-Weight Alternative:** Use ComfyUI or Automatic1111 with **SDXL** or **FLUX.1** locally if you have an NVIDIA GPU (8GB+ VRAM).
   - **Code / API Integration:** Call the Gemini Interactions API server-side with \`model: "gemini-3.1-flash-lite-image"\` and \`response_modalities: ["image", "text"]\`.

3. **Write a Structured 5-Part Prompt**
   Use this reliable formula:
   \`[Subject & Action] + [Environment / Setting] + [Lighting & Mood] + [Art Style / Medium] + [Camera / Composition]\`
   - *Weak prompt:* \`"a developer at a desk"\`
   - *Strong prompt:* \`"A software engineer coding at a dark minimalist desk in Kigali, dual monitors with glowing blue dashboards, warm amber desk lamp contrast, photorealistic editorial photography, 35mm lens, shallow depth of field"\`

4. **Configure Output Parameters**
   - **Aspect Ratio:** \`1:1\` for avatars/icons, \`16:9\` for desktop banners/YouTube, \`9:16\` for mobile reels/stories.
   - **Clarity Constraints:** Describe what you *want* clearly (materials, colors, background simplicity) rather than overloading contradictory styles.

5. **Generate via Server-Side Code (TypeScript / Python Example)**
\`\`\`python
# Python example using google-genai SDK (server-side)
from google import genai

client = genai.Client()  # Reads GEMINI_API_KEY from environment
interaction = client.interactions.create(
    model="gemini-3.1-flash-lite-image",
    input="Minimalist gold bull emblem on matte obsidian background, crisp studio lighting",
    response_modalities=["image", "text"],
    generation_config={"image_config": {"aspect_ratio": "1:1", "image_size": "1K"}},
)
\`\`\`

6. **Review, Iterate, and Export**
   - Inspect hands, text rendering, lighting consistency, and framing.
   - Refine one variable at a time (e.g., change lighting or camera angle) or pass the output back as an **image-to-image edit prompt** (\`"Keep the subject, change the background to clean daylight studio"\`).
   - Export in **PNG** for lossless graphics/transparency or **WebP** for fast web loading.`,
  },
  {
    id: 'video_generation',
    keywords: ['generate video', 'create video', 'text to video', 'ai video', 'animate image', 'omni', 'video step by step'],
    title: 'How to Generate Video from Text Step by Step',
    answerMarkdown: `### Step-by-Step Guide: Generating AI Video from Text

1. **Plan Shot Composition & Motion**
   - Video prompts need **subject + action + camera movement + lighting + pacing** (e.g., *"Slow cinematic dolly-in on a futuristic robotics workshop at dusk, sparks flying softly, 4K realistic motion"*).
2. **Choose Aspect Ratio & Duration**
   - Use **\`16:9\` Landscape** for widescreen monitors, presentations, and YouTube.
   - Use **\`9:16\` Portrait** for mobile vertical feeds and shorts.
3. **Run Generation in REMY THE GRIVER PRO Media Studio**
   - Navigate to **Media Studio -> Video Generation (\`gemini-omni-1.2-flash\`)**.
   - Enter a clear scene prompt, choose \`16:9\` or \`9:16\`, and generate via the server-side Interactions API.
4. **Server-Side Interactions API Pattern**
\`\`\`ts
const interaction = await ai.interactions.create({
  model: 'gemini-omni-1.2-flash',
  input: 'Slow aerial drone glide over Kigali hills at sunrise, golden mist, realistic cinematography.',
  background: false,
  store: false,
  stream: false,
  response_format: { type: 'video', aspect_ratio: '16:9', duration: '8s', resolution: '720p' },
}, { timeout: 300000 });
\`\`\`
5. **Inspect & Download MP4**
   - Check temporal stability (no flickering subjects), verify aspect framing, and download the video asset for editing.`,
  },
  {
    id: 'python_programming',
    keywords: ['python', 'flask', 'fastapi', 'django', 'pandas', 'customtkinter', 'pip', 'venv', 'script'],
    title: 'Python Engineering & Best-Practice Workflow',
    answerMarkdown: `### Python Engineering Step-by-Step Guide

1. **Isolate Your Environment**
   - Always create a virtual environment: \`python -m venv .venv\` and activate it (\`.venv\\Scripts\\activate\` on Windows, \`source .venv/bin/activate\` on Linux/macOS).
2. **Structure Clean Modules**
   - Separate configuration, database layer, business logic, and UI/API routes. Use **type hints** (\`from __future__ import annotations\`, \`dataclasses\`, \`Path\` from \`pathlib\`).
3. **Write Safe, Testable Functions**
   - Parameterize SQL queries (\`cursor.execute("SELECT * FROM users WHERE id = ?", (uid,))\`), validate paths against traversal, and avoid \`shell=True\` in \`subprocess\`.
4. **Verify with Automated Tests**
   - Use \`unittest\` or \`pytest\`, run \`python -m compileall -q .\` for syntax validation, and test edge cases (empty inputs, timeouts, invalid permissions).`,
  },
  {
    id: 'web_fullstack',
    keywords: ['react', 'node', 'express', 'javascript', 'typescript', 'html', 'css', 'tailwind', 'frontend', 'backend', 'rest api', 'website'],
    title: 'Modern Full-Stack Web Development (React + Node/Express + SQL)',
    answerMarkdown: `### Full-Stack Web Architecture Guide

1. **Frontend Layer (React + TypeScript + Tailwind CSS)**
   - Break UI into focused functional components with strict TypeScript interfaces.
   - Manage async state cleanly with loading, error, and cancellation states (\`AbortController\`).
2. **Backend API Layer (Node.js + Express / Python FastAPI)**
   - Validate all incoming payloads before touching the database.
   - Return structured JSON errors and keep API keys strictly server-side in environment variables.
3. **Database & Persistence**
   - Use parameterized queries (SQLite, MySQL, PostgreSQL, or Supabase) with explicit foreign keys and migrations.
4. **Build, Lint & Smoke Test**
   - Run \`tsc --noEmit\`, \`npm run build\`, and automated API/unit tests before shipping.`,
  },
  {
    id: 'databases_sql',
    keywords: ['sql', 'mysql', 'sqlite', 'mongodb', 'supabase', 'database', 'schema', 'query', 'index', 'join', 'normalization'],
    title: 'Database Design & Query Optimization Guide',
    answerMarkdown: `### Database Design & SQL Best Practices

1. **Schema Modeling (1NF -> 3NF)**
   - Use primary keys on every table, enforce \`FOREIGN KEY\` constraints with \`ON DELETE CASCADE\` where appropriate, and avoid repeating comma-separated values inside one column.
2. **Indexing Strategy**
   - Add indexes on foreign keys, status filters, and high-frequency \`WHERE\` / \`ORDER BY\` columns.
3. **Safety & Reliability**
   - Never concatenate user strings into SQL queries—always use \`?\` / \`$1\` bind parameters.
   - Wrap multi-step writes inside explicit \`BEGIN ... COMMIT\` transactions and schedule regular backups.`,
  },
  {
    id: 'cybersecurity',
    keywords: ['security', 'hack', 'cybersecurity', 'password', 'encryption', 'xss', 'csrf', 'ssrf', 'sql injection', 'jwt', 'auth', 'privacy'],
    title: 'Cybersecurity & Application Hardening Checklist',
    answerMarkdown: `### Practical Security Engineering Checklist

1. **Input & Path Validation**
   - Reject path traversal (\`..\`), validate uploaded file types/sizes, and verify outbound URLs against private/loopback IP ranges (SSRF protection).
2. **Authentication & Secrets**
   - Store secrets in environment variables or OS credential managers—never hardcode keys in source code or logs; mask tokens in diagnostics.
3. **Least-Privilege Permissions**
   - Gate sensitive actions (file writes, shell commands, external data sharing) behind explicit user confirmation and audit logging.
4. **Injection Prevention**
   - Use parameterized SQL queries, escape HTML/Markdown outputs safely, and enforce Content Security / CORS rules.`,
  },
  {
    id: 'career_cv_study',
    keywords: ['career', 'job', 'interview', 'resume', 'cv', 'study', 'learn', 'roadmap', 'portfolio', 'internship', 'skill'],
    title: 'Career Growth, Portfolio & Technical Interview Framework',
    answerMarkdown: `### Actionable Career & Learning Roadmap

1. **Build Proof-of-Work Projects**
   - Ship 3–4 documented projects with real databases, clean READMEs, screenshots, and tests on GitHub.
2. **Tailor Your CV Honestly**
   - Highlight measurable technical skills, exact stack tools used, and verified project outcomes without exaggerating roles or credentials.
3. **Prepare for Interviews (3 Pillars)**
   - **Fundamentals:** Data structures, HTTP/REST, SQL joins, and debugging walkthroughs.
   - **Project Deep-Dive:** Explain architecture trade-offs, security checks, and how you fixed bugs.
   - **Problem Solving:** Think out loud, clarify edge cases first, write clean code, then test manually with sample inputs.`,
  },
  {
    id: 'ai_ml_rag',
    keywords: ['ai', 'machine learning', 'llm', 'rag', 'embedding', 'ollama', 'prompt', 'agent', 'neural', 'chatbot', 'gemini', 'gpt'],
    title: 'AI Engineering, Prompting & Local RAG Architecture',
    answerMarkdown: `### How Modern AI Assistants & RAG Systems Work

1. **Prompt & System Design**
   - Combine clear role instructions, explicit output formatting, and strict truthfulness constraints.
2. **Retrieval-Augmented Generation (RAG)**
   - Parse files locally (PDF, DOCX, CSV, Markdown) -> split into overlapping chunks with page/row metadata -> retrieve top matching chunks -> pass only grounded excerpts to the model with citations.
3. **Hybrid Cloud + Local Execution**
   - Route fast interactive tasks to low-latency cloud models when online, and fall back gracefully to local Ollama models (\`llama3\`, \`mistral\`) or offline context search when disconnected.`,
  },
  {
    id: 'math_finance_productivity',
    keywords: ['math', 'calculate', 'budget', 'money', 'finance', 'business', 'startup', 'plan', 'productivity', 'time', 'focus', 'physics', 'science', 'biology', 'history'],
    title: 'Structured General Problem-Solving & Analytical Guide',
    answerMarkdown: `### Structured Analytical Framework

1. **Clarify the Goal & Constraints**
   - Break the problem into known facts, unknowns, and measurable targets (time, budget, accuracy, or resources).
2. **Apply First Principles**
   - Identify the core cause or formula driving the outcome instead of guessing from surface symptoms.
3. **Execute in Small Verifiable Steps**
   - Start with the highest-impact 20% action, measure the result, and refine based on real feedback.
4. **Track & Document**
   - Keep concise notes, milestones, and review checkpoints so progress compounds week over week.`,
  },
];

export function generateGeneralKnowledgeAnswer(prompt: string, language = 'en'): string {
  const cleanPrompt = prompt.trim();
  const lower = cleanPrompt.toLowerCase();

  let bestTopic: GeneralKnowledgeTopic | null = null;
  let bestScore = 0;

  for (const topic of GENERAL_KNOWLEDGE_TOPICS) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (lower.includes(kw)) {
        score += kw.includes(' ') ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  const langHeaderMap: Record<string, string> = {
    en: '',
    fr: '> *Mode langue : Français — Synthèse structurée ci-dessous.*\n\n',
    rw: '> *Ururimi: Ikinyarwanda — Sobanukirwa intambwe ku ntambwe hasi aha.*\n\n',
    sw: '> *Lugha: Kiswahili — Mwongozo wa hatua kwa hatua hapa chini.*\n\n',
  };
  const langPrefix = langHeaderMap[language] ?? '';

  if (bestTopic) {
    return `${langPrefix}${bestTopic.answerMarkdown}`;
  }

  // Dynamic general-purpose structured answer for any arbitrary question
  const keywords = cleanPrompt
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
  const topicLabel = keywords.length > 0 ? keywords.join(', ') : cleanPrompt.slice(0, 60);

  return `${langPrefix}### Direct Step-by-Step Answer: ${cleanPrompt}

1. **Core Concept & Objective**
   - Your question focuses on **${topicLabel}**. The fastest way to get reliable results is to break the task into requirements, execution steps, and verification checks.

2. **Step-by-Step Execution Plan**
   - **Step 1 — Define Inputs & Scope:** Identify exact inputs, tools, and constraints needed before starting.
   - **Step 2 — Prepare Tools / Environment:** Ensure required software, references, or source files are ready and backed up.
   - **Step 3 — Execute Incrementally:** Complete one concrete part at a time and test/inspect immediately rather than doing everything in one pass.
   - **Step 4 — Validate Outcome:** Verify accuracy, completeness, and edge cases against your original goal.

3. **Practical Tips & Common Pitfalls**
   - Keep instructions specific and measurable rather than broad.
   - Save intermediate versions so you can roll back cleanly if an experiment fails.
   - If you want deeper code, math, writing, or domain examples for **"${cleanPrompt.slice(0, 80)}"**, specify your target format (tutorial, code snippet, checklist, or comparison table).`;
}

export function buildLocalFallbackReply(params: {
  prompt: string;
  agentName: string;
  memoriesUsed: Array<{ title: string; content: string; category: string }>;
  cvIncluded: boolean;
  cvRawText: string | null;
  cvBlockedByPolicy: boolean;
  citations: Array<{ filename: string; pageOrRow: string; excerpt: string }>;
  reason: string;
  language?: string;
}): string {
  const generalAnswer = generateGeneralKnowledgeAnswer(params.prompt, params.language ?? 'en');
  const lines: string[] = [
    generalAnswer,
    '',
    '---',
    `> **Assistant Engine Note (${params.agentName}):** ${params.reason}`,
    '',
  ];

  if (params.memoriesUsed.length > 0) {
    lines.push('### Memory Vault Context Applied');
    for (const m of params.memoriesUsed) {
      lines.push(`- **${m.title}** (*${m.category}*): ${m.content}`);
    }
    lines.push('');
  }

  if (params.cvBlockedByPolicy) {
    lines.push('### Private CV Gatekeeper Notice');
    lines.push('- **CV External AI is currently LOCKED** (`cv.external_ai = denied`). Unlock it in **CV & Career Hub** or **Security Center** to include private CV data in AI prompts.');
    lines.push('');
  } else if (params.cvIncluded && params.cvRawText) {
    lines.push('### Permission-Gated CV Profile (Authorized Locally)');
    lines.push('```text');
    lines.push(params.cvRawText.trim());
    lines.push('```');
    lines.push('');
  }

  if (params.citations.length > 0) {
    lines.push('### Matching Local Document Excerpts');
    for (const c of params.citations) {
      lines.push(`- **[${c.filename} | ${c.pageOrRow}]**: ${c.excerpt}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
