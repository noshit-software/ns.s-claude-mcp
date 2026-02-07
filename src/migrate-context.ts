import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function migrateContext() {
  console.log('Starting context migration from knightsrook_nebula to knightsrook_mcp...\n');

  const rootPassword = process.argv[2];
  if (!rootPassword) {
    console.error('Usage: npm run migrate <root_password>');
    process.exit(1);
  }

  // Connect to source database (knightsrook_nebula)
  console.log('Connecting to source database (knightsrook_nebula)...');
  const sourceConnection = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: rootPassword,
    database: 'knightsrook_nebula',
  });

  // Connect to destination database (knightsrook_mcp)
  console.log('Connecting to destination database (knightsrook_mcp)...');
  const destConnection = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: rootPassword,
    database: 'knightsrook_mcp',
  });

  // Count source records
  const [countResult] = await sourceConnection.query(
    'SELECT COUNT(*) as count FROM context'
  ) as any;
  const totalRecords = countResult[0].count;
  console.log(`Found ${totalRecords} records to migrate\n`);

  // Fetch all records from source
  console.log('Reading records from source...');
  const [rows] = await sourceConnection.query(
    'SELECT `key`, value, updated_by, updated_at FROM context'
  ) as any;

  console.log(`Fetched ${rows.length} records`);
  console.log('Writing records to destination...');

  // Insert records in batches
  let inserted = 0;
  const batchSize = 100;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      // Ensure value is properly JSON-encoded
      const jsonValue = typeof row.value === 'string'
        ? row.value
        : JSON.stringify(row.value);

      await destConnection.query(
        'INSERT INTO context (`key`, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)',
        [row.key, jsonValue, row.updated_by, row.updated_at]
      );
      inserted++;

      if (inserted % 1000 === 0) {
        console.log(`  Migrated ${inserted}/${totalRecords} records...`);
      }
    }
  }

  console.log(`\n✓ Migration complete! Migrated ${inserted} records`);

  // Verify
  const [verifyResult] = await destConnection.query(
    'SELECT COUNT(*) as count FROM context'
  ) as any;
  const destCount = verifyResult[0].count;

  console.log(`\nVerification:`);
  console.log(`  Source records: ${totalRecords}`);
  console.log(`  Destination records: ${destCount}`);
  console.log(`  Match: ${totalRecords === destCount ? '✓' : '✗'}`);

  await sourceConnection.end();
  await destConnection.end();
}

migrateContext().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
