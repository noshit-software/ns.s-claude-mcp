import { pool } from './db.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface ContextEntry {
  key: string;
  value: unknown;
  tags?: string[];
  category?: string;
  project?: string;
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
  tags?: string[];
  category?: string;
  project?: string;
  updated_by?: string;
}): Promise<ContextEntry> {
  await pool.query(
    `INSERT INTO context (\`key\`, value, tags, category, project, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       value = VALUES(value),
       tags = VALUES(tags),
       category = VALUES(category),
       project = VALUES(project),
       updated_by = VALUES(updated_by)`,
    [
      entry.key,
      JSON.stringify(entry.value),
      entry.tags ? JSON.stringify(entry.tags) : null,
      entry.category || null,
      entry.project || null,
      entry.updated_by || null
    ]
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

export async function searchContext(params: {
  query?: string;
  tags?: string[];
  category?: string;
  project?: string;
  limit?: number;
}): Promise<ContextEntry[]> {
  const conditions: string[] = [];
  const values: any[] = [];

  // Search in key or value
  if (params.query) {
    conditions.push('(`key` LIKE ? OR JSON_UNQUOTE(value) LIKE ?)');
    values.push(`%${params.query}%`, `%${params.query}%`);
  }

  // Filter by tags (any tag matches)
  if (params.tags && params.tags.length > 0) {
    const tagConditions = params.tags.map(() => 'JSON_CONTAINS(tags, ?)').join(' OR ');
    conditions.push(`(${tagConditions})`);
    params.tags.forEach(tag => values.push(JSON.stringify(tag)));
  }

  // Filter by category
  if (params.category) {
    conditions.push('category = ?');
    values.push(params.category);
  }

  // Filter by project
  if (params.project) {
    conditions.push('project = ?');
    values.push(params.project);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = params.limit ? `LIMIT ${params.limit}` : '';

  const query = `
    SELECT * FROM context
    ${whereClause}
    ORDER BY updated_at DESC
    ${limitClause}
  `;

  const [rows] = await pool.query<RowDataPacket[]>(query, values);
  return rows as ContextEntry[];
}
