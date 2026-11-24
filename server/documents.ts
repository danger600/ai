import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { db } from './db.ts';
import { sanitizeFilename } from './security.ts';

const DOCUMENTS_DIR = path.resolve(process.cwd(), 'storage', 'documents');

export interface ChunkInput {
  pageOrRow: string;
  content: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'you', 'your', 'can', 'will', 'all',
  'into', 'about', 'there', 'their', 'which', 'when', 'where', 'what', 'how',
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_+#.-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 40);
}

export async function parseUploadedDocument(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<{ chunks: ChunkInput[]; pageCount: number; rawText: string }> {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    const rawText = result.value || '';
    const chunks = chunkTextByParagraphs(rawText, 'Paragraph');
    return { chunks, pageCount: Math.max(1, Math.ceil(rawText.length / 2500)), rawText };
  }

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const chunks: ChunkInput[] = [];
    const allLines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const batchSize = 15;
      for (let i = 0; i < rows.length; i += batchSize) {
        const slice = rows.slice(i, i + batchSize);
        const formatted = slice
          .map((row, idx) => `Row ${i + idx + 1}: ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' | ')}`)
          .join('\n');
        chunks.push({
          pageOrRow: `${sheetName} Rows ${i + 1}-${i + slice.length}`,
          content: formatted,
        });
        allLines.push(formatted);
      }
      if (rows.length === 0) {
        const csvText = XLSX.utils.sheet_to_csv(sheet);
        if (csvText.trim()) {
          chunks.push({ pageOrRow: `${sheetName} Sheet`, content: csvText.trim() });
          allLines.push(csvText.trim());
        }
      }
    }
    return {
      chunks: chunks.length > 0 ? chunks : [{ pageOrRow: 'Row 1', content: '(Empty spreadsheet)' }],
      pageCount: workbook.SheetNames.length || 1,
      rawText: allLines.join('\n\n'),
    };
  }

  if (ext === '.pdf') {
    // Extract readable ASCII/UTF-8 text strings locally without sending private PDFs externally by default
    const rawPdf = fileBuffer.toString('latin1');
    const textMatches: string[] = [];
    const parensRegex = /\(([^()\\]{3,300})\)/g;
    let m: RegExpExecArray | null;
    while ((m = parensRegex.exec(rawPdf)) !== null) {
      const cleaned = m[1].replace(/[^\x20-\x7E\n]/g, ' ').trim();
      if (cleaned.length >= 3 && /[a-zA-Z]{2,}/.test(cleaned)) {
        textMatches.push(cleaned);
      }
    }
    const extracted = textMatches.join(' ').replace(/\s+/g, ' ').trim();
    const fallbackText =
      extracted.length > 40
        ? extracted
        : `PDF binary (${originalName}, ${fileBuffer.length} bytes). Use "AI OCR / Deep Extract" if scanned or compressed streams require multimodal extraction.`;
    const chunks = chunkTextByParagraphs(fallbackText, 'Page');
    return {
      chunks,
      pageCount: Math.max(1, (rawPdf.match(/\/Type\s*\/Page[^s]/g) || []).length || 1),
      rawText: fallbackText,
    };
  }

  // Plain text, Markdown, Python, JS, TS, JSON, etc.
  const textExtensions = new Set([
    '.txt', '.md', '.py', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.sql', '.yaml', '.yml', '.env', '.log',
  ]);
  if (textExtensions.has(ext) || mimeType.startsWith('text/')) {
    const rawText = fileBuffer.toString('utf8');
    const chunks = chunkTextByLines(rawText, 35);
    return {
      chunks,
      pageCount: Math.max(1, Math.ceil(rawText.split(/\r?\n/).length / 45)),
      rawText,
    };
  }

  // Image or binary fallback
  const fallback = `Binary/Image asset: ${originalName} (${mimeType}, ${fileBuffer.length} bytes). Stored locally. Trigger explicit OCR to extract embedded visual text.`;
  return {
    chunks: [{ pageOrRow: 'Asset Metadata', content: fallback }],
    pageCount: 1,
    rawText: fallback,
  };
}

