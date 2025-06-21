import './style.scss';

/**
 * Loading component that displays three dots to indicate loading state.
 * @param {object} props
 * @param {StyleList} [props.style={}]
 * @returns
 */
export default function DotsLoading({ style }) {
  return (
    <div className='dots-loading' style={style}>
      <span className='dot' />
      <span className='dot' />
      <span className='dot' />
    </div>
  );
}
