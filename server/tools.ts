import os from 'node:os';
import vm from 'node:vm';
import { isPermissionGranted, logAudit, validateSafeUrl } from './security.ts';

let previousCpuInfo = os.cpus();

function sampleCpuPercent(): number {
  const current = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i++) {
    const prev = previousCpuInfo[i] ?? current[i];
    const curr = current[i];
    const prevTotal = Object.values(prev.times).reduce((a, b) => a + b, 0);
    const currTotal = Object.values(curr.times).reduce((a, b) => a + b, 0);
    idleDelta += curr.times.idle - prev.times.idle;
    totalDelta += currTotal - prevTotal;
  }
  previousCpuInfo = current;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
}

export function getSystemTelemetry() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuPercent = sampleCpuPercent();
  const procMem = process.memoryUsage();

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: cpus[0]?.model ?? 'Unknown CPU',
    cpuCores: cpus.length,
    cpuUsagePercent: cpuPercent,
    ramTotalGb: Math.round((totalMem / 1024 ** 3) * 100) / 100,
    ramUsedGb: Math.round((usedMem / 1024 ** 3) * 100) / 100,
    ramUsagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
    processRssMb: Math.round((procMem.rss / 1024 ** 2) * 10) / 10,
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
    serverTimeIso: new Date().toISOString(),
  };
}

export async function fetchOpenMeteoWeather(city = 'Kigali'): Promise<{
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPercent: number;
  windSpeedKmh: number;
  weatherCode: number;
  condition: string;
  daily: Array<{ date: string; maxC: number; minC: number; code: number }>;
}> {
  let lat = -1.9441;
  let lon = 30.0619;
  let resolvedCity = 'Kigali';
  let country = 'Rwanda';

  if (city.trim().toLowerCase() !== 'kigali') {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    if (!geoRes.ok) throw new Error(`Geocoding failed (${geoRes.status})`);
    const geoData = (await geoRes.json()) as {
      results?: Array<{ name: string; country: string; latitude: number; longitude: number }>;
    };
    if (!geoData.results || geoData.results.length === 0) {
      throw new Error(`City not found: ${city}`);
    }
    lat = geoData.results[0].latitude;
    lon = geoData.results[0].longitude;
    resolvedCity = geoData.results[0].name;
    country = geoData.results[0].country;
  }

  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;

  const wRes = await fetch(weatherUrl);
  if (!wRes.ok) throw new Error(`Open-Meteo request failed (${wRes.status})`);
  const wData = (await wRes.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      apparent_temperature: number;
      weather_code: number;
      wind_speed_10m: number;
    };
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weather_code: number[];
    };
  };

  return {
    city: resolvedCity,
    country,
    latitude: lat,
    longitude: lon,
    temperatureC: wData.current.temperature_2m,
    apparentTemperatureC: wData.current.apparent_temperature,
    humidityPercent: wData.current.relative_humidity_2m,
    windSpeedKmh: wData.current.wind_speed_10m,
    weatherCode: wData.current.weather_code,
    condition: describeWmoCode(wData.current.weather_code),
    daily: wData.daily.time.map((date, idx) => ({
      date,
      maxC: wData.daily.temperature_2m_max[idx],
      minC: wData.daily.temperature_2m_min[idx],
      code: wData.daily.weather_code[idx],
    })),
  };
}

function describeWmoCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Variable conditions';
}

export async function fetchLiveCurrencyRates(base = 'USD'): Promise<{
  base: string;
  updatedAt: string;
  rates: Record<string, number>;
}> {
  const cleanBase = base.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'USD';
  const res = await fetch(`https://open.er-api.com/v6/latest/${cleanBase}`);
  if (!res.ok) throw new Error(`Currency API error (${res.status})`);
  const data = (await res.json()) as {
    result: string;
    base_code: string;
    time_last_update_utc: string;
    rates: Record<string, number>;
  };
  if (data.result !== 'success') throw new Error('Currency provider returned unsuccessful status');
  return {
    base: data.base_code,
    updatedAt: data.time_last_update_utc,
    rates: data.rates,
  };
}

