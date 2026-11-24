import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function startTempPythonServer(port: number, tmpDir: string) {
  const dbPath = path.join(tmpDir, 'test_core.db');
  const proc = spawn('python3', ['-u', 'server.py', '--host', '127.0.0.1', '--port', String(port), '--db', dbPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return proc;
    } catch {
      // wait
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  proc.kill('SIGTERM');
  throw new Error('Python server.py did not start in time');
}

test('pure Python server.py passes health, telemetry, sandbox, CV privacy lock, and ZIP export end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remy-node-test-'));
  const port = 3456;
  const proc = await startTempPythonServer(port, tmpDir);

  try {
    const healthRes = await fetch(`http://127.0.0.1:${port}/api/health`);
    const health = (await healthRes.json()) as {
      ok: boolean;
      runtime: string;
      openaiResponsesUrl: string;
      dbHealth: { integrity: string };
    };
    assert.equal(health.ok, true);
    assert.ok(health.runtime.startsWith('Python '));
    assert.equal(health.openaiResponsesUrl, 'https://api.openai.com/v1/responses');
    assert.equal(health.dbHealth.integrity, 'ok');

    const cvRes = await fetch(`http://127.0.0.1:${port}/api/cv`);
    const cvData = (await cvRes.json()) as { externalAllowed: boolean; profile: { full_name: string } };
    assert.equal(cvData.profile.full_name, 'Remy Nsanzimana');
    assert.equal(cvData.externalAllowed, false);

    const sandboxOk = await fetch(`http://127.0.0.1:${port}/api/studio/run-python`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'print(6 * 7)' }),
    });
    const sandboxJson = (await sandboxOk.json()) as { allowed: boolean; output: string };
    assert.equal(sandboxJson.allowed, true);
    assert.equal(sandboxJson.output, '42');

    const sandboxBlocked = await fetch(`http://127.0.0.1:${port}/api/studio/run-python`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'import subprocess\nsubprocess.run(["ls"])' }),
    });
    const blockedJson = (await sandboxBlocked.json()) as { allowed: boolean; error?: string };
    assert.equal(blockedJson.allowed, false);
    assert.ok(blockedJson.error?.includes('Security Gatekeeper blocked'));

    const zipRes = await fetch(`http://127.0.0.1:${port}/api/export/windows-python-bundle`);
    assert.equal(zipRes.status, 200);
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());
    assert.ok(zipBuf.length > 50000);
    assert.equal(zipBuf.subarray(0, 2).toString('ascii'), 'PK');
  } finally {
    proc.kill('SIGTERM');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
