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
  tagline text,
  tier text,
  public integer default 0,
  status integer default 2,
  created_at timestamp default current_timestamp,
  expires_at timestamp,
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
  TAGLINE = 'tagline';
  ORDER_ID = 'order_id';
  CREATED_AT = 'created_at';
  PACKAGE_NAME = 'package_name';

  EXPIRES_AT = 'expires_at';

  SPONSOR_TIER_CRYSTAL = 'crystal';
  SPONSOR_TIER_BRONZE = 'bronze';
  SPONSOR_TIER_SILVER = 'silver';
  SPONSOR_TIER_GOLD = 'gold';
  SPONSOR_TIER_PLATINUM = 'platinum';
  SPONSOR_TIER_TITANIUM = 'titanium';

  STATE_PURCHASED = 0;
  STATE_CANCELED = 1;
  STATE_PENDING = 2;

  get SPONSOR_TIERS() {
    return {
      crystal: { price: 100, label: 'Crystal', description: 'Get your name listed on our sponsors page' },
      bronze: { price: 200, label: 'Bronze', description: 'Get your name listed on our sponsors page as a supporter' },
      silver: { price: 500, label: 'Silver', description: 'Get your name and website link featured on the sponsors page' },
      gold: { price: 1000, label: 'Gold', description: 'Your logo, name, and website link featured on the sponsors page' },
      platinum: { price: 2000, label: 'Platinum', description: 'Premium placement with logo, name, website link, and tagline' },
      titanium: { price: 5000, label: 'Titanium', description: 'Premium placement, large logo, website link, and tagline' },
    };
  }

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
      this.TAGLINE,
      this.WEBSITE,
      this.USER_ID,
      this.ORDER_ID,
      this.CREATED_AT,
      this.EXPIRES_AT,
      this.PACKAGE_NAME,
    ];
  }

  get safeColumns() {
    return [
      this.ID,
      this.NAME,
      this.TIER,
      this.TAGLINE,
      this.IMAGE,
      this.AMOUNT,
      this.STATUS,
      this.WEBSITE,
      this.CREATED_AT,
      this.EXPIRES_AT,
      this.PACKAGE_NAME,
    ];
  }
}

module.exports = new Sponsor();
