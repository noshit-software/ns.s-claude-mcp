/**
 * Backfill: push all existing MCP topics to memory2thought.
 * Reads from MCP's context table, resolves codex by topic key name,
 * and upserts into m2t's topics table.
 *
 * Run: node scripts/backfill-m2t.cjs
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mysql = require("mysql2/promise");

const mcpPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const m2tPool = mysql.createPool({
  host: process.env.M2T_DB_HOST,
  port: parseInt(process.env.M2T_DB_PORT || "3306"),
  user: process.env.M2T_DB_USER,
  password: process.env.M2T_DB_PASSWORD,
  database: process.env.M2T_DB_NAME,
});

const clerkUserId = process.env.M2T_CLERK_USER_ID;
if (!clerkUserId) {
  console.error("M2T_CLERK_USER_ID not set");
  process.exit(1);
}

function parseCodexName(key) {
  const parts = key.split(":");
  return parts.length >= 2 ? parts[1] : parts[0];
}

const codexCache = {};

async function resolveCodexId(name) {
  if (codexCache[name]) return codexCache[name];

  const [rows] = await m2tPool.query(
    "SELECT id FROM codices WHERE clerk_user_id = ? AND name = ?",
    [clerkUserId, name]
  );

  if (rows.length > 0) {
    codexCache[name] = rows[0].id;
    return rows[0].id;
  }

  const [result] = await m2tPool.query(
    "INSERT INTO codices (clerk_user_id, name) VALUES (?, ?)",
    [clerkUserId, name]
  );

  console.log(`  Created codex "${name}" (id=${result.insertId})`);
  codexCache[name] = result.insertId;
  return result.insertId;
}

async function run() {
  console.log("Connecting to MCP database...");
  await mcpPool.query("SELECT 1");

  console.log("Connecting to m2t database...");
  await m2tPool.query("SELECT 1");

  const [rows] = await mcpPool.query("SELECT * FROM context ORDER BY updated_at DESC");
  console.log(`Found ${rows.length} MCP topics to backfill\n`);

  let synced = 0;
  let errors = 0;

  for (const row of rows) {
    const codexName = parseCodexName(row.key);
    try {
      const codexId = await resolveCodexId(codexName);
      const valueStr = typeof row.value === "string" ? row.value : JSON.stringify(row.value);

      await m2tPool.query(
        `INSERT INTO topics (codex_id, topic_key, value, category, tags)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           value = VALUES(value),
           category = VALUES(category),
           tags = VALUES(tags)`,
        [codexId, row.key, valueStr, row.category || null, row.tags || null]
      );

      synced++;
      console.log(`  [${synced}] ${row.key} → codex "${codexName}"`);
    } catch (err) {
      errors++;
      console.error(`  FAILED: ${row.key} → ${err.message}`);
    }
  }

  console.log(`\nDone: ${synced} synced, ${errors} errors`);
  await mcpPool.end();
  await m2tPool.end();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
