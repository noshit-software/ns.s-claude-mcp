import { pool, m2tPool } from './db.js';
import { config } from './config.js';
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

  // Dual-write to memory2thought
  syncToM2t(entry).catch(err => console.error('[m2t sync] save failed:', err.message));

  return (await getContext(entry.key))!;
}

export async function deleteContext(key: string): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM context WHERE `key` = ?',
    [key]
  );

  // Dual-delete from memory2thought
  deleteFromM2t(key).catch(err => console.error('[m2t sync] delete failed:', err.message));

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

// ── memory2thought dual-write ───────────────────────────────────────

// Parse type:name:subject key → codex name is the "name" segment
function parseCodexName(key: string): string {
  const parts = key.split(':');
  // type:name:subject → name; type:name → name; bare-key → bare-key
  return parts.length >= 2 ? parts[1] : parts[0];
}

// Find or create a codex by name for the configured user.
// Multi-level fuzzy match: exact → substring → word overlap → topic key names.
// Strips org prefixes (e.g. "knightsrook-") before matching.
async function resolveCodexId(codexName: string): Promise<number> {
  if (!m2tPool || !config.m2t.clerkUserId) return 0;

  const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').trim();
  const toWords = (s: string) => normalize(s).split(/\s+/).filter(w => w.length >= 2);
  // Strip org prefix — workspace names often start with "knightsrook-"
  const stripPrefix = (s: string) => s.replace(/^knightsrook[\s-_]+/i, '');

  const normalized = normalize(codexName);
  const stripped = normalize(stripPrefix(codexName));
  const incomingWords = toWords(stripPrefix(codexName));

  const [rows] = await m2tPool.query<RowDataPacket[]>(
    'SELECT id, name FROM codices WHERE clerk_user_id = ?',
    [config.m2t.clerkUserId]
  );

  // 1. Exact normalized match
  const exact = rows.find(r => normalize(r.name) === normalized || normalize(r.name) === stripped);
  if (exact) return exact.id;

  // 2. Substring match (with and without prefix)
  const substr = rows.find(r => {
    const n = normalize(r.name);
    return n.includes(normalized) || normalized.includes(n)
      || n.includes(stripped) || stripped.includes(n);
  });
  if (substr) {
    console.log(`[m2t sync] fuzzy matched "${codexName}" → codex "${substr.name}" (id=${substr.id})`);
    return substr.id;
  }

  // 3. Word overlap: if >50% of codex name words appear in incoming (or vice versa)
  let bestMatch: { id: number; name: string } | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const codexWords = toWords(r.name);
    if (codexWords.length === 0) continue;
    const overlap = codexWords.filter(w => incomingWords.includes(w)).length;
    const score = overlap / codexWords.length;
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = r;
    }
  }
  if (bestMatch) {
    console.log(`[m2t sync] word-matched "${codexName}" → codex "${bestMatch.name}" (id=${bestMatch.id}, score=${bestScore})`);
    return bestMatch.id;
  }

  // 4. Match against existing topic key name segments in each codex
  const [topicRows] = await m2tPool.query<RowDataPacket[]>(
    `SELECT DISTINCT codex_id, SUBSTRING_INDEX(SUBSTRING_INDEX(topic_key, ':', 2), ':', -1) AS key_name
     FROM topics WHERE codex_id IN (${rows.map(() => '?').join(',')})`,
    rows.map(r => r.id)
  );
  for (const tr of topicRows) {
    const keyName = normalize(tr.key_name);
    if (stripped.includes(keyName) || keyName.includes(stripped)) {
      const codex = rows.find(r => r.id === tr.codex_id);
      if (codex) {
        console.log(`[m2t sync] key-matched "${codexName}" → codex "${codex.name}" via key name "${tr.key_name}" (id=${codex.id})`);
        return codex.id;
      }
    }
  }

  // No match — create a new codex with a readable name (stripped of org prefix)
  const readable = stripPrefix(codexName).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const [result] = await m2tPool.query<ResultSetHeader>(
    'INSERT INTO codices (clerk_user_id, name) VALUES (?, ?)',
    [config.m2t.clerkUserId, readable]
  );

  console.log(`[m2t sync] created codex "${readable}" (id=${result.insertId})`);
  return result.insertId;
}

async function syncToM2t(entry: {
  key: string;
  value: unknown;
  tags?: string[];
  category?: string;
}, retry = true): Promise<void> {
  if (!m2tPool || !config.m2t.clerkUserId) return;

  const codexName = parseCodexName(entry.key);
  const codexId = await resolveCodexId(codexName);
  if (!codexId) return;

  const valueStr = typeof entry.value === 'string'
    ? entry.value
    : JSON.stringify(entry.value);

  try {
    await m2tPool.query(
      `INSERT INTO topics (codex_id, topic_key, value, category, tags)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value = VALUES(value),
         category = VALUES(category),
         tags = VALUES(tags)`,
      [
        codexId,
        entry.key,
        valueStr,
        entry.category || null,
        entry.tags ? JSON.stringify(entry.tags) : null,
      ]
    );
  } catch (err: any) {
    // Retry once on connection errors (stale pool after Railway drops idle connections)
    if (retry && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT')) {
      console.warn(`[m2t sync] connection lost, retrying: ${err.code}`);
      return syncToM2t(entry, false);
    }
    throw err;
  }
}

async function deleteFromM2t(key: string, retry = true): Promise<void> {
  if (!m2tPool || !config.m2t.clerkUserId) return;

  const codexName = parseCodexName(key);
  const codexId = await resolveCodexId(codexName);
  if (!codexId) return;

  try {
    await m2tPool.query(
      'DELETE FROM topics WHERE codex_id = ? AND topic_key = ?',
      [codexId, key]
    );
  } catch (err: any) {
    if (retry && (err.code === 'ECONNRESET' || err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ETIMEDOUT')) {
      console.warn(`[m2t sync] connection lost, retrying delete: ${err.code}`);
      return deleteFromM2t(key, false);
    }
    throw err;
  }
}
