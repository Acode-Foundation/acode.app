/**
 * Migration script to add Acode Pro columns to user table
 * Run this script once to update existing database schema
 *
 * Usage: node server/migrations/add_acode_pro_columns.js
 */

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('../lib/db');

function runMigration() {
  console.log('Starting migration: Adding Acode Pro columns to user table...');

  const queries = [
    'ALTER TABLE user ADD COLUMN acode_pro BOOLEAN DEFAULT false',
    'ALTER TABLE user ADD COLUMN pro_purchase_token TEXT',
    'ALTER TABLE user ADD COLUMN pro_purchased_at TIMESTAMP',
  ];

  for (const query of queries) {
    try {
      db.prepare(query).run();
      console.log(`Successfully executed: ${query}`);
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log(`Column already exists, skipping: ${error.message}`);
      } else {
        console.error(`Error executing query: ${error.message}`);
        process.exit(1);
      }
    }
  }

  console.log('Migration completed successfully!');
  db.close();
  process.exit(0);
}

runMigration();
