import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildContextAugmentation,
  buildLocalFallbackReply,
  executeWithModelFallback,
  formatAiErrorMessage,
  routeAgent,
  withTimeout,
} from '../server/ai.ts';
import { db, getDatabaseHealth, initDatabase } from '../server/db.ts';
import { parseUploadedDocument } from '../server/documents.ts';
import { isSettingEnabled, maskSecrets, validateSafePath, validateSafeUrl } from '../server/security.ts';
import { runSandboxedJavascript } from '../server/tools.ts';

test('database initializes with foreign keys and integrity ok', () => {
  initDatabase();
  const health = getDatabaseHealth();
  assert.equal(health.integrity, 'ok');
  const cv = db.prepare("SELECT full_name, private_locked FROM cv_profiles WHERE id = 'remy-primary-cv'").get() as {
    full_name: string;
    private_locked: number;
  };
  assert.equal(cv.full_name, 'Remy Nsanzimana');
  assert.equal(cv.private_locked, 1);
  assert.equal(isSettingEnabled('hide_private_features'), false);
  assert.equal(isSettingEnabled('strict_local_mode'), false);
});

test('security gatekeeper blocks path traversal and loopback SSRF', () => {
  const base = path.resolve(process.cwd(), 'storage', 'documents');
  const blocked = validateSafePath(base, '../../etc/passwd');
  assert.equal(blocked.safe, false);

  const allowed = validateSafePath(base, 'sample_report.txt');
  assert.equal(allowed.safe, true);

  const badUrl = validateSafeUrl('http://127.0.0.1:8080/internal');
  assert.equal(badUrl.safe, false);

  const goodUrl = validateSafeUrl('https://github.com/danger600');
  assert.equal(goodUrl.safe, true);
});

test('secret masking redacts API keys and bearer tokens', () => {
  const masked = maskSecrets('key=sk-abcdef1234567890abcdef1234567890 Bearer tok_1234567890abcdef');
  assert.ok(!masked.includes('abcdef1234567890'));
  assert.ok(masked.includes('MASKED'));
});

test('multi-agent orchestrator routes engineering and career intents accurately', () => {
  const eng = routeAgent('Debug this Python SQL database query');
  assert.equal(eng.agent.id, 'engineering');

  const cv = routeAgent('Compare my CV against this job description');
  assert.equal(cv.agent.id, 'career');
});

test('document parser extracts chunks with line metadata', async () => {
  const sample = Buffer.from('# Architecture\nLine 1\nLine 2\n', 'utf8');
  const parsed = await parseUploadedDocument(sample, 'arch.md', 'text/markdown');
  assert.ok(parsed.chunks.length >= 1);
  assert.ok(parsed.rawText.includes('Architecture'));
});

test('isolated VM sandbox runs pure JS and blocks filesystem access', () => {
  const ok = runSandboxedJavascript('const x = 6 * 7; console.log(x); x;');
  assert.equal(ok.allowed, true);
  assert.equal(ok.result, '42');

  const blockedFs = runSandboxedJavascript('require("fs").readFileSync("/etc/passwd")');
  assert.ok(blockedFs.error && blockedFs.error.includes('require is not defined'));
});

test('nested Gemini 503 error JSON unwraps cleanly and global CV/Memory augmentation enforces policy', () => {
  initDatabase();
  const nested503 = JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          code: 503,
          message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.',
          status: 'UNAVAILABLE',
        },
      }),
      code: 503,
      status: 'Service Unavailable',
    },
  });
  const formatted = formatAiErrorMessage(new Error(nested503));
  assert.ok(!formatted.startsWith('{'));
  assert.ok(formatted.includes('503 Service Unavailable'));

  const lockedCtx = buildContextAugmentation({
    prompt: 'Analyze my CV and memory vault',
    language: 'en',
    includeMemory: true,
    includeCv: true,
  });
  assert.equal(lockedCtx.cvBlockedByPolicy, true);
  assert.equal(lockedCtx.cvIncluded, false);

  const fallback = buildLocalFallbackReply({
    prompt: 'Analyze my CV',
    agentName: 'Career & CV Agent',
    memoriesUsed: lockedCtx.memoriesUsed,
    cvIncluded: lockedCtx.cvIncluded,
    cvRawText: lockedCtx.cvRawText,
    cvBlockedByPolicy: lockedCtx.cvBlockedByPolicy,
    citations: [],
    reason: formatted,
  });
  assert.ok(fallback.includes('CV External AI is currently LOCKED'));
});

test('executeWithModelFallback switches within 2s deadline when primary model stalls', async () => {
  const started = Date.now();
  const out = await executeWithModelFallback(
    'gemini-4-hydrogen',
    async (model, remainingMs) => {
      if (model === 'gemini-4-hydrogen') {
        return withTimeout(new Promise<string>((r) => setTimeout(() => r('too late'), 5000)), Math.min(remainingMs, 350), 'TIMEOUT_2S');
      }
      return `fast-reply-from-${model}`;
    },
    1500
  );
  const elapsed = Date.now() - started;
  assert.equal(out.fallbackUsed, true);
  assert.equal(out.modelUsed, 'gemini-3.1-flash-lite');
  assert.equal(out.result, 'fast-reply-from-gemini-3.1-flash-lite');
  assert.ok(elapsed < 1500, `Expected <1500ms, got ${elapsed}ms`);
});

test('general knowledge engine answers image generation and arbitrary queries step by step', () => {
  initDatabase();
  const ctx = buildContextAugmentation({
    prompt: 'how to generate image step by step',
    language: 'en',
    includeMemory: true,
    includeCv: false,
  });
  const reply = buildLocalFallbackReply({
    prompt: 'how to generate image step by step',
    agentName: 'Main Assistant Agent',
    memoriesUsed: ctx.memoriesUsed,
    cvIncluded: false,
    cvRawText: null,
    cvBlockedByPolicy: false,
    citations: [],
    reason: 'Instant guide',
    language: 'en',
  });
  assert.ok(reply.includes('Generating High-Quality Images with AI'));
  assert.ok(reply.includes('gemini-3.1-flash-lite-image'));
  assert.ok(reply.length > 600);
});

