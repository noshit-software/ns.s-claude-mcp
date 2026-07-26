import mysql from 'mysql2/promise';
import { config } from './config.js';

// Adds soft-delete support to the context table. delete_topic used to be a
// hard DELETE — irreversible via a single tool call, auth or no auth.
async function migrate() {
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    console.log('Adding deleted_at column...');
    try {
      await connection.query(
        "ALTER TABLE context ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at"
      );
      console.log('✓ Added column: deleted_at');
    } catch (error: any) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('  Column deleted_at already exists, skipping');
      } else {
        throw error;
      }
    }

    try {
      await connection.query('CREATE INDEX idx_deleted_at ON context(deleted_at)');
      console.log('✓ Added index: idx_deleted_at');
    } catch (error: any) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log('  Index idx_deleted_at already exists, skipping');
      } else {
        throw error;
      }
    }

    console.log('\n✅ Soft-delete migration complete.');
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
