import dotenv from 'dotenv';
dotenv.config();
import mysql from 'mysql2/promise';

const MCP_URL = process.env.MCP_URL || 'https://mcp.knightsrook.com';

const m2tPool = mysql.createPool({
  host: process.env.M2T_DB_HOST,
  port: parseInt(process.env.M2T_DB_PORT),
  user: process.env.M2T_DB_USER,
  password: process.env.M2T_DB_PASSWORD,
  database: process.env.M2T_DB_NAME,
});

const codexId = parseInt(process.env.M2T_CODEX_ID);
console.log(`Backfilling MCP topics → m2t codex ${codexId}`);
console.log(`Reading from ${MCP_URL}/context`);

// Fetch all topics from MCP REST API
const res = await fetch(`${MCP_URL}/context`);
if (!res.ok) {
  console.error(`MCP API error: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const rows = await res.json();
console.log(`Found ${rows.length} MCP topics`);

let created = 0, updated = 0, failed = 0;

for (const row of rows) {
  try {
    const valueStr = typeof row.value === 'string'
      ? row.value
      : JSON.stringify(row.value);
    const tags = row.tags
      ? (typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags))
      : null;

    const [result] = await m2tPool.query(
      `INSERT INTO topics (codex_id, topic_key, value, category, tags)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value = VALUES(value),
         category = VALUES(category),
         tags = VALUES(tags)`,
      [codexId, row.key, valueStr, row.category || null, tags]
    );

    if (result.affectedRows === 1) created++;
    else updated++;
    console.log(`  ${result.affectedRows === 1 ? '+' : '~'} ${row.key}`);
  } catch (e) {
    console.error(`  ✗ ${row.key} — ${e.message}`);
    failed++;
  }
}

console.log(`\nDone: ${created} created, ${updated} updated, ${failed} failed`);
await m2tPool.end();
process.exit(0);
