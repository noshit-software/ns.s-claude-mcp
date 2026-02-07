import mysql from 'mysql2/promise';
import { config } from './config.js';

async function setup() {
  console.log('Setting up MCP context database...\n');

  // Connect without database to create it if needed
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
  });

  // Create database
  console.log(`Creating database '${config.db.database}'...`);
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\``
  );
  await connection.query(`USE \`${config.db.database}\``);

  // Create context table
  console.log('Creating context table...');
  await connection.query(`
    CREATE TABLE IF NOT EXISTS context (
      \`key\` VARCHAR(255) PRIMARY KEY,
      value JSON,
      updated_by VARCHAR(50),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await connection.end();

  console.log('\nDatabase setup complete!');
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
