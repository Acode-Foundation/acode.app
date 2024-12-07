const Entity = require('./entity');

const table = `create table if not exists comment (
  id integer primary key,
  plugin_id integer not null,
  user_id integer not null,
  flagged_by_author integer default 0,
  comment text not null,
  author_reply text,
  vote integer default 0,
  created_at datetime default current_timestamp,
  updated_at datetime default current_timestamp,
  foreign key (plugin_id) references plugin(id),
  foreign key (user_id) references user(id)
);

create trigger if not exists comment_updated_at
  after update on comment
  for each row
  begin
    update comment set updated_at = current_timestamp where id = old.id;
  end`;

class Comment extends Entity {
  ID = 'id';
  PLUGIN_ID = 'plugin_id';
  USER_ID = 'user_id';
  COMMENT = 'comment';
  VOTE = 'vote';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';
  FLAGGED_BY_AUTHOR = 'flagged_by_author';
  AUTHOR_REPLY = 'author_reply';

  VOTE_UP = 1;
  VOTE_DOWN = -1;
  VOTE_NULL = 0;
  FLAGGED = 1;
  NOT_FLAGGED = 0;

  constructor() {
    super(table);
  }

  get columns() {
    return [
      this.ID,
      this.PLUGIN_ID,
      this.USER_ID,
      this.COMMENT,
      this.VOTE,
      this.CREATED_AT,
      this.UPDATED_AT,
      this.AUTHOR_REPLY,
    ];
  }

  getVoteString(vote) {
    if (vote === this.VOTE_UP) return 'up';
    if (vote === this.VOTE_DOWN) return 'down';
    return null;
  }

  get allColumns() {
    return [
      ...this.columns,
      this.FLAGGED_BY_AUTHOR,
    ];
  }

  /**
   * Callback to generate the sql string of the get method
   * @param {Array<string>} columns
   * @param {WhereCondition} where
   * @param {[]} values
   * @param {import('./entity').Pagination} options
   * @returns {string}
   */
  generateGetSql(columns, where, values, {
    page = Entity.DEFAULT_PAGE,
    limit = Entity.DEFAULT_LIMIT,
    orderBy = Entity.DEFAULT_ORDER_BY,
    operator = Entity.DEFAULT_OPERATOR,
  }) {
    if (columns[0] === '*') columns = this.allColumns;
    let sql = `SELECT [${this.allColumns.join('], [')}] FROM ${this.table}`;

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    columns = columns.map((column) => {
      if (column === this.AUTHOR_REPLY) {
        return `IFNULL(${column}, '') AS ${column}`;
      }
      return `c.${column}`;
    });

    if (this.mode === 'api') {
      sql += ` ORDER BY ${Array.isArray(orderBy) ? orderBy.join(',') : orderBy} LIMIT ? OFFSET ?`;
      values.push(limit);
      values.push((page - 1) * limit);
    }

    sql = `SELECT ${columns.join(', ')}, u.[name], u.[github] 
    FROM (${sql}) c
    LEFT JOIN user u ON c.user_id = u.id;`;

    return sql;
  }

  isValidVote(vote) {
    return vote === this.VOTE_UP || vote === this.VOTE_DOWN || vote === this.VOTE_NULL;
  }
}

module.exports = new Comment();
