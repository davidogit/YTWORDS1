import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '../../../db/words.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export const isWordUsed = (word: string): boolean => {
  const row = db.prepare('SELECT word FROM words WHERE word = ?').get(word);
  return !!row;
};

export const markWordUsed = (word: string, status: string = 'PROCESSED') => {
  db.prepare('INSERT OR REPLACE INTO words (word, status) VALUES (?, ?)').run(word, status);
};
