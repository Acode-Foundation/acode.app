import './style.scss';

import { render } from 'github-buttons';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { hideLoading, showLoading } from 'lib/helpers';
import previewImage from 'res/preview.png';
import background from './background';

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
      <Screen>
        <h1>
          Acode - An extensible and <br /> powerful code editor for Android
        </h1>
        <div className='gh-buttons'>
          <GhButton icon='star' url='https://github.com/acode-foundation/acode' title='Star' />
          <GhButton icon='repo-forked' url='https://github.com/acode-foundation/acode/fork' title='Fork' />
        </div>
        <div className='preview-image'>
          <img src={previewImage} alt='Acode for android' />
        </div>
      </Screen>

      <Screen>
        <div className='features'>
          <h2>Features</h2>
          <ul className='features__list'>
            <li>Open source.</li>
            <li>Collection of {pluginCount} plugins.</li>
            <li>Edit any file from your device.</li>
            <li>GitHub &amp; FTP/SFTP support.</li>
          </ul>
        </div>
        <div className='featured-plugins'>
          <h2>Popular Plugins</h2>
          <ul className='featured-plugins__list'>{plugins}</ul>
        </div>
      </Screen>
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

function Screen({ className }, children) {
  const $mainHeader = tag.get('#main-header');
  const { height } = $mainHeader.getBoundingClientRect();
  className = `screen ${className || ''}`;
  return (
    <div className={className} style={{ minHeight: `calc(100vh - ${height - 32}px)` }}>
      {children}
    </div>
  );
}
