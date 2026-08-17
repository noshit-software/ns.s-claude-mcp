import mysql from 'mysql2/promise';
import { config } from './config.js';

// Adds the table backing dynamic OAuth client registration (RFC 7591) —
// so a connector's registered client_id survives a server restart instead
// of being forced to re-register (and the user re-approving) every time.
async function migrate() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    console.log('Creating oauth_clients table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id VARCHAR(64) PRIMARY KEY,
        data JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Table ready: oauth_clients');
    console.log('\n✅ OAuth migration complete.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
