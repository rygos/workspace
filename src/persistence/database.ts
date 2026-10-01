// Lokale Persistenz mit SQLite-Abstraktion

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

export class LocalDatabase {
  private db: any;

  constructor() {
    this.db = open({
      filename: './app.db',
      driver: sqlite3.Database,
    });
  }

  async init(): Promise<void> {
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT,
        version TEXT,
        entrypoint TEXT
      )
    `);
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    await this.db.run(`
      CREATE TABLE IF NOT EXISTS lastKnownGood (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        pluginId TEXT,
        version TEXT
      )
    `);
  }

  async savePlugin(plugin: { id: string; name: string; version: string; entrypoint: string }): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO plugins (id, name, version, entrypoint) VALUES (?, ?, ?, ?)',
      [plugin.id, plugin.name, plugin.version, plugin.entrypoint]
    );
  }

  async getPlugin(id: string): Promise<any | null> {
    const row = await this.db.get('SELECT * FROM plugins WHERE id = ?', [id]);
    return row || null;
  }

  async saveSetting(key: string, value: string): Promise<void> {
    await this.db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.get('SELECT * FROM settings WHERE key = ?', [key]);
    return row?.value || null;
  }

  async saveLastKnownGood(pluginId: string, version: string): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO lastKnownGood (id, pluginId, version) VALUES (?, ?, ?)',
      [`LKG-${pluginId}`, pluginId, version]
    );
  }

  async getLastKnownGood(pluginId: string): Promise<{ version: string } | null> {
    const row = await this.db.get('SELECT * FROM lastKnownGood WHERE pluginId = ?', [pluginId]);
    return row ? { version: row.version } : null;
  }
}

const db = new LocalDatabase();
db.init();