export function runSandboxedJavascript(code: string): {
  allowed: boolean;
  output: string;
  result?: string;
  error?: string;
  durationMs: number;
} {
  const start = Date.now();
  if (!isPermissionGranted('studio.vm_exec')) {
    logAudit('sandbox_exec_blocked', 'security_gatekeeper', 'studio.vm_exec', 'denied', 'Permission disabled by user');
    return {
      allowed: false,
      output: '',
      error: 'Execution blocked by Security Gatekeeper: studio.vm_exec permission is disabled.',
      durationMs: Date.now() - start,
    };
  }

  const logs: string[] = [];
  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
      warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push('[error] ' + args.map(String).join(' ')),
    },
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: 'sandbox-studio.js' });
    const evalResult = script.runInContext(context, { timeout: 1000 });
    logAudit('sandbox_exec', 'developer_studio', 'studio.vm_exec', 'allowed', `Executed ${code.length} chars in isolated VM`);
    return {
      allowed: true,
      output: logs.join('\n'),
      result: evalResult !== undefined ? (typeof evalResult === 'object' ? JSON.stringify(evalResult, null, 2) : String(evalResult)) : undefined,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    logAudit('sandbox_exec_error', 'developer_studio', 'studio.vm_exec', 'info', err instanceof Error ? err.message : 'Error');
    return {
      allowed: true,
      output: logs.join('\n'),
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function analyzeGithubRepository(repoInput: string): Promise<{
  owner: string;
  repo: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  defaultBranch: string;
  htmlUrl: string;
  files: Array<{ path: string; type: string; size?: number }>;
  readmeSnippet: string;
}> {
  let cleanPath = repoInput.trim();
  if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
    const check = validateSafeUrl(cleanPath);
    if (!check.safe || !check.url) throw new Error(check.reason || 'Invalid GitHub URL');
    if (check.url.hostname !== 'github.com' && check.url.hostname !== 'www.github.com') {
      throw new Error('Only github.com repository URLs are accepted');
    }
    cleanPath = check.url.pathname.replace(/^\/+|\/+$/g, '');
  }

  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Provide a repository as "owner/repo" or "https://github.com/owner/repo"');
  }
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'remy-the-griver-pro',
  };

  const repoRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
  if (!repoRes.ok) {
    throw new Error(`GitHub repository lookup failed (${repoRes.status}): ${owner}/${repo}`);
  }
  const repoJson = (await repoRes.json()) as {
    full_name: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    default_branch: string;
    html_url: string;
  };

  const contentsRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
    { headers }
  );
  const contentsJson = contentsRes.ok
    ? ((await contentsRes.json()) as Array<{ path: string; type: string; size?: number }>)
    : [];

  let readmeSnippet = '';
  const readmeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
    { headers }
  );
  if (readmeRes.ok) {
    const readmeJson = (await readmeRes.json()) as { content?: string; encoding?: string };
    if (readmeJson.content && readmeJson.encoding === 'base64') {
      readmeSnippet = Buffer.from(readmeJson.content, 'base64').toString('utf8').slice(0, 1800);
    }
  }

  logAudit('github_repo_analyzed', 'developer_studio', `${owner}/${repo}`, 'allowed', 'Fetched public repository metadata');

  return {
    owner,
    repo,
    fullName: repoJson.full_name,
    description: repoJson.description,
    stars: repoJson.stargazers_count,
    forks: repoJson.forks_count,
    language: repoJson.language,
    defaultBranch: repoJson.default_branch,
    htmlUrl: repoJson.html_url,
    files: Array.isArray(contentsJson)
      ? contentsJson.slice(0, 40).map((f) => ({ path: f.path, type: f.type, size: f.size }))
      : [],
    readmeSnippet,
  };
}
