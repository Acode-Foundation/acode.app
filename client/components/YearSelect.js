import moment from 'moment';
import Select from './select';

/**
 * Component for selecting year
 * @param {object} props
 * @param {(e: Event)=>void} [props.onChange]
 * @param {Ref} [props.ref]
 */
export default function YearSelect({ onChange, ref }) {
  const currentYear = moment().year();
  const MIN_YEAR = 2023;
  const MAX_YEAR = new Date().getFullYear();

  const options = [];
  for (let i = MIN_YEAR; i <= MAX_YEAR; i++) {
    options.push({ label: String(i), value: i });
  }

  return <Select options={options} value={currentYear} onChange={onChange} ref={ref} title='Year' />;
}
