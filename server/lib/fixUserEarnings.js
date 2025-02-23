/* eslint-disable no-console */
require('dotenv').config();
const moment = require('moment');
const UserEarnings = require('../entities/userEarnings');
const Plugin = require('../entities/plugin');
const calcEarnings = require('./calcEarnings');

const now = moment();

// previous month (0-11) and year
const [currentYear, currentMonth] = previous(now.year(), now.month());
const minYear = 2023;
const minMonth = 0;

/**
 * Get previous month and year
 * @param {number} year Year
 * @param {number} month Month (0-11)
 */
function previous(year, month) {
  if (month === 0) {
    return [year - 1, 11];
  }
  return [year, month - 1];
}

/**
 * Update earnings for given month and year
 * @param {number} year
 * @param {number} month month (0-11)
 */
async function fixUserEarnings() {
  try {
    const users = await Plugin.getUsersWithPlugin();

    users.forEach(async (usr) => {
      const rows = await UserEarnings.get([[UserEarnings.USER_ID, usr.id]]);
      fixUser(usr, rows);
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function fixUser(user, earningsRows, year = currentYear, month = currentMonth) {
  const earnings = await calcEarnings.total(year, month, user);

  if (earnings) {
    const row = earningsRows.find((r) => r.user_id === user.id && r.year === year && r.month === month);

    if (!row) {
      console.log(`user: ${user.name} (${user.id}) was missing earnings for ${year}-${month}`);
      await UserEarnings.insert(
        [UserEarnings.USER_ID, user.id],
        [UserEarnings.YEAR, year],
        [UserEarnings.MONTH, month],
        [UserEarnings.AMOUNT, earnings],
      );
    } else if (row.amount !== earnings) {
      console.log(`user: ${user.name} (${user.id}) had wrong earnings for ${year}-${month}`);
      await UserEarnings.update([UserEarnings.AMOUNT, earnings], [UserEarnings.ID, row.id]);
    }
  }

  [year, month] = previous(year, month);
  if (year < minYear || (year === minYear && month < minMonth)) return;
  fixUser(user, earningsRows, year, month);
}

fixUserEarnings();
