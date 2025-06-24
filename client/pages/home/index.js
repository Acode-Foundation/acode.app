import './style.scss';

import { render } from 'github-buttons';
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

  showLoading();

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
          <div className='gh-buttons'>
            <GhButton icon='star' url='https://github.com/acode-foundation/acode' title='Star' />
            <GhButton icon='repo-forked' url='https://github.com/acode-foundation/acode/fork' title='Fork' />
          </div>
          <div className='download-buttons'>
            <a
              title='Download Acode from Google Play store'
              className='play-store'
              href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
            >
              <span className='hidden'>Download from Google Play store</span>
            </a>
            <a title='Download Acode from F-Droid' rel='nofollow' className='f-droid' href='https://f-droid.org/en/packages/com.foxdebug.acode/'>
              <span className='hidden'>Download from F-Droid</span>
            </a>
          </div>
        </div>
      </div>

      <div className='download-buttons'>
        <a
          title='Download Acode from Google Play store'
          className='play-store'
          href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
        >
          <span className='hidden'>Download from Google Play store</span>
        </a>
        <a
          title='Download Acode from F-Droid'
          rel='nofollow'
          className='f-droid'
          href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
        >
          <span className='hidden'>Download from F-Droid</span>
        </a>
      </div>

      <div className='featured-plugins'>
        <p>Featured Plugins</p>
        <ul className='featured-plugins__list'>{plugins}</ul>
      </div>
    </section>
  );
}

function GhButton({ url, title, icon }) {
  const el = <div style={{ height: '20px' }} />;
  render(
    <a
      class='github-button'
      href={url}
      data-color-scheme='no-preference: dark_high_contrast; light: dark_high_contrast; dark: dark_high_contrast;'
      data-icon={`octicon-${icon}`}
      data-show-count='true'
      aria-label={title}
    >
      {title}
    </a>,
    (button) => {
      el.replaceWith(button);
    },
  );
  return el;
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
