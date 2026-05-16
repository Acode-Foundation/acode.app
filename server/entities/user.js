const path = require('node:path');
const { config } = require('dotenv');
const { encryptPassword } = require('../password');
const Entity = require('./entity');

config({ path: path.resolve(__dirname, '../../.env') });

const table = `create table if not exists user (
  id integer primary key,
  name text not null,
  email text not null unique,
  github text,
  website text,
  role text default 'user',
  threshold integer default 1000,
  password text not null,
  verified boolean default false,
  acode_pro boolean default false,
  pro_purchase_token text,
  pro_purchased_at timestamp,
  github_id text unique,
  google_id text unique,
  avatar_url text,
  x text,
  linkedin text,
  primary_auth text default 'email',
  created_at timestamp default current_timestamp,
  updated_at timestamp default current_timestamp
);

create trigger if not exists user_updated_at
  after update on user
  for each row
  begin
    update user set updated_at = current_timestamp where id = old.id;
  end`;

class User extends Entity {
  ID = 'id';
  NAME = 'name';
  ROLE = 'role';
  EMAIL = 'email';
  GITHUB = 'github';
  WEBSITE = 'website';
  GITHUB_ID = 'github_id';
  GOOGLE_ID = 'google_id';
  AVATAR_URL = 'avatar_url';
  PRIMARY_AUTH = 'primary_auth';
  PASSWORD = 'password';
  VERIFIED = 'verified';
  THRESHOLD = 'threshold';
  ACODE_PRO = 'acode_pro';
  PRO_PURCHASE_TOKEN = 'pro_purchase_token';
  PRO_PURCHASED_AT = 'pro_purchased_at';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  X = 'x';
  LINKEDIN = 'linkedin';

  constructor() {
    super(table);
    this.init();
  }

  async init() {
    const admin = await this.get([this.EMAIL, process.env.ADMIN_EMAIL]);
    if (!admin.length) {
      this.insert(
        [this.ROLE, 'admin'],
        [this.NAME, process.env.ADMIN_NAME],
        [this.EMAIL, process.env.ADMIN_EMAIL],
        [this.GITHUB, process.env.ADMIN_GITHUB],
        [this.WEBSITE, process.env.ADMIN_WEBSITE],
        [this.PASSWORD, encryptPassword(process.env.ADMIN_PASSWORD)],
      );
    }
  }

  async delete(where, operator = 'AND') {
    const [row] = await this.get(this.allColumns, where, operator);
    if (!row) {
      throw new Error('User not found');
    }

    return super.delete(where, operator);
  }

  getUsersByFilter(filter) {
    let sql;
    switch (filter) {
      case 'with_plugins':
        sql = `SELECT DISTINCT u.name, u.email FROM user u
          INNER JOIN plugin p ON u.id = p.user_id
          WHERE u.role != 'admin' AND p.status != 3`;
        break;
      case 'with_paid_plugins':
        sql = `SELECT DISTINCT u.name, u.email FROM user u
          INNER JOIN plugin p ON u.id = p.user_id
          WHERE u.role != 'admin' AND p.price > 0 AND p.status != 3`;
        break;
      case 'with_payment':
        sql = `SELECT DISTINCT u.name, u.email FROM user u
          INNER JOIN payment pay ON u.id = pay.user_id
          WHERE u.role != 'admin' AND pay.status = 1`;
        break;
      default:
        sql = `SELECT name, email FROM user WHERE role != 'admin'`;
    }
    return Entity.execSql(sql, [], this);
  }

  async countUsersByFilter(filter) {
    let sql;
    switch (filter) {
      case 'with_plugins':
        sql = `SELECT COUNT(DISTINCT u.id) as count FROM user u
          INNER JOIN plugin p ON u.id = p.user_id
          WHERE u.role != 'admin' AND p.status != 3`;
        break;
      case 'with_paid_plugins':
        sql = `SELECT COUNT(DISTINCT u.id) as count FROM user u
          INNER JOIN plugin p ON u.id = p.user_id
          WHERE u.role != 'admin' AND p.price > 0 AND p.status != 3`;
        break;
      case 'with_payment':
        sql = `SELECT COUNT(DISTINCT u.id) as count FROM user u
          INNER JOIN payment pay ON u.id = pay.user_id
          WHERE u.role != 'admin' AND pay.status = 1`;
        break;
      default:
        sql = `SELECT COUNT(*) as count FROM user WHERE role != 'admin'`;
    }
    const [{ count }] = await Entity.execSql(sql, [], this);
    return count;
  }

  get columns() {
    return [
      this.X,
      this.ID,
      this.NAME,
      this.ROLE,
      this.EMAIL,
      this.GITHUB,
      this.WEBSITE,
      this.LINKEDIN,
      this.PASSWORD,
      this.VERIFIED,
      this.THRESHOLD,
      this.ACODE_PRO,
      this.GITHUB_ID,
      this.GOOGLE_ID,
      this.AVATAR_URL,
      this.CREATED_AT,
      this.UPDATED_AT,
      this.PRIMARY_AUTH,
      this.PRO_PURCHASED_AT,
      this.PRO_PURCHASE_TOKEN,
    ];
  }

  get safeColumns() {
    return [
      this.X,
      this.ID,
      this.NAME,
      this.ROLE,
      this.EMAIL,
      this.GITHUB,
      this.WEBSITE,
      this.VERIFIED,
      this.LINKEDIN,
      this.THRESHOLD,
      this.ACODE_PRO,
      this.GITHUB_ID,
      this.GOOGLE_ID,
      this.AVATAR_URL,
      this.CREATED_AT,
      this.UPDATED_AT,
      this.PRIMARY_AUTH,
      this.PRO_PURCHASED_AT,
    ];
  }

  get initialColumns() {
    return [
      this.X,
      this.ID,
      this.NAME,
      this.ROLE,
      this.EMAIL,
      this.VERIFIED,
      this.LINKEDIN,
      this.THRESHOLD,
      this.ACODE_PRO,
      this.PRO_PURCHASE_TOKEN,
      this.PRO_PURCHASED_AT,
      this.GITHUB_ID,
      this.GOOGLE_ID,
      this.PRIMARY_AUTH,
      this.AVATAR_URL,
      `IFNULL(github, '') as github`,
      `IFNULL(website, '') as website`,
      this.PASSWORD,
      this.CREATED_AT,
      this.UPDATED_AT,
    ];
  }
}

module.exports = new User();
