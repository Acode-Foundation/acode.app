import moment from 'moment';

export function since(date) {
  const now = moment().add(new Date().getTimezoneOffset(), 'minutes');
  return moment(date).from(now);
}