function chunkTextByParagraphs(text: string, labelPrefix: string, maxChars = 900): ChunkInput[] {
  const cleaned = text.trim();
  if (!cleaned) return [{ pageOrRow: `${labelPrefix} 1`, content: '(No extractable text)' }];

  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: ChunkInput[] = [];
  let buffer = '';
  let index = 1;

  for (const para of paragraphs) {
    if ((buffer + '\n\n' + para).length > maxChars && buffer.length > 0) {
      chunks.push({ pageOrRow: `${labelPrefix} ${index}`, content: buffer.trim() });
      index += 1;
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim()) {
    chunks.push({ pageOrRow: `${labelPrefix} ${index}`, content: buffer.trim() });
  }
  return chunks;
}

function chunkTextByLines(text: string, linesPerChunk = 35): ChunkInput[] {
  const lines = text.split(/\r?\n/);
  const chunks: ChunkInput[] = [];
  for (let i = 0; i < lines.length; i += linesPerChunk) {
    const slice = lines.slice(i, i + linesPerChunk).join('\n').trim();
    if (slice) {
      chunks.push({
        pageOrRow: `Lines ${i + 1}-${Math.min(lines.length, i + linesPerChunk)}`,
        content: slice,
      });
    }
  }
  return chunks.length > 0 ? chunks : [{ pageOrRow: 'Lines 1-1', content: '(Empty file)' }];
}

export async function ingestDocument(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<{
  id: string;
  filename: string;
  pageCount: number;
  chunkCount: number;
  summary: string;
}> {
  const id = `doc-${crypto.randomUUID().slice(0, 8)}`;
  const safeName = sanitizeFilename(originalName);
  const diskPath = path.join(DOCUMENTS_DIR, `${id}_${safeName}`);
  fs.writeFileSync(diskPath, fileBuffer);

  const parsed = await parseUploadedDocument(fileBuffer, safeName, mimeType);
  const preview = parsed.rawText.slice(0, 280).replace(/\s+/g, ' ').trim();
  const summary = preview ? `${preview}${parsed.rawText.length > 280 ? '...' : ''}` : 'Stored locally.';

  const insertDoc = db.prepare(`
    INSERT INTO documents (id, filename, mime_type, size_bytes, page_count, summary, local_only, status)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'indexed')
  `);
  insertDoc.run(id, originalName, mimeType, fileBuffer.length, parsed.pageCount, summary);

  const insertChunk = db.prepare(`
    INSERT INTO document_chunks (id, document_id, chunk_index, page_or_row, content, keywords)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  parsed.chunks.forEach((chunk, idx) => {
    const keywords = extractKeywords(chunk.content).join(',');
    insertChunk.run(
      `chk-${crypto.randomUUID().slice(0, 8)}`,
      id,
      idx + 1,
      chunk.pageOrRow,
      chunk.content,
      keywords
    );
  });

  return {
    id,
    filename: originalName,
    pageCount: parsed.pageCount,
    chunkCount: parsed.chunks.length,
    summary,
  };
}

export function searchLocalChunks(query: string, documentId?: string, topK = 5): Array<{
  chunkId: string;
  documentId: string;
  filename: string;
  pageOrRow: string;
  content: string;
  score: number;
}> {
  const qTerms = extractKeywords(query);
  const rows = (documentId
    ? db
        .prepare(
          `SELECT c.id as chunkId, c.document_id as documentId, d.filename, c.page_or_row as pageOrRow, c.content, c.keywords
           FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE c.document_id = ?`
        )
        .all(documentId)
    : db
        .prepare(
          `SELECT c.id as chunkId, c.document_id as documentId, d.filename, c.page_or_row as pageOrRow, c.content, c.keywords
           FROM document_chunks c JOIN documents d ON d.id = c.document_id`
        )
        .all()) as Array<{
    chunkId: string;
    documentId: string;
    filename: string;
    pageOrRow: string;
    content: string;
    keywords: string;
  }>;

  const scored = rows.map((row) => {
    const contentLower = row.content.toLowerCase();
    const keywordSet = new Set(row.keywords.split(','));
    let score = 0;
    for (const term of qTerms) {
      if (keywordSet.has(term)) score += 3;
      if (contentLower.includes(term)) score += 2;
    }
    if (query.trim().length > 2 && contentLower.includes(query.trim().toLowerCase())) {
      score += 5;
    }
    return {
      chunkId: row.chunkId,
      documentId: row.documentId,
      filename: row.filename,
      pageOrRow: row.pageOrRow,
      content: row.content,
      score,
    };
  });

  return scored
    .filter((s) => (qTerms.length === 0 ? true : s.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
