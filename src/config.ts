import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3118', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'knightsrook_mcp',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'knightsrook_mcp',
  },
};
