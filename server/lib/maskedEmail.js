/**
 * SQL for an email that keeps at most two characters of the local part. Anything that is not an email
 * is hidden completely, because old payment methods were saved without validation.
 * @param {string} column
 */
module.exports = function maskedEmail(column) {
  const at = `instr(${column}, '@')`;
  return `CASE
    WHEN ${column} IS NULL THEN NULL
    WHEN ${at} > 1 THEN substr(${column}, 1, min(2, ${at} - 1)) || '•••' || substr(${column}, ${at})
    ELSE '•••'
  END`;
};
