import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const SKIP_DIRS = new Set(['__pycache__', '.venv', 'venv', 'storage', '.pytest_cache', 'dist', 'build']);
const SKIP_EXTS = new Set(['.pyc', '.pyo', '.db', '.sqlite']);

function addDirectoryToZip(zipFolder: JSZip, dirPath: string): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const subFolder = zipFolder.folder(entry.name);
      if (subFolder) {
        addDirectoryToZip(subFolder, path.join(dirPath, entry.name));
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTS.has(ext) || entry.name === '.env') continue;
      const fileContent = fs.readFileSync(path.join(dirPath, entry.name));
      zipFolder.file(entry.name, fileContent);
    }
  }
}

export async function generateWindowsPythonBundleZip(): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder('REMY-THE-GRIVER-PRO')!;
  const pythonRootDir = path.resolve(process.cwd(), 'REMY-THE-GRIVER-PRO');

  if (!fs.existsSync(pythonRootDir)) {
    throw new Error('REMY-THE-GRIVER-PRO directory not found on disk.');
  }

  addDirectoryToZip(root, pythonRootDir);
  return zip.generateAsync({ type: 'nodebuffer' });
}
