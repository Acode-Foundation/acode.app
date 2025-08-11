const Entity = require('./entity');

const table = `create table if not exists sponsor (
  id integer primary key,
  name text not null,
  token text not null,
  email text not null,
  order_id text not null,
  amount integer,
  user_id integer,
  package_name text,
  website text,
  image text,
  tier text,
  public integer default 0,
  status integer default 2,
  created_at timestamp default current_timestamp,
  foreign key (user_id) references user(id) on delete set null
);`;

class Sponsor extends Entity {
  ID = 'id';
  NAME = 'name';
  TIER = 'tier';
  TOKEN = 'token';
  EMAIL = 'email';
  IMAGE = 'image';
  AMOUNT = 'amount';
  STATUS = 'status';
  PUBLIC = 'public';
  USER_ID = 'user_id';
  WEBSITE = 'website';
  ORDER_ID = 'order_id';
  CREATED_AT = 'created_at';
  PACKAGE_NAME = 'package_name';

  STATE_PURCHASED = 0;
  STATE_CANCELED = 1;
  STATE_PENDING = 2;

  constructor() {
    super(table);
  }

  get columns() {
    return [
      this.ID,
      this.NAME,
      this.TIER,
      this.TOKEN,
      this.EMAIL,
      this.IMAGE,
      this.AMOUNT,
      this.STATUS,
      this.PUBLIC,
      this.WEBSITE,
      this.USER_ID,
      this.ORDER_ID,
      this.CREATED_AT,
      this.PACKAGE_NAME,
    ];
  }

  get safeColumns() {
    return [this.ID, this.NAME, this.TIER, this.EMAIL, this.IMAGE, this.AMOUNT, this.STATUS, this.WEBSITE, this.CREATED_AT, this.PACKAGE_NAME];
  }
}

module.exports = new Sponsor();
