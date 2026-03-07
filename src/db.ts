import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// memory2thought dual-write pool (optional — only if M2T_DB_HOST is configured)
export const m2tPool = config.m2t.enabled
  ? mysql.createPool({
      host: config.m2t.db.host,
      port: config.m2t.db.port,
      user: config.m2t.db.user,
      password: config.m2t.db.password,
      database: config.m2t.db.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    })
  : null;

export async function testConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
}

export async function testM2tConnection(): Promise<boolean> {
  if (!m2tPool) return false;
  try {
    await m2tPool.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('m2t database connection failed:', error);
    return false;
  }
}
