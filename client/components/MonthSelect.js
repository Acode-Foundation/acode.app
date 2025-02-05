import moment from 'moment';

/**
 * Component for selecting month
 * @param {object} props
 * @param {(e: InputEvent)=>void} [props.onChange]
 * @param {Ref} [props.ref]
 * @returns {HTMLSelectElement}
 */
export default function MonthSelect({ onChange, ref }) {
  const currentMonth = moment().month();
  return <select ref={ref} attr-name="month" onchange={onChange} title='Month'>{
    moment.months().map(
      (month, i) => <option selected={currentMonth === i} value={i}>{month}</option>,
    )
  }</select>;
}
