import { DatabaseSync } from 'node:sqlite';
export class SqliteLedgerAdapter {
  constructor(path = ':memory:') { this.database = new DatabaseSync(path); this.database.exec('CREATE TABLE IF NOT EXISTS parity_ledger (correlation_id TEXT PRIMARY KEY, payload TEXT NOT NULL)'); }
  async insert(entry) { this.database.prepare('INSERT OR REPLACE INTO parity_ledger (correlation_id, payload) VALUES (?, ?)').run(entry.correlationId, JSON.stringify(entry)); }
  async all() { return this.database.prepare('SELECT payload FROM parity_ledger').all().map(row => JSON.parse(row.payload)); }
  async remove(correlationId) { this.database.prepare('DELETE FROM parity_ledger WHERE correlation_id = ?').run(correlationId); }
  close() { this.database.close(); }
}
