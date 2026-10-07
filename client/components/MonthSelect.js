import moment from 'moment';
import Select from './select';

/**
 * Component for selecting month
 * @param {object} props
 * @param {(e: Event)=>void} [props.onChange]
 * @param {Ref} [props.ref]
 */
export default function MonthSelect({ onChange, ref }) {
  const currentMonth = moment().month();
  const options = moment.months().map((month, i) => ({
    label: month,
    value: i,
  }));

  return <Select options={options} value={currentMonth} onChange={onChange} ref={ref} title='Month' />;
}
