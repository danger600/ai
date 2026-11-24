# Backup & Disaster Recovery — REMY THE GRIVER PRO

## Storage Layout
- `storage/remy_griver_pro.db`: Primary SQLite database (WAL mode, `PRAGMA foreign_keys = ON`)
- `storage/documents/`: Local indexed documents (never synced to cloud automatically)
- `storage/cv/`: Private CV source imports
- `storage/exports/`: Generated PDF CV exports
- `storage/backups/`: Integrity-verified SQLite snapshots
- `storage/logs/`: Rotating diagnostic logs with secret masking

## Creating a Backup
- Inside the desktop app: **System & Security -> Backup SQLite DB**
- Programmatically via `backend.database.db.create_backup(conn)` (uses native SQLite online backup API).

## Restoring from Backup
1. Stop running desktop instances.
2. Verify integrity using `restore_backup(Path("storage/backups/<file>.db"))`, which enforces `PRAGMA integrity_check == 'ok'` before replacing the active database.
3. Restart `python main.py`.
