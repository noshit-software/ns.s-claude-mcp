import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

async function setupAsRoot() {
  console.log('Setting up MCP context database with root access...\n');

  // Prompt for root password
  const rootPassword = process.argv[2];
  if (!rootPassword) {
    console.error('Usage: npm run setup-root <root_password>');
    process.exit(1);
  }

  const dbName = process.env.DB_NAME || 'knightsrook_mcp';
  const dbUser = process.env.DB_USER || 'knightsrook_mcp';
  const dbPassword = process.env.DB_PASSWORD || 'Octanemedia1!';
  const dbHost = process.env.DB_HOST || 'localhost';

  // Connect as root
  const connection = await mysql.createConnection({
    host: dbHost,
    port: 3306,
    user: 'root',
    password: rootPassword,
  });

  console.log('Connected as root\n');

  // Create database
  console.log(`Creating database '${dbName}'...`);
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);

  // Create user and grant privileges
  console.log(`Creating user '${dbUser}'...`);
  await connection.query(
    `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'`
  );

  console.log(`Granting privileges to '${dbUser}'...`);
  await connection.query(
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'localhost'`
  );
  await connection.query('FLUSH PRIVILEGES');

  // Use the database
  await connection.query(`USE \`${dbName}\``);

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

  console.log('\n✓ Database setup complete!');
  console.log(`✓ Database: ${dbName}`);
  console.log(`✓ User: ${dbUser}`);
  console.log('✓ Table: context');
  console.log('\nYou can now run: npm run dev');
}

setupAsRoot().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
