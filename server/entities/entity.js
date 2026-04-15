const db = require('../lib/db');

/**
 * @typedef {object} Pagination
 * @property {string | string[]} orderBy
 * @property {number} page
 * @property {number} limit
 * @property {'AND' | 'OR'} operator
 */

/**
 * @typedef {Array<[string, any, operator?]>} WhereCondition
 * @typedef {'api'|'internal'} QueryMode 'api' appends limit, order by and offset to the query,
 * 'internal' does not
 */

class Entity {
  static default_limit = 100;
  static default_page = 1;
  static default_order_by = 'created_at DESC';
  static default_operator = 'AND';

  /** @type {QueryMode} */
  #mode = 'api';
  /**
   *
   * @param {string} sql
   */
  constructor(sql) {
    try {
      db.exec(sql);
    } catch (err) {
      console.error('Failed to execute SQL:', sql, err);
    }
  }

  /**
   * Selects rows from the table
   * @param {
   * Array<string> |
   * WhereCondition |
   * GetOptions
   * } [columns] columns to select or where condition or options
   * @param {WhereCondition | Pagination} [where] [column, value, operator?]
   * @param {Pagination} [options] set limit and where clause operator
   * @returns {Promise<any[]>}
   */
  get(columns, where, options) {
    if (!Array.isArray(where) && typeof where === 'object') {
      options = where;
      where = columns;
      columns = ['*'];
    } else if (!where && columns) {
      if (!Array.isArray(columns) && typeof columns === 'object') {
        options = columns;
        columns = ['*'];
      } else {
        where = columns;
        columns = ['*'];
      }
    } else if (!columns) {
      columns = ['*'];
    }

    let limit = Entity.default_limit;
    let page = Entity.default_page;
    let orderBy = Entity.default_order_by;
    let operator = Entity.default_operator;

    if (typeof options === 'object') {
      ({ page = Entity.default_page, limit = Entity.default_limit, orderBy = Entity.default_order_by, operator = Entity.default_operator } = options);
    } else if (typeof options === 'string') {
      operator = options;
    }

    const values = [];
    const sql = this.generateGetSql(columns, where, values, {
      page,
      limit,
      orderBy,
      operator,
    });

    return Entity.execSql(sql, values, this);
  }

  /**
   * Callback to extend the sql string of the get method
   * @param {string} sql
   */
  // eslint-disable-next-line class-methods-use-this
  extendGetSql(sql) {
    return sql;
  }

  /**
   * Callback to generate the sql string of the get method
   * @param {Array<string>} columns
   * @param {WhereCondition} where
   * @param {[]} values
   * @param {Pagination} options
   * @returns {string}
   */
  generateGetSql(
    columns,
    where,
    values,
    { page = Entity.default_page, limit = Entity.default_limit, orderBy = Entity.default_order_by, operator = Entity.default_operator },
  ) {
    let sql = `SELECT ${columns.join(',')} FROM ${this.table}`;

    if (this.initialColumns) {
      sql = `SELECT ${this.initialColumns.join(',')} FROM ${this.table}`;
    }

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    if (this.mode === 'api') {
      sql += ` ORDER BY ${Array.isArray(orderBy) ? orderBy.join(',') : orderBy} LIMIT ? OFFSET ?`;
      values.push(limit);
      values.push((page - 1) * limit);
    }

    sql = this.extendGetSql(sql, values);

    if (this.initialColumns) {
      sql = `SELECT ${columns.join(',')} FROM (${sql})`;
    }

    return sql;
  }

