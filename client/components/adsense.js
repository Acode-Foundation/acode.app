import DotsLoading from './dots';

const nameMap = {
  plugin: {
    slot: '5581360041',
    layout: '',
    layoutKey: '-eg+0+3d-4r-3z',
  },
  readme: {
    slot: '9580584302',
    layout: 'in-article',
    layoutKey: '',
  },
};

/**
 * AdSense component for displaying Google AdSense ads.
 * @param {object} props
 * @param {string} [props.className='']
 * @param {keyof typeof nameMap} [props.name='']
 * @param {StyleList} [props.style={}]
 * @param {Ref} [props.ref=Ref()]
 * @returns
 */
export default function AdSense({ className = '', name = 'plugin', style = {}, ref }) {
  setTimeout(() => {
    window.adsbygoogle.push({});
  }, 0);

  return (
    <div className={className} style={{ zIndex: '1', ...style }} ref={ref}>
      <ins
        className='adsbygoogle'
        style={{ display: 'block', zIndex: 1, position: 'relative' }}
        data-ad-client='ca-pub-5911839694379275'
        data-ad-slot={nameMap[name].slot}
        data-ad-format='fluid'
        data-full-width-responsive='true'
        data-ad-layout={nameMap[name].layout}
        data-ad-layout-key={nameMap[name].layoutKey}
      />
      <DotsLoading style={{ zIndex: 0 }} />
    </div>
  );
}
