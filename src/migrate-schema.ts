import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config();

async function migrateSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'knightsrook_mcp',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'knightsrook_mcp',
  });

  try {
    console.log('Starting schema migration...');

    // Clear all existing data (Nebula task data)
    await connection.query('DELETE FROM context');
    console.log('✓ Cleared existing data');

    // Add new metadata columns
    await connection.query(`
      ALTER TABLE context
      ADD COLUMN IF NOT EXISTS tags JSON DEFAULT NULL COMMENT 'Searchable keywords array',
      ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT NULL COMMENT 'Topic area (architecture, design, etc)',
      ADD COLUMN IF NOT EXISTS project VARCHAR(100) DEFAULT NULL COMMENT 'Associated project name'
    `);
    console.log('✓ Added metadata columns (tags, category, project)');

    // Add indexes for better search performance
    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_category ON context(category)
    `);
    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_project ON context(project)
    `);
    await connection.query(`
      CREATE INDEX IF NOT EXISTS idx_updated_at ON context(updated_at)
    `);
    console.log('✓ Added indexes for search performance');

    console.log('\n✅ Migration complete! Schema ready for curated knowledge base.');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

migrateSchema().catch(console.error);
