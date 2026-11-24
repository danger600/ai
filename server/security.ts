import path from 'node:path';
import { db } from './db.ts';

export function maskSecrets(input: string): string {
  if (!input) return input;
  return input
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, 'AIza••••••••MASKED')
    .replace(/sk-[0-9A-Za-z\-_]{20,}/g, 'sk-••••••••MASKED')
    .replace(/ghp_[0-9A-Za-z]{20,}/g, 'ghp_••••••••MASKED')
    .replace(/Bearer\s+[0-9A-Za-z\-_.]{12,}/gi, 'Bearer ••••••••MASKED');
}

export function logAudit(
  action: string,
  actor: string,
  target: string,
  decision: 'allowed' | 'denied' | 'info',
  details = ''
): void {
  db.prepare(`
    INSERT INTO audit_logs (action, actor, target, decision, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, actor, maskSecrets(target), decision, maskSecrets(details));
}

export function isPermissionGranted(scope: string): boolean {
  const row = db.prepare('SELECT granted FROM permissions WHERE scope = ?').get(scope) as
    | { granted: number }
    | undefined;
  return row?.granted === 1;
}

export function isSettingEnabled(key: string): boolean {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value === 'true';
}

export function validateSafePath(baseDir: string, userPath: string): { safe: boolean; resolved: string; reason?: string } {
  if (!userPath || userPath.includes('\0')) {
    return { safe: false, resolved: '', reason: 'Null byte or empty path rejected' };
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, userPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    logAudit('path_traversal_blocked', 'security_gatekeeper', userPath, 'denied', 'Attempted escape outside approved directory');
    return { safe: false, resolved: '', reason: 'Path traversal attempt blocked' };
  }
  return { safe: true, resolved: resolvedTarget };
}

export function validateSafeUrl(rawUrl: string): { safe: boolean; url?: URL; reason?: string } {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { safe: false, reason: 'Only HTTP/HTTPS URLs are permitted' };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      logAudit('ssrf_url_blocked', 'security_gatekeeper', rawUrl, 'denied', 'Private or loopback network host blocked');
      return { safe: false, reason: 'Private/loopback hosts are blocked by security policy' };
    }
    return { safe: true, url: parsed };
  } catch {
    return { safe: false, reason: 'Invalid URL syntax' };
  }
}

export function sanitizeFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}
