const Entity = require('./entity');

const table = `create table if not exists authentication_provider (
  id integer primary key,
  user_id integer not null,
  provider text not null,
  provider_user_id text not null,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  created_at timestamp default current_timestamp,
  updated_at timestamp default current_timestamp,
  foreign key (user_id) references user(id),
  unique(provider, provider_user_id)
);`;

class AuthenticationProvider extends Entity {
  ID = 'id';
  USER_ID = 'user_id';
  PROVIDER = 'provider';
  PROVIDER_USER_ID = 'provider_user_id';
  ACCESS_TOKEN = 'access_token';
  REFRESH_TOKEN = 'refresh_token';
  ACCESS_TOKEN_EXPIRES_AT = 'access_token_expires_at';
  REFRESH_TOKEN_EXPIRES_AT = 'refresh_token_expires_at';
  SCOPE = 'scope';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';

  constructor() {
    super(table);
  }

  get columns() {
    return [
      this.ID,
      this.USER_ID,
      this.PROVIDER,
      this.PROVIDER_USER_ID,
      this.ACCESS_TOKEN,
      this.REFRESH_TOKEN,
      this.ACCESS_TOKEN_EXPIRES_AT,
      this.REFRESH_TOKEN_EXPIRES_AT,
      this.SCOPE,
      this.CREATED_AT,
      this.UPDATED_AT,
    ];
  }
}

module.exports = new AuthenticationProvider();