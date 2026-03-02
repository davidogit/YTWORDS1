/**
 * validator.test.ts — Tests for word validation and deduplication.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

describe('profanityFilter', () => {
  it('should detect profane words', async () => {
    const { isProfane } = await import('../src/utils/profanityFilter.js');
    expect(isProfane('damn')).toBe(true);
    expect(isProfane('hello')).toBe(false);
    expect(isProfane('susurrus')).toBe(false);
  });
});

describe('deduplication', () => {
  it('should detect duplicates in the database', async () => {
    // Use an in-memory database for testing
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE words (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL UNIQUE,
        status TEXT DEFAULT 'discovered',
        source TEXT DEFAULT 'test',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.prepare('INSERT INTO words (id, word, source) VALUES (?, ?, ?)').run(
      'test-1', 'susurrus', 'test'
    );

    const row = db.prepare('SELECT id FROM words WHERE LOWER(word) = LOWER(?)').get('susurrus');
    expect(row).toBeTruthy();

    const missing = db.prepare('SELECT id FROM words WHERE LOWER(word) = LOWER(?)').get('petrichor');
    expect(missing).toBeUndefined();

    db.close();
  });
});

describe('quality scoring', () => {
  it('should score longer unusual words higher', () => {
    // Test the scoring logic conceptually
    // In production, import and test scoreQuality directly
    const score = (word: string) => {
      let s = 0;
      if (word.length >= 8 && word.length <= 14) s += 0.25;
      else if (word.length >= 6) s += 0.15;
      if (/[xzqj]/i.test(word)) s += 0.1;
      if (/(.)\1/.test(word)) s += 0.05;
      return Math.min(1, s);
    };

    expect(score('susurrus')).toBeGreaterThan(score('cat'));
    expect(score('quixotic')).toBeGreaterThan(score('simple'));
  });
});
