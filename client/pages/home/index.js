import './style.scss';

import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import background from 'lib/background';
import { hideLoading, showLoading } from 'lib/helpers';
import phoneImageJpg from 'res/phone.jpg';
import phoneImageWebp from 'res/phone.webp';
import tabletImageJpg from 'res/tablet.jpg';
import tabletImageWebp from 'res/tablet.webp';

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
      stars.value = '1.2k+';
      forks.value = '200+';
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
          <div className='stat-badge'>
            <span className='stat-number'>1M+</span>
            <span className='stat-label'>downloads</span>
          </div>
          <div className='download-buttons'>
            <a
              title='Download from Google Play'
              className='download-button play-store'
              href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
              target='_blank'
              rel='noopener'
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
                <title>Google Play</title>
                <path d='M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z' />
              </svg>
              <span>Google Play</span>
            </a>
            <a
              title='Download from F-Droid'
              className='download-button f-droid'
              href='https://f-droid.org/en/packages/com.foxdebug.acode/'
              target='_blank'
              rel='noopener'
            >
              <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
                <title>F-Droid</title>
                <path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z' />
              </svg>
              <span>F-Droid</span>
            </a>
          </div>
          <div className='gh-buttons'>
            <GhButton count={stars} url='https://github.com/acode-foundation/acode' title='Star' />
            <GhButton count={forks} url='https://github.com/acode-foundation/acode/fork' title='Fork' />
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

function GhButton({ url, title, count }) {
  return (
    <a href={url} className='gh-button-modern' target='_blank' rel='noopener'>
      <div className='gh-button-main'>
        <svg viewBox='0 0 16 16' width='14' height='14' fill='currentColor'>
          <title>GitHub</title>
          <path d='M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 01-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 010 8c0-4.42 3.58-8 8-8Z' />
        </svg>
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
