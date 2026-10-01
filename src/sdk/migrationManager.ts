// Migration Manager für Datenbankmigrationen

import { LocalDatabase } from '../persistence/database';

export class MigrationManager {
  private db: LocalDatabase;

  constructor(db: LocalDatabase) {
    this.db = db;
  }

  async runMigrations(): Promise<void> {
    try {
      // Beispiel für eine einfache Migration
      const migrationVersion = await this.getCurrentMigrationVersion();
      
      if (migrationVersion < 1) {
        console.log('Running database migration to version 1...');
        
        await this.db.run(`
          ALTER TABLE plugins 
          ADD COLUMN IF NOT EXISTS description TEXT;
        `);
        
        await this.db.saveSetting('last_migration_version', '1');
        console.log('Database migration to version 1 completed successfully.');
      }
    } catch (error) {
      console.error('Failed to run database migrations:', error);
      throw error;
    }
  }

  private async getCurrentMigrationVersion(): Promise<number> {
    const version = await this.db.getSetting('last_migration_version');
    return version ? parseInt(version, 10) : 0;
  }
}

const migrationManager = new MigrationManager(db);
