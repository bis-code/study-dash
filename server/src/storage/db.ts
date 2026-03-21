import BetterSqlite3 from 'better-sqlite3';
import { schema, migrations } from './schema.js';

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);

    // Performance + integrity PRAGMAs
    this.db.pragma('journal_mode=WAL');
    this.db.pragma('foreign_keys=ON');

    // Apply schema (all CREATE IF NOT EXISTS — safe to re-run)
    this.db.exec(schema);

    // Seed defaults on first initialisation
    const currentVersion = this.getSetting('schema_version');
    if (!currentVersion) {
      this.setSetting('schema_version', '1');
      this.setSetting('auto_viz', 'true');
      this.setSetting('dashboard_port', '19282');
    }

    // Run any pending migrations beyond the baseline
    const versionNum = parseInt(this.getSetting('schema_version') ?? '1', 10);
    for (let i = versionNum - 1; i < migrations.length; i++) {
      this.db.exec(migrations[i]);
      this.setSetting('schema_version', String(i + 2));
    }
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
      .get(key);
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  listTables(): string[] {
    const allRows = this.db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table')")
      .all();
    return allRows.map((r) => r.name);
  }

  /** Expose the raw better-sqlite3 handle for advanced operations. */
  get raw(): BetterSqlite3.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
