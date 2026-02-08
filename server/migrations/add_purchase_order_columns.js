/**
 * Migration script to add user_id and provider columns to purchase_order table
 * Run this script once to update existing database schema
 *
 * Usage: node server/migrations/add_purchase_order_columns.js
 */

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('../lib/db');

async function runMigration() {
  console.log('Starting migration: Adding user_id and provider columns to purchase_order...');

  const queries = [
    // Add user_id column if it doesn't exist
    `ALTER TABLE purchase_order ADD COLUMN user_id INTEGER REFERENCES user(id)`,
    // Add provider column if it doesn't exist
    `ALTER TABLE purchase_order ADD COLUMN provider TEXT DEFAULT 'google_play'`,
  ];

  for (const query of queries) {
    try {
      await new Promise((resolve, reject) => {
        db.run(query, (err) => {
          if (err) {
            // Ignore "duplicate column name" errors
            if (err.message.includes('duplicate column name')) {
              console.log(`Column already exists, skipping: ${err.message}`);
              resolve();
            } else {
              reject(err);
            }
          } else {
            console.log(`Successfully executed: ${query}`);
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`Error executing query: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('Migration completed successfully!');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
      process.exit(1);
    }
    process.exit(0);
  });
}

runMigration();
