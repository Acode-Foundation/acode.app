function buildActiveWhere(deletedAtColumn, where = [], operator = 'AND') {
  let conditions = [];
  if (where.length) {
    conditions = Array.isArray(where[0]) ? where : [where];
  }

  if (operator === 'OR' && conditions.length) {
    const groupedConditions = conditions.flatMap((condition, index) => (index ? ['OR', condition] : [condition]));
    return [[deletedAtColumn, null], 'AND', ...groupedConditions];
  }

  return [[deletedAtColumn, null], ...conditions];
}

module.exports = buildActiveWhere;
