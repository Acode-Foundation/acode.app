const Entity = require('./entity');

const table = `CREATE TABLE IF NOT EXISTS plugin (
  id TEXT,
  sku TEXT,
  name TEXT,
  version TEXT,
  user_id INTEGER,
  repository text,
  description TEXT,
  downloads TEXT DEFAULT '0',
  status INTEGER DEFAULT (0),
  created_at TIMESTAMP DEFAULT (current_timestamp),
  updated_at TIMESTAMP DEFAULT (current_timestamp), 
  status_change_message text, 
  status_change_date timestamp, 
  votes_up integer default 0, 
  votes_down integer default 0, 
  min_version_code INTEGER DEFAULT -1,
  price INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  CONSTRAINT PLUGIN_PK PRIMARY KEY (id),
  CONSTRAINT FK_plugin_user FOREIGN KEY (user_id) REFERENCES "user"(id)
);

create trigger if not exists plugin_updated_at
  after update on plugin
  for each row
  begin
    update plugin set updated_at = current_timestamp where id = old.id;
  end`;

class Plugin extends Entity {
  ID = 'id';
  SKU = 'sku';
  NAME = 'name';
  ICON = 'icon';
  PRICE = 'price';
  STATUS = 'status';
  AUTHOR = 'author';
  VERSION = 'version';
  USER_ID = 'user_id';
  VOTES_UP = 'votes_up';
  DOWNLOADS = 'downloads';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  VOTES_DOWN = 'votes_down';
  REPOSITORY = 'repository';
  DESCRIPTION = 'description';
  AUTHOR_EMAIL = 'author_email';
  COMMENT_COUNT = 'comment_count';
  AUTHOR_GITHUB = 'author_github';
  AUTHOR_WEBSITE = 'author_website';
  AUTHOR_VERIFIED = 'author_verified';
  MIN_VERSION_CODE = 'min_version_code';
  STATUS_CHANGE_DATE = 'status_change_date';
  STATUS_CHANGE_MESSAGE = 'status_change_message';

  STATUS_PENDING = 0;
  STATUS_APPROVED = 1;
  STATUS_REJECTED = 2;
  STATUS_INACTIVE = 3;

  constructor() {
    super(table);

    this.generateGetSql = this.generateGetSql.bind(this);
    this.getUsersWithPlugin = this.getUsersWithPlugin.bind(this);
  }

  /**
   * Generate the SQL for a get request
   * @param {string[]} columns
   * @param {import('./entity').WhereCondition} where
   * @param {any[]} values
   * @param {import('./entity').Pagination} options
   * @returns {string}
   */
  generateGetSql(columns, where, values, {
    page = Entity.default_page,
    limit = Entity.default_limit,
    orderBy = Entity.default_order_by,
    operator = Entity.default_operator,
  }) {
    let sql = `SELECT ${this.#initialColumns.join(',')} FROM ${this.table}`;

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    sql = `SELECT ${columns.join(',')} FROM (
      SELECT ${this.#pluginColumns.join(',')}
      FROM (${sql}) as p
      LEFT JOIN user as u ON p.user_id = u.id
      LEFT JOIN (
        SELECT c.plugin_id, COUNT(c.id) as comment_count 
        FROM comment as c 
        WHERE c.comment IS NOT NULL AND c.comment IS NOT ''
        GROUP BY c.plugin_id
      ) as c ON p.id = c.plugin_id
    )`;

    if (this.mode === 'api') {
      sql += ` ORDER BY ${Array.isArray(orderBy) ? orderBy.join(',') : orderBy} LIMIT ? OFFSET ?`;
      values.push(limit);
      values.push((page - 1) * limit);
    }

    return sql;
  }

  /**
   * Deletes rows from the table based on the where clause
   * @param {Array<[string, any, 'IN'|'=']>} where [column, value, operator?]
   * @param {'AND' | 'OR'} operator when there are multiple where clauses
   */
  delete(where, operator = 'AND') {
    return this.update(
      [this.STATUS, this.STATUS_INACTIVE],
      where,
      operator,
    );
  }

  deletePermanently(where, operator = 'AND') {
    return super.delete(where, operator);
  }

  getUsersWithPlugin() {
    const sql = `select 
    u.*, 
    p.id as payment_method_id, 
    p.paypal_email, 
    p.bank_account_holder, 
    p.bank_account_number,
    p.bank_account_type,
    p.bank_ifsc_code,
    p.bank_swift_code
    from (
      select * from user where id in (select user_id from ${this.table} group by user_id)
    ) u
    left join payment_method p on u.id = p.user_id and p.is_default = true`;

    return Entity.execSql(sql);
  }

  get minColumns() {
    return [
      this.ID,
      this.SKU,
      this.ICON,
      this.NAME,
      this.PRICE,
      this.VERSION,
      this.VOTES_UP,
      this.DOWNLOADS,
      this.REPOSITORY,
      this.VOTES_DOWN,
      this.COMMENT_COUNT,
      this.MIN_VERSION_CODE,
      this.AUTHOR_VERIFIED,
      this.USER_ID,
    ];
  }

  get allColumns() {
    return [
      ...this.minColumns,
      this.USER_ID,
      this.STATUS,
    ];
  }

  get #initialColumns() {
    return [
      this.ID,
      this.SKU,
      this.NAME,
      `IFNULL(${this.PRICE}, 0) as price`,
      this.VERSION,
      this.DESCRIPTION,
      this.USER_ID,
      this.CREATED_AT,
      this.UPDATED_AT,
      this.VOTES_DOWN,
      this.VOTES_UP,
      this.DOWNLOADS,
      this.MIN_VERSION_CODE,
      this.STATUS_CHANGE_MESSAGE,
      this.STATUS_CHANGE_DATE,
      this.REPOSITORY,
      'CASE WHEN status = 0 THEN \'pending\' WHEN status = 1 THEN \'approved\' WHEN status = 2 THEN \'rejected\' WHEN status = 3 THEN \'deleted\' END as status',
      `'${process.env.HOST}/plugin-icon/' || id as icon`,
    ];
  }

  get #pluginColumns() {
    return [
      'p.id as id',
      'p.sku as sku',
      'p.name as name',
      'p.price as price',
      'p.version as version',
      'p.user_id as user_id',
      'p.created_at as created_at',
      'p.updated_at as updated_at',
      'p.status as status',
      'p.min_version_code as min_version_code',
      'p.repository as repository',
      'p.status_change_message as status_change_message',
      'p.status_change_date as status_change_date',
      'p.downloads as downloads',
      'IFNULL(votes_up, 0) as votes_up',
      'IFNULL(votes_down, 0) as votes_down',
      'IFNULL(comment_count, 0) as comment_count',
      'p.icon as icon',
      'p.description as description',
      ...this.#authorColumns,
    ];
  }

  // eslint-disable-next-line class-methods-use-this
  get #authorColumns() {
    return [
      'u.name as author',
      'u.verified as author_verified',
      'IFNULL(u.github, \'\') as author_github',
      'IFNULL(u.website, \'\') as author_website',
      'u.email as author_email',
    ];
  }
}

module.exports = new Plugin();
