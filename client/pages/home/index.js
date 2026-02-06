import './style.scss';

import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { hideLoading, showLoading } from 'lib/helpers';
import phoneImageJpg from 'res/phone.jpg';
import phoneImageWebp from 'res/phone.webp';
import tabletImageJpg from 'res/tablet.jpg';
import tabletImageWebp from 'res/tablet.webp';
import icons from './icons';

export default async function home() {
  const canvas = Ref();
  const pluginCount = Reactive('...');
  const stars = Reactive('...');
  const forks = Reactive('...');

  showLoading();

  fetch('https://api.github.com/repos/acode-foundation/acode')
    .then((res) => res.json())
    .then((data) => {
      stars.value = `${(data.stargazers_count / 1000).toFixed(1)}k`;
      forks.value = data.forks_count.toLocaleString();
    })
    .catch(() => {
      stars.value = '4k+';
      forks.value = '700+';
    });

  let plugins = [];
  try {
    const { count } = await (await fetch('/api/plugins/count')).json();
    const pluginIds = await (await fetch('/api/plugins?limit=4&sort=downloads')).json();

    pluginCount.value = count.toLocaleString();
    plugins = await Promise.all(pluginIds.map(async (plugin) => <Plugin data={plugin} />));
  } catch (_error) {
    // ignore
  }

  canvas.onref = () => background(canvas.el);
  hideLoading();

  return (
    <section id='home'>
      <canvas ref={canvas} id='background' />
      <div className='intro'>
        <div className='preview-image'>
          <picture className='phone'>
            <source srcset={phoneImageWebp} type='image/webp' />
            <img src={phoneImageJpg} alt='Acode on phone' />
          </picture>
          <picture className='tablet'>
            <source srcset={tabletImageWebp} type='image/webp' />
            <img src={tabletImageJpg} alt='Acode on tablet' />
          </picture>
        </div>
        <div className='heading'>
          <p>An extensible, powerful and open-source code editor for Android</p>
          <div className='download-buttons'>
            <a
              title='Download from Google Play'
              className='download-button play-store'
              href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
              target='_blank'
              rel='noopener'
            >
              <span className='icon googleplay'></span>
              <span>Google Play</span>
            </a>
            <a
              title='Download from F-Droid'
              className='download-button f-droid'
              href='https://f-droid.org/en/packages/com.foxdebug.acode/'
              target='_blank'
              rel='noopener'
            >
              <span className='icon f-droid'></span>
              <span>F-Droid</span>
            </a>
          </div>
          <div className='gh-buttons'>
            <GhButton count='5m+' url='https://github.com/acode-foundation/acode/releases' title='Downloads' icon='download' />
            <GhButton count={stars} url='https://github.com/acode-foundation/acode' title='Stars' icon='star' />
            <GhButton count={forks} url='https://github.com/acode-foundation/acode/fork' title='Forks' icon='fork' />
          </div>
        </div>
      </div>

      <div className='featured-plugins'>
        <div className='section-header'>
          <h2>Featured Plugins</h2>
          <a href='/plugins' className='see-all'>
            Browse all <span className='icon chevron-right' />
          </a>
        </div>
        <ul className='featured-plugins__list'>{plugins}</ul>
      </div>
    </section>
  );
}

/**
 * GitHub button component to display stars, forks, and downloads.
 * @param {object} props
 * @param {string} props.url
 * @param {string} props.title
 * @param {string} props.count
 * @param {'github'|'fork'|'download'|'star'} [props.icon]
 * @returns
 */
async function GhButton({ url, title, count, icon = 'github' }) {
  return (
    <a href={url} className='gh-button-modern' target='_blank' rel='noopener'>
      <div className='gh-button-main'>
        {icons[icon] ?? <span className={`icon ${icon}`} />}
        <span>{title}</span>
      </div>
      <div className='gh-button-count'>{count}</div>
    </a>
  );
}

function Plugin({ data }) {
  const { name, icon, downloads, id } = data;

  return (
    <li onclick={() => window.open(`./plugin/${id}`)}>
      <img src={icon} alt={`${name} Plugin`} />
      <h4>{name}</h4>
      <small>{downloads?.toLocaleString()} downloads</small>
    </li>
  );
}
