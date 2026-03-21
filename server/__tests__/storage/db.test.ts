import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../src/storage/db.js';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all tables', () => {
    const tables = db.listTables();
    expect(tables).toContain('subjects');
    expect(tables).toContain('phases');
    expect(tables).toContain('topics');
    expect(tables).toContain('entries');
    expect(tables).toContain('visualizations');
    expect(tables).toContain('exercises');
    expect(tables).toContain('exercise_results');
    expect(tables).toContain('settings');
  });

  it('creates FTS5 virtual table', () => {
    const tables = db.listTables();
    expect(tables).toContain('entries_fts');
  });

  it('sets schema_version on first init', () => {
    expect(db.getSetting('schema_version')).toBe('1');
  });

  it('sets default settings', () => {
    expect(db.getSetting('auto_viz')).toBe('true');
    expect(db.getSetting('dashboard_port')).toBe('19282');
  });

  it('round-trips getSetting/setSetting', () => {
    db.setSetting('test_key', 'test_value');
    expect(db.getSetting('test_key')).toBe('test_value');
    db.setSetting('test_key', 'updated');
    expect(db.getSetting('test_key')).toBe('updated');
  });

  it('returns undefined for missing setting', () => {
    expect(db.getSetting('nonexistent')).toBeUndefined();
  });

  it('enforces foreign keys', () => {
    expect(() => {
      db.raw.prepare('INSERT INTO phases (subject_id, name) VALUES (999, "test")').run();
    }).toThrow();
  });
});