  /**
   *
   * @param {Array<[string, any, operator?]>} where [column, value, operator?]
   * @param {'AND' | 'OR'} options
   * @returns {Promise<number>}
   */
  async count(where, options = 'AND') {
    let sql = `SELECT COUNT(*) as count FROM ${this.table}`;
    const values = [];

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, options, values)}`;
    }

    const { count } = await Entity.execSqlGet(sql, values, this);
    return count;
  }

  /**
   *
   * @param {...[string, string]} columns
   */
  insert(...columns) {
    let sql = `INSERT INTO ${this.table}`;
    const fields = [];
    const values = [];

    for (const [column, value] of columns) {
      fields.push(column);
      values.push(value);
    }

    sql += ` (${fields.join(', ')})`;
    sql += ` VALUES (${values.map(() => '?').join(', ')})`;

    return Entity.execSql(sql, values, this);
  }

  insertOrIgnore(...columns) {
    let sql = `INSERT OR IGNORE INTO ${this.table}`;
    const fields = [];
    const values = [];

    for (const [column, value] of columns) {
      fields.push(column);
      values.push(value);
    }

    sql += ` (${fields.join(', ')})`;
    sql += ` VALUES (${values.map(() => '?').join(', ')})`;

    return Entity.execSql(sql, values, this);
  }

  /**
   * Updates rows in the table based on the where clause
   * @param {Array<[string, string]>} columns  [column, value]
   * @param {Array<[string, any, 'IN'|'=']>} where [column, value, operator?]
   * @param {'AND' | 'OR'} operator when there are multiple where clauses
   */
  update(columns, where, operator = 'AND') {
    const [firstColumn] = columns;

    if (!Array.isArray(firstColumn)) {
      columns = [columns];
    }

    let sql = `UPDATE ${this.table}`;

    const fields = [];
    const values = [];

    for (const [column, value] of columns) {
      if (value === undefined) continue;
      fields.push(column);
      values.push(value);
    }

    if (!fields.length) return Promise.resolve();
    sql += ` SET ${fields.map((field) => `${field} = ?`).join(', ')}`;

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    return Entity.execSql(sql, values, this);
  }

  /**
   * Increments a column by a value
   * @param {string} column
   * @param {number} value
   * @param {WhereCondition} where
   * @param {'AND'|'OR'} operator
   * @returns
   */
  increment(column, value, where, operator = 'AND') {
    let sql = `UPDATE ${this.table} SET ${column} = ${column} + ?`;

    const values = [value];

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    return Entity.execSql(sql, values, this);
  }

  /**
   * Decrements a column by a value
   * @param {string} column
   * @param {number} value
   * @param {WhereCondition} where
   * @param {'AND'|'OR'} operator
   * @returns
   */
  decrement(column, value, where, operator = 'AND') {
    const values = [value];
    let sql = `UPDATE ${this.table} SET ${column} = ${column} - ?`;

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    return Entity.execSql(sql, values, this);
  }

  /**
   * Deletes rows from the table based on the where clause
   * @param {Array<[string, any, 'IN'|'=']>} where [column, value, operator?]
   * @param {'AND' | 'OR'} operator when there are multiple where clauses
   */
  delete(where, operator = 'AND') {
    const values = [];
    let sql = `DELETE FROM ${this.table}`;

    if (Entity.isValidWhere(where)) {
      sql += ` WHERE ${Entity.formatWhere(where, operator, values)}`;
    }

    return Entity.execSql(sql, values, this);
  }

  /**
   * Formats an array of where clauses into a string
   * @param {Array<[string, any, string]>} where
   */
  static formatWhere(where, operator = 'AND', values = []) {
    let result = '';
    let closeBracket = false;
    const [firstClause] = where;

    if (!Array.isArray(firstClause)) {
      where = [where];
    }

    where.forEach((condition, i) => {
      if (typeof condition === 'string') {
        return;
      }

      const nextOperator = where[i + 1];

      if (nextOperator && typeof nextOperator === 'string') {
        let clause = ` ${formatCondition(condition)} ${nextOperator} `;

        if (!closeBracket && /OR/i.test(nextOperator)) {
          clause = ` ( ${clause}`;
          closeBracket = true;
        }

        result += clause;
      } else {
        result += ` ${formatCondition(condition)} `;
        if (closeBracket) {
          result += ') ';
          closeBracket = false;
        }

        result += ` ${operator} `;
      }
    });

    result = result.trim();
    if (result.endsWith(operator)) {
      result = result.slice(0, -operator.length);
    }

    return ` (${result}) `;

    function formatCondition([column, value, whereOperator]) {
      if (Array.isArray(value)) {
        whereOperator = whereOperator || 'IN';
        if (whereOperator === 'IN' || whereOperator === 'NOT IN') {
          values.push(...value);
          return `${column} ${whereOperator} (${value.map(() => '?').join(', ')})`;
        }

        if (whereOperator === 'BETWEEN') {
          values.push(value[0], value[1]);
          return `${column} BETWEEN ? AND ?`;
        }

        throw new Error(`Invalid operator ${whereOperator} for array value`);
      }

      if (whereOperator === 'LIKE' || whereOperator === 'NOT LIKE') {
        values.push(`%${value}%`);
      } else {
        if (!whereOperator) {
          if (value === null) {
            whereOperator = 'IS';
          } else {
            whereOperator = '=';
          }
        }
        values.push(value);
      }

      return `${column} ${whereOperator} ?`;
    }
  }

  static isValidWhere(where) {
    return Array.isArray(where) && where.length;
  }

  /**
   *
   * @param {string} sql
   * @param {string[]} values
   * @param {Entity} entity
   */
  static execSql(sql, values, entity) {
    return new Promise((resolve, reject) => {
      try {
        const stmt = db.prepare(sql);
        let result;
        if (stmt.reader) {
          result = stmt.all(...values);
        } else {
          // (if needed, in future) `result` could be set as { rows: [], changes: ..., lastInsertRowid: ... }
          // for now, we'll just set it as an empty array
          stmt.run(...values);
          result = [];
        }
        resolve(result);
      } catch (err) {
        console.log('Table:', entity.table);
        console.log('Error:', err.message, err.stack);
        console.log('SQL:', sql);
        console.log('Values:', values);
        err.message = `table<${entity.table}> sql execution failed.`;
        reject(err);
      }
    });
  }

  /**
   *
   * @param {string} sql
   * @param {string[]} values
   * @param {Entity} entity
   */
  static execSqlGet(sql, values, entity) {
    return new Promise((resolve, reject) => {
      try {
        const row = db.prepare(sql).get(...values);
        resolve(row);
      } catch (err) {
        err.message = `<${entity.table}>\n${err.message}`;
        reject(err);
      }
    });
  }

  /**
   * Use this method to set the mode for the query
   * @param {QueryMode} mode
   * @returns {Entity}
   */
  for(mode) {
    this.mode = mode;
    return this;
  }

  get table() {
    // convert pascal case to snake case
    return this.constructor.name
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .slice(1);
  }

  get mode() {
    const res = this.#mode;
    // change the mode every time it's accessed so it defaults to 'api' next time
    // this will not require to set the mode for api calls and we can set it to internal
    // when we need to use it internally
    this.#mode = 'api';
    return res;
  }

  /**
   * @param {QueryMode} value
   */
  set mode(value) {
    this.#mode = value;
  }
}

module.exports = Entity;
