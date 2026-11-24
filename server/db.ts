import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const BACKUPS_DIR = path.join(STORAGE_DIR, 'backups');
const EXPORTS_DIR = path.join(STORAGE_DIR, 'exports');
const DOCUMENTS_DIR = path.join(STORAGE_DIR, 'documents');
const CV_DIR = path.join(STORAGE_DIR, 'cv');

for (const dir of [STORAGE_DIR, BACKUPS_DIR, EXPORTS_DIR, DOCUMENTS_DIR, CV_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const DB_PATH = path.join(STORAGE_DIR, 'remy_griver_pro.db');

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      education TEXT NOT NULL,
      location TEXT NOT NULL,
      github_url TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'main',
      model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
      language TEXT NOT NULL DEFAULT 'en',
      saved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      agent_id TEXT,
      model TEXT,
      tokens_used INTEGER DEFAULT 0,
      citations_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      approved INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      summary TEXT,
      local_only INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'indexed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_or_row TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      progress INTEGER NOT NULL DEFAULT 0,
      stack TEXT NOT NULL,
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS approved_folders (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL UNIQUE,
      access_level TEXT NOT NULL DEFAULT 'read',
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS approved_apps (
      id TEXT PRIMARY KEY,
      app_name TEXT NOT NULL UNIQUE,
      executable_path TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 1,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      target TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('allowed', 'denied', 'info')),
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      endpoint TEXT DEFAULT '',
      model_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cv_profiles (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      education TEXT NOT NULL,
      location TEXT NOT NULL,
      github_url TEXT NOT NULL,
      internship TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      projects_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      private_locked INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cv_versions (
      id TEXT PRIMARY KEY,
      cv_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      target_role TEXT DEFAULT '',
      raw_text TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cv_id) REFERENCES cv_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      approved INTEGER NOT NULL DEFAULT 0,
      last_run TEXT,
      last_status TEXT DEFAULT 'idle',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  seedInitialData();
}

function seedInitialData(): void {
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (userCount.c === 0) {
    db.prepare(`
      INSERT INTO users (full_name, brand_name, education, location, github_url, email)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'Remy Nsanzimana',
      'BULL MAN — THE BULL MAN ON TOP',
      'Level 5 Software Development, EAV KIVUMU TSS, Rwanda',
      'Kigali, Gasabo, Rwanda',
      'https://github.com/danger600',
      'remy@kivumusmart.local'
    );
  }

  const cvCount = db.prepare('SELECT COUNT(*) as c FROM cv_profiles').get() as { c: number };
  if (cvCount.c === 0) {
    const skills = [
      'HTML5',
      'CSS3',
      'JavaScript',
      'React.js',
      'Node.js',
      'Express.js',
      'MongoDB',
      'MySQL',
      'Supabase',
      'Git and GitHub',
      'Python',
      'REST APIs',
      'Database design',
      'Software development fundamentals',
      'Blockchain fundamentals',
    ];
    const projects = [
      {
        name: 'KIVUMU SMART CAMPUS',
        category: 'Education Technology',
        stack: ['React.js', 'Node.js', 'Database design'],
        status: 'Selected Project',
      },
      {
        name: 'UBUBIKO SMART',
        category: 'Smart Storage & Operations',
        stack: ['JavaScript', 'Express.js', 'MySQL'],
        status: 'Selected Project',
      },
      {
        name: 'EAV KIVUMU CLASS WEBSITE',
        category: 'Web Development',
        stack: ['HTML5', 'CSS3', 'JavaScript'],
        status: 'Selected Project',
      },
      {
        name: 'STUDENT REGISTRATION SYSTEM',
        category: 'Information Systems',
        stack: ['Database design', 'REST APIs', 'MySQL'],
        status: 'Selected Project',
      },
    ];
    const rawText = [
      'REMY NSANZIMANA',
      'Location: Kigali, Gasabo, Rwanda',
      'GitHub: https://github.com/danger600',
      'Education: Level 5 Software Development, EAV KIVUMU TSS, Rwanda',
      '',
      'TECHNICAL SKILLS & STUDY AREAS',
      skills.join(', '),
      '',
      'SELECTED PROJECTS',
      projects.map((p) => `- ${p.name} (${p.category})`).join('\n'),
      '',
      'INTERNSHIP',
      'ICT SMART SOLUTION, Kigali, Rwanda — April 2026',
    ].join('\n');

    db.prepare(`
      INSERT INTO cv_profiles (
        id, full_name, education, location, github_url, internship,
        skills_json, projects_json, summary, raw_text, private_locked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'remy-primary-cv',
      'Remy Nsanzimana',
      'Level 5 Software Development, EAV KIVUMU TSS, Rwanda',
      'Kigali, Gasabo, Rwanda',
      'https://github.com/danger600',
      'ICT SMART SOLUTION, Kigali, Rwanda (April 2026)',
      JSON.stringify(skills),
      JSON.stringify(projects),
      'Software Development student (Level 5, EAV KIVUMU TSS) based in Kigali, Gasabo, Rwanda, focused on full-stack web engineering, database systems, REST APIs, and Python AI tooling.',
      rawText,
      1
    );

    db.prepare(`
      INSERT INTO cv_versions (id, cv_id, version_label, target_role, raw_text, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'cv-v1',
      'remy-primary-cv',
      'v1.0 — Verified Baseline',
      'Junior Full-Stack / Python Software Developer',
      rawText,
      'Authentic source-of-truth profile. Private by default.'
    );
  }

  const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  if (projectCount.c === 0) {
    const insertProj = db.prepare(`
      INSERT INTO projects (id, name, description, status, progress, stack, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertProj.run(
      'proj-kivumu-campus',
      'KIVUMU SMART CAMPUS',
      'Campus operations and student digital workspace.',
      'active',
      78,
      'React.js · Node.js · Database Design',
      '2026-12-15'
    );
    insertProj.run(
      'proj-ububiko',
      'UBUBIKO SMART',
      'Structured inventory and smart storage management system.',
      'active',
      64,
      'Express.js · MySQL · REST APIs',
      '2026-12-20'
    );
    insertProj.run(
      'proj-griver',
      'REMY THE GRIVER PRO',
      'Personal AI assistant & career intelligence architecture.',
      'active',
      90,
      'Python · TypeScript · SQLite · Gemini',
      '2026-11-30'
    );

    const insertTask = db.prepare(`
      INSERT INTO tasks (id, project_id, title, description, priority, status, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run(
      'task-1',
      'proj-griver',
      'Verify SQLite backup & security audit rules',
      'Run integrity checks and verify permission gatekeeper policies.',
      'high',
      'in_progress',
      '2026-11-24'
    );
    insertTask.run(
      'task-2',
      'proj-kivumu-campus',
      'Prepare REST API schema documentation',
      'Document endpoints and database foreign-key relations.',
      'medium',
      'todo',
      '2026-11-28'
    );
    insertTask.run(
      'task-3',
      'proj-ububiko',
      'Review MySQL indexing on inventory queries',
      'Benchmark query performance and validate input constraints.',
      'medium',
      'done',
      '2026-11-22'
    );

    db.prepare(`
      INSERT INTO notes (id, title, content, category)
      VALUES (?, ?, ?, ?)
    `).run(
      'note-1',
      'Architecture Principles — Your Personal AI. Your Rules.',
      '1. Keep CV private unless explicit transmit approval is granted.\n2. Always validate paths and URLs through the central security gatekeeper.\n3. Never execute unapproved system commands.',
      'architecture'
    );
  }

  const permCount = db.prepare('SELECT COUNT(*) as c FROM permissions').get() as { c: number };
  if (permCount.c === 0) {
    const insertPerm = db.prepare(`
      INSERT INTO permissions (id, scope, description, granted)
      VALUES (?, ?, ?, ?)
    `);
    insertPerm.run('perm-cv-ai', 'cv.external_ai', 'Allow transmitting private CV text to external AI models when explicitly triggered', 0);
    insertPerm.run('perm-sandbox', 'studio.vm_exec', 'Allow isolated sandbox execution of JavaScript snippets', 1);
    insertPerm.run('perm-web', 'research.web_search', 'Allow live web search grounding requests', 1);
    insertPerm.run('perm-plugin', 'plugins.execute', 'Allow approved plugins to execute inside isolated context', 1);
    insertPerm.run('perm-fs', 'workspace.export', 'Allow exporting PDF/ZIP bundles to downloads', 1);
  }

  const folderCount = db.prepare('SELECT COUNT(*) as c FROM approved_folders').get() as { c: number };
  if (folderCount.c === 0) {
    const insertFolder = db.prepare(`
      INSERT INTO approved_folders (id, folder_path, access_level)
      VALUES (?, ?, ?)
    `);
    insertFolder.run('folder-docs', DOCUMENTS_DIR, 'read_write');
    insertFolder.run('folder-cv', CV_DIR, 'read_write');
    insertFolder.run('folder-backups', BACKUPS_DIR, 'read_write');
  }

  const appCount = db.prepare('SELECT COUNT(*) as c FROM approved_apps').get() as { c: number };
  if (appCount.c === 0) {
    const insertApp = db.prepare(`
      INSERT INTO approved_apps (id, app_name, executable_path, allowed)
      VALUES (?, ?, ?, ?)
    `);
    insertApp.run('app-vscode', 'Visual Studio Code', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 1);
    insertApp.run('app-git', 'Git for Windows', 'C:\\Program Files\\Git\\bin\\git.exe', 1);
    insertApp.run('app-python', 'Python 3.12', 'C:\\Python312\\python.exe', 1);
  }

  const providerCount = db.prepare('SELECT COUNT(*) as c FROM provider_configs').get() as { c: number };
  if (providerCount.c === 0) {
    const insertProvider = db.prepare(`
      INSERT INTO provider_configs (id, name, provider_type, endpoint, model_name, enabled, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertProvider.run('prov-gemini-hydrogen', 'Gemini 4 Hydrogen (Primary Cloud)', 'gemini', 'server-managed', 'gemini-4-hydrogen', 1, 1);
    insertProvider.run('prov-gemini-lite', 'Gemini 3.1 Flash Lite (Fast Cloud)', 'gemini', 'server-managed', 'gemini-3.1-flash-lite', 1, 2);
    insertProvider.run('prov-ollama-local', 'Ollama Local Fallback (Llama 3 / Mistral)', 'ollama', 'http://127.0.0.1:11434', 'llama3', 0, 3);
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM app_settings').get() as { c: number };
  if (settingsCount.c === 0) {
    const insertSetting = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`);
    insertSetting.run('theme', 'dark');
    insertSetting.run('language', 'en');
    insertSetting.run('memory_enabled', 'true');
    insertSetting.run('default_model', 'gemini-4-hydrogen');
    insertSetting.run('cloud_to_local_fallback', 'true');
    insertSetting.run('ollama_url', 'http://127.0.0.1:11434');
  }
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('hide_private_features', 'false')").run();
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('strict_local_mode', 'false')").run();

  const pluginCount = db.prepare('SELECT COUNT(*) as c FROM plugins').get() as { c: number };
  if (pluginCount.c === 0) {
    const insertPlugin = db.prepare(`
      INSERT INTO plugins (id, name, version, description, permissions_json, enabled, approved)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertPlugin.run(
      'plug-kigali-brief',
      'Kigali Daily Briefing',
      '1.0.0',
      'Aggregates Kigali weather, open tasks, and upcoming reminders into a morning brief.',
      JSON.stringify(['tasks.read', 'weather.read']),
      1,
      1
    );
    insertPlugin.run(
      'plug-code-complexity',
      'Code Complexity Inspector',
      '1.0.0',
      'Analyzes pasted JS/Python functions for cyclomatic branches, LOC, and comment ratio.',
      JSON.stringify(['studio.read']),
      1,
      1
    );
    insertPlugin.run(
      'plug-cv-keyword-audit',
      'ATS Keyword Auditor',
      '1.0.0',
      'Compares stored CV keywords locally against a target job posting without external calls.',
      JSON.stringify(['cv.read_local']),
      0,
      0
    );
  }

  const memCount = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
  if (memCount.c === 0) {
    const insertMem = db.prepare(`
      INSERT INTO memories (id, title, content, category, approved, enabled, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertMem.run(
      'mem-1',
      'Preferred Stack & Architecture',
      'Remy builds full-stack projects with React.js, Node.js, Express.js, MySQL/MongoDB/Supabase, and Python.',
      'engineering',
      1,
      1,
      'user'
    );
    insertMem.run(
      'mem-2',
      'Personal Brand Identity',
      'Project brand: REMY THE GRIVER PRO — Your Personal AI. Your Rules. Personal brand: BULL MAN.',
      'identity',
      1,
      1,
      'user'
    );
  }
}

export async function createDatabaseBackup(): Promise<{ filename: string; path: string; sizeBytes: number }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `remy_griver_backup_${stamp}.db`;
  const dest = path.join(BACKUPS_DIR, filename);
  await sqliteBackup(db, dest);
  const stats = fs.statSync(dest);
  return { filename, path: dest, sizeBytes: stats.size };
}

export function getDatabaseHealth(): {
  integrity: string;
  sizeBytes: number;
  tables: Record<string, number>;
} {
  const integrityRow = db.prepare('PRAGMA integrity_check;').get() as { integrity_check: string };
  const stats = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : { size: 0 };
  const tableNames = [
    'conversations',
    'messages',
    'memories',
    'documents',
    'tasks',
    'notes',
    'reminders',
    'audit_logs',
    'plugins',
  ];
  const tables: Record<string, number> = {};
  for (const name of tableNames) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number };
    tables[name] = row.c;
  }
  return {
    integrity: integrityRow?.integrity_check ?? 'unknown',
    sizeBytes: stats.size,
    tables,
  };
}
