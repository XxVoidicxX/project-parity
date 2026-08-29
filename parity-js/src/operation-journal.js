const clone = value => structuredClone(value);

export class OperationJournal {
  constructor({ limit = 1000, clock = () => Date.now() } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Journal limit must be a positive integer');
    this.limit = limit;
    this.clock = clock;
    this.sequence = 0;
    this.records = [];
  }
  record(record) {
    const stored = { sequence: ++this.sequence, recordedAt: new Date(this.clock()).toISOString(), ...clone(record) };
    this.records.push(stored);
    if (this.records.length > this.limit) this.records.splice(0, this.records.length - this.limit);
    return clone(stored);
  }
  entries() { return this.records.map(clone); }
  clear() { this.records = []; }
}
