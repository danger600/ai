export type NavSection =
  | 'chat'
  | 'history'
  | 'agents'
  | 'studio'
  | 'media'
  | 'documents'
  | 'cv'
  | 'memory'
  | 'productivity'
  | 'research'
  | 'system'
  | 'security'
  | 'plugins'
  | 'settings';

export interface UserProfile {
  id: number;
  full_name: string;
  brand_name: string;
  education: string;
  location: string;
  github_url: string;
  email: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  description: string;
  sensitiveScopes: string[];
}

export interface Conversation {
  id: string;
  title: string;
  agent_id: string;
  model: string;
  language: string;
  saved: number;
  created_at: string;
  updated_at: string;
}

export interface CitationItem {
  filename: string;
  pageOrRow: string;
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent_id?: string;
  model?: string;
  tokens_used?: number;
  citations?: CitationItem[];
  created_at: string;
}

export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  category: string;
  approved: number;
  enabled: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentItem {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  page_count: number;
  summary: string;
  local_only: number;
  status: string;
  created_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  page_or_row: string;
  content: string;
  keywords: string;
}

export interface ProjectItem {
  id: string;
  name: string;
  description: string;
  status: string;
  progress: number;
  stack: string;
  due_date: string | null;
}

export interface TaskItem {
  id: string;
  project_id: string | null;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  due_date: string | null;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  category: string;
  updated_at: string;
}

export interface ReminderItem {
  id: string;
  title: string;
  remind_at: string;
  completed: number;
}

export interface CvProfile {
  id: string;
  full_name: string;
  education: string;
  location: string;
  github_url: string;
  internship: string;
  skills_json: string;
  projects_json: string;
  summary: string;
  raw_text: string;
  private_locked: number;
  updated_at: string;
}

export interface CvVersion {
  id: string;
  cv_id: string;
  version_label: string;
  target_role: string;
  raw_text: string;
  notes: string;
  created_at: string;
}

export interface PermissionItem {
  id: string;
  scope: string;
  description: string;
  granted: number;
  updated_at: string;
}

export interface PluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions_json: string;
  enabled: number;
  approved: number;
  last_run: string | null;
  last_status: string;
}

export interface SystemTelemetryResponse {
  telemetry: {
    hostname: string;
    platform: string;
    cpuModel: string;
    cpuCores: number;
    cpuUsagePercent: number;
    ramTotalGb: number;
    ramUsedGb: number;
    ramUsagePercent: number;
    processRssMb: number;
    uptimeSeconds: number;
    nodeVersion: string;
    serverTimeIso: string;
  };
  dbHealth: {
    integrity: string;
    sizeBytes: number;
    tables: Record<string, number>;
  };
  providers: {
    gemini: { available: boolean; model: string };
    ollama: { available: boolean; endpoint: string; models: string[]; error?: string };
  };
}
