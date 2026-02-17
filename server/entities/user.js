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
  PASSWORD = 'password';
  VERIFIED = 'verified';
  THRESHOLD = 'threshold';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';

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

  get columns() {
    return [
      this.ID,
      this.NAME,
      this.ROLE,
      this.EMAIL,
      this.GITHUB,
      this.WEBSITE,
      this.PASSWORD,
      this.VERIFIED,
      this.THRESHOLD,
      this.CREATED_AT,
      this.UPDATED_AT,
    ];
  }

  get safeColumns() {
    return [this.ID, this.NAME, this.ROLE, this.EMAIL, this.GITHUB, this.WEBSITE, this.VERIFIED, this.THRESHOLD, this.CREATED_AT, this.UPDATED_AT];
  }

  get initialColumns() {
    return [
      this.ID,
      this.NAME,
      this.ROLE,
      this.EMAIL,
      this.VERIFIED,
      this.THRESHOLD,
      `IFNULL(github, '') as github`,
      `IFNULL(website, '') as website`,
      this.PASSWORD,
      this.CREATED_AT,
      this.UPDATED_AT,
    ];
  }
}

module.exports = new User();
