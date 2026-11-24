import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const PYTHON_HOST = '127.0.0.1';
const PYTHON_PORT = Number(process.env.PYTHON_PORT || 3001);

let pythonProc: ChildProcess | null = null;

function startPythonBackend(): ChildProcess {
  const proc = spawn('python3', ['-u', path.resolve(process.cwd(), 'server.py'), '--host', PYTHON_HOST, '--port', String(PYTHON_PORT)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  proc.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.error(`Python backend exited unexpectedly (code=${code}, signal=${signal})`);
    }
  });
  return proc;
}

async function waitForPythonReady(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://${PYTHON_HOST}:${PYTHON_PORT}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timed out waiting for Python backend server.py to become healthy.');
}

function proxyToPython(req: Request, res: Response): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers['connection'];
  headers['host'] = `${PYTHON_HOST}:${PYTHON_PORT}`;

  const proxyReq = http.request(
    {
      hostname: PYTHON_HOST,
      port: PYTHON_PORT,
      path: req.originalUrl,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
        (res as unknown as { flushHeaders: () => void }).flushHeaders();
      }
      proxyRes.on('data', (chunk) => {
        if (!res.writableEnded) {
          res.write(chunk);
        }
      });
      proxyRes.on('end', () => {
        if (!res.writableEnded) res.end();
      });
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: `Python backend connection error: ${err.message}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  req.on('aborted', () => proxyReq.destroy());
  req.pipe(proxyReq);
}

async function startServer(): Promise<void> {
  pythonProc = startPythonBackend();
  await waitForPythonReady();

  const cleanup = () => {
    if (pythonProc && !pythonProc.killed) {
      pythonProc.kill('SIGTERM');
    }
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  const app = express();
  app.use('/api', proxyToPython);

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
    console.log(`REMY THE GRIVER PRO Vite host listening on http://0.0.0.0:${PORT} -> Python backend :${PYTHON_PORT}`);
  });
}

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
