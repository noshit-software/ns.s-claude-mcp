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

    // Add new metadata columns (one at a time to handle existing columns gracefully)
    const columns = [
      { name: 'tags', def: 'JSON DEFAULT NULL COMMENT \'Searchable keywords array\'' },
      { name: 'category', def: 'VARCHAR(100) DEFAULT NULL COMMENT \'Topic area (architecture, design, etc)\'' },
      { name: 'project', def: 'VARCHAR(100) DEFAULT NULL COMMENT \'Associated project name\'' }
    ];

    for (const col of columns) {
      try {
        await connection.query(`ALTER TABLE context ADD COLUMN ${col.name} ${col.def}`);
        console.log(`✓ Added column: ${col.name}`);
      } catch (error: any) {
        if (error.code === 'ER_DUP_FIELDNAME') {
          console.log(`  Column ${col.name} already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    // Add indexes for better search performance (one at a time to handle existing indexes gracefully)
    const indexes = [
      { name: 'idx_category', column: 'category' },
      { name: 'idx_project', column: 'project' },
      { name: 'idx_updated_at', column: 'updated_at' }
    ];

    for (const idx of indexes) {
      try {
        await connection.query(`CREATE INDEX ${idx.name} ON context(${idx.column})`);
        console.log(`✓ Added index: ${idx.name}`);
      } catch (error: any) {
        if (error.code === 'ER_DUP_KEYNAME') {
          console.log(`  Index ${idx.name} already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n✅ Migration complete! Schema ready for curated knowledge base.');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

migrateSchema().catch(console.error);
