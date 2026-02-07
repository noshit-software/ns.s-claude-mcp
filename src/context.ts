import { pool } from './db.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface ContextEntry {
  key: string;
  value: unknown;
  updated_by?: string;
  updated_at?: string;
}

export async function getAllContext(): Promise<ContextEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM context ORDER BY updated_at DESC');
  return rows as ContextEntry[];
}

export async function getContext(key: string): Promise<ContextEntry | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM context WHERE `key` = ?',
    [key]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    value: rows[0].value,
  } as ContextEntry;
}

export async function setContext(entry: {
  key: string;
  value: unknown;
  updated_by?: string;
}): Promise<ContextEntry> {
  await pool.query(
    `INSERT INTO context (\`key\`, value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    [entry.key, JSON.stringify(entry.value), entry.updated_by || null]
  );
  return (await getContext(entry.key))!;
}

export async function deleteContext(key: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM context WHERE `key` = ?',
    [key]
  );
  return result.affectedRows > 0;
}
