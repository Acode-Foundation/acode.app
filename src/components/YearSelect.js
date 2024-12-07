import moment from 'moment';

/**
 * Component for selecting year
 * @param {object} props
 * @param {(e: InputEvent)=>void} [props.onChange]
 * @param {Ref} [props.ref]
 * @returns
 */
export default function YearSelect({ onChange, ref }) {
  const currentYear = moment().year();
  return <select ref={ref} attr-name="year" onchange={onChange} title='Year'>{
    (() => {
      // return list of years
      const MIN_YEAR = 2023;
      const MAX_YEAR = new Date().getFullYear();

      const options = [];
      for (let i = MIN_YEAR; i <= MAX_YEAR; i++) {
        options.push(
          <option selected={currentYear === i} value={i}>{i}</option>,
        );
      }
      return options;
    })()
  }</select>;
}
