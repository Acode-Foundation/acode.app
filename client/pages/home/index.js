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

      {/* Hero Section */}
      <div className='hero'>
        <div className='hero-content'>
          <a href='https://github.com/acode-foundation/acode' className='hero-badge' target='_blank' rel='noopener noreferrer'>
            <span className='icon star' />
            <span>Open Source Code Editor</span>
          </a>
          <h1 className='hero-title'>
            Code Anywhere with <span className='gradient-text'>Acode</span>
          </h1>
          <p className='hero-subtitle'>
            An extensible, powerful and open-source code editor designed for Android. Write code on the go with a desktop-grade experience.
          </p>
          <div className='hero-actions'>
            <a
              title='Download Acode from Google Play store'
              className='store-badge play-store'
              href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
            >
              <span className='store-icon icon googleplay' />
              <div className='store-text'>
                <span className='store-label'>GET IT ON</span>
                <span className='store-name'>Google Play</span>
              </div>
            </a>
            <a
              title='Download Acode from F-Droid'
              rel='nofollow'
              className='store-badge fdroid'
              href='https://f-droid.org/en/packages/com.foxdebug.acode/'
            >
              <span className='store-icon icon f-droid' />
              <div className='store-text'>
                <span className='store-label'>AVAILABLE ON</span>
                <span className='store-name'>F-Droid</span>
              </div>
            </a>
          </div>
          <div className='gh-buttons'>
            <GhButton icon='star' url='https://github.com/acode-foundation/acode' title='Star' />
            <GhButton icon='repo-forked' url='https://github.com/acode-foundation/acode/fork' title='Fork' />
          </div>
        </div>
        <div className='hero-image'>
          <div className='device-frame'>
            <picture className='tablet'>
              <source srcset={tabletImageWebp} type='image/webp' />
              <img src={tabletImageJpg} alt='Acode on tablet' />
            </picture>
            <picture className='phone'>
              <source srcset={phoneImageWebp} type='image/webp' />
              <img src={phoneImageJpg} alt='Acode on phone' />
            </picture>
          </div>
          <div className='glow-effect' />
        </div>
      </div>

      {/* Stats Section */}
      <div className='stats-section'>
        <div className='stat-card'>
          <span className='stat-value'>{pluginCount}</span>
          <span className='stat-label'>Plugins Available</span>
        </div>
        <div className='stat-card'>
          <span className='stat-value'>50+</span>
          <span className='stat-label'>Languages Supported</span>
        </div>
        <div className='stat-card'>
          <span className='stat-value'>1M+</span>
          <span className='stat-label'>Active Users</span>
        </div>
      </div>

      {/* Features Section */}
      <div className='features-section'>
        <h2 className='section-title'>Why Choose Acode?</h2>
        <div className='features-grid'>
          <FeatureCard
            icon='create'
            title='Syntax Highlighting'
            description='Support for 50+ programming languages with beautiful syntax highlighting'
          />
          <FeatureCard icon='add' title='Plugin System' description='Extend functionality with a rich ecosystem of community plugins' />
          <FeatureCard icon='github' title='Git Integration' description='Built-in Git support for version control right from your device' />
          <FeatureCard icon='earth' title='FTP/SFTP Support' description='Connect to remote servers and edit files directly' />
        </div>
      </div>

      {/* Featured Plugins */}
      <div className='featured-plugins'>
        <h2 className='section-title'>Featured Plugins</h2>
        <p className='section-subtitle'>Explore our most popular plugins to enhance your coding experience</p>
        <ul className='featured-plugins__list'>{plugins}</ul>
        <a href='/plugins' className='btn btn-outline view-all'>
          View All Plugins
          <span className='icon navigate_next' />
        </a>
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

function FeatureCard({ icon, title, description }) {
  return (
    <div className='feature-card'>
      <div className='feature-icon'>
        <span className={`icon ${icon}`} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function Plugin({ data }) {
  const { name, icon, downloads, id } = data;

  return (
    <li onclick={() => window.open(`./plugin/${id}`)}>
      <div className='plugin-icon-wrapper'>
        <img src={icon} alt={`${name} Plugin`} />
      </div>
      <div className='plugin-info'>
        <h4>{name}</h4>
        <small>
          <span className='icon download' />
          {downloads?.toLocaleString()}
        </small>
      </div>
    </li>
  );
}
