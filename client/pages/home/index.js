import './style.scss';

import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { fetchSponsorMix } from 'lib/sponsors';
import { TIER_ORDER } from 'lib/sponsorTiers';
import shotAgentJpg from 'res/acode-shot-agent.jpg';
import shotAgentWebp from 'res/acode-shot-agent.webp';
import shotEditorJpg from 'res/acode-shot-editor.jpg';
import shotEditorWebp from 'res/acode-shot-editor.webp';
import shotPanesJpg from 'res/acode-shot-panes.jpg';
import shotPanesWebp from 'res/acode-shot-panes.webp';
import shotTerminalJpg from 'res/acode-shot-terminal.jpg';
import shotTerminalWebp from 'res/acode-shot-terminal.webp';

const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1';
const FDROID_URL = 'https://f-droid.org/en/packages/com.foxdebug.acode/';
const GITHUB_URL = 'https://github.com/acode-foundation/acode';
const CONTRIBUTORS_URL = 'https://api.github.com/repos/acode-foundation/acode/contributors?per_page=30';

export default function home() {
  const pluginCount = Reactive('250+');
  const stars = Reactive('…');
  const forks = Reactive('…');
  const pluginsMount = Ref();
  const sponsorsMount = Ref();
  const contributorsMount = Ref();

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

  loadPlugins(pluginsMount, pluginCount);
  loadSponsors(sponsorsMount);
  loadContributors(contributorsMount);

  return (
    <section id='home'>
      <div className='home-atmosphere' aria-hidden='true' />

      <div className='home-hero'>
        <h1>
          Code on{' '}
          <span className='home-brand-word' role='img' aria-label='Android'>
            <LogoA />
            {'ndroid.'}
          </span>
        </h1>
        <p className='home-lede'>An extensible, powerful and open-source code editor for Android, with a Linux terminal and AI agents.</p>
        <div className='home-actions'>
          <a className='home-btn home-btn-primary' href={PLAY_URL} target='_blank' rel='noopener'>
            <span className='icon googleplay' />
            Google Play
          </a>
          <a className='home-btn home-btn-ghost' href={FDROID_URL} target='_blank' rel='noopener'>
            <span className='icon f-droid' />
            F-Droid
          </a>
          <a className='home-btn-text' href={GITHUB_URL} target='_blank' rel='noopener'>
            <span className='icon github' />
            GitHub
          </a>
        </div>
      </div>

      <div className='home-gallery'>
        <Shot
          className='home-gallery__stage'
          webp={shotAgentWebp}
          jpg={shotAgentJpg}
          alt='Acode on a tablet running OpenCode beside the project file tree'
          kicker='AI agents'
          caption='OpenCode in a pane. The file tree stays in view.'
          width={1800}
          height={942}
          priority={true}
        />
        <div className='home-gallery__devices'>
          <Shot
            className='home-gallery__phone'
            webp={shotEditorWebp}
            jpg={shotEditorJpg}
            alt='Acode editor showing TypeScript hover documentation'
            kicker='Editor & LSP'
            caption='Hover docs and completions.'
            width={720}
            height={1387}
          />
          <Shot
            className='home-gallery__phone'
            webp={shotTerminalWebp}
            jpg={shotTerminalJpg}
            alt='Acode Linux terminal installing npm packages'
            kicker='Linux terminal'
            caption='Alpine. apk, npm, git, python.'
            width={720}
            height={1387}
          />
        </div>
      </div>

      <ul className='home-proof'>
        <li>
          <span>5m+</span> downloads
        </li>
        <li>
          <a href={GITHUB_URL} target='_blank' rel='noopener'>
            <span>{stars}</span> stars
          </a>
        </li>
        <li>
          <a href={`${GITHUB_URL}/fork`} target='_blank' rel='noopener'>
            <span>{forks}</span> forks
          </a>
        </li>
        <li>
          <a href='/plugins'>
            <span>{pluginCount}</span> plugins
          </a>
        </li>
      </ul>

      <div className='home-panes'>
        <div className='home-panes__copy'>
          <h2>Split the workspace.</h2>
          <p>Editors, config, and a Linux terminal in one view. Arrange panes the way you would on a desktop.</p>
        </div>
        <Shot
          className='home-panes__shot'
          webp={shotPanesWebp}
          jpg={shotPanesJpg}
          alt='Acode with four split panes: Dockerfile, JSON, config.xml, and an Alpine Linux terminal'
          caption='Dockerfile · JSON · config.xml · Alpine terminal'
          width={1800}
          height={951}
        />
      </div>

      <div className='home-capabilities'>
        <article>
          <h3>Linux terminal</h3>
          <p>Alpine Linux on-device. apk, npm, git, python, node — the same CLI you use at a desk.</p>
        </article>
        <article>
          <h3>SSH terminal</h3>
          <p>A real shell on the remote box, in a pane beside the editor. Multiple sessions. The files stay on the server.</p>
        </article>
        <article>
          <h3>File tree & LSP</h3>
          <p>A project sidebar, not a file picker. Completions, go to definition, and diagnostics from language servers.</p>
        </article>
        <article>
          <h3>AI agents</h3>
          <p>Claude Code, Codex, and OpenCode inside the editor. Your repo, your terminal, your model.</p>
        </article>
        <article>
          <h3>Change anything</h3>
          <p>Keymaps, themes, extra keys, commands, the UI. Nothing is locked. If you can think it, you can wire it.</p>
        </article>
        <article>
          <h3>Plugins</h3>
          <p>Language servers, formatters, themes, tools — install them, or write them. The API is public.</p>
        </article>
      </div>

      <div ref={contributorsMount} hidden />
      <div ref={pluginsMount} hidden />
      <div ref={sponsorsMount} hidden />

      <div className='home-cta'>
        <h2>
          Get{' '}
          <span className='home-brand-word' role='img' aria-label='Acode'>
            <LogoA />
            {'code'}
          </span>
        </h2>
        <p>Free on Google Play and F-Droid. Open source.</p>
        <div className='home-actions'>
          <a className='home-btn home-btn-primary' href={PLAY_URL} target='_blank' rel='noopener'>
            <span className='icon googleplay' />
            Google Play
          </a>
          <a className='home-btn home-btn-ghost' href={FDROID_URL} target='_blank' rel='noopener'>
            <span className='icon f-droid' />
            F-Droid
          </a>
        </div>
      </div>
    </section>
  );
}

function LogoA() {
  return (
    <span className='home-logo-a' aria-hidden='true'>
      <svg viewBox='685 334 543 409' aria-hidden='true' focusable='false'>
        <path
          fill='currentColor'
          d='M901.06 368.39c1.54-9.11 9.61-17.98 16.49-17.98h42.28c9.31 0 17.81 11.45 15 25.95-16.32 84.09-48.75 253.82-63.92 334.21-2.15 11.4-10.51 17.02-16.04 17.02h-36.49c-7.06 0-17.09-9.66-15.71-17.67 18.15-105.18 43.83-255.62 58.39-341.53z'
        />
        <path
          fill='currentColor'
          d='M1011.84 367.92c-1.54-9.11-9.61-17.98-16.49-17.98h-42.28c-9.31 0-17.81 11.45-15 25.95 16.32 84.09 48.75 253.82 63.92 334.21 2.15 11.4 10.51 17.02 16.04 17.02h36.49c7.06 0 17.09-9.66 15.71-17.67-18.14-105.18-43.81-255.63-58.39-341.53z'
        />
        <path
          fill='currentColor'
          d='M789.67 546.46c4.64-4.84 53.34-55.72 70.25-72.53 6.23-6.19 6.23-16.45 3.45-23.32-2.17-5.36-8.75-11.32-15.15-11.29h-46.31c-4.16 0-7.87 2.18-11.59 5.95-20.31 20.55-59 60.43-80.61 83.36-1.44 1.52-2.93 2.88-4.1 4.12-3.54 3.75-4.64 8.13-4.84 11.56-.09.93-.13 1.8-.15 2.58-.09 3.59.81 8.86 4.99 13.27 1.17 1.24 2.66 2.6 4.1 4.12 21.61 22.93 60.3 62.81 80.61 83.36 3.72 3.77 7.43 5.95 11.59 5.95h46.31c6.4.03 12.98-5.93 15.15-11.29 2.78-6.87 2.78-17.13-3.45-23.32-16.91-16.81-65.61-67.69-70.25-72.53z'
        />
        <path
          fill='currentColor'
          d='M1123.02 545.88c-4.64-4.84-53.34-55.72-70.25-72.53-6.23-6.19-6.23-16.45-3.45-23.32 2.17-5.36 8.75-11.32 15.15-11.29h46.31c4.16 0 7.87 2.18 11.59 5.95 20.31 20.55 59 60.43 80.61 83.36 1.44 1.52 2.93 2.88 4.1 4.12 3.54 3.75 4.64 8.13 4.84 11.56.09.93.13 1.8.15 2.58.09 3.59-.81 8.86-4.99 13.27-1.17 1.24-2.66 2.6-4.1 4.12-21.61 22.93-60.3 62.81-80.61 83.36-3.72 3.77-7.43 5.95-11.59 5.95h-46.31c-6.4.03-12.98-5.93-15.15-11.29-2.78-6.87-2.78-17.13 3.45-23.32 16.91-16.81 65.61-67.69 70.25-72.53z'
        />
      </svg>
    </span>
  );
}

function attach(ref, node) {
  const apply = (el) => {
    if (el?.isConnected) el.replaceWith(node);
  };

  if (ref.el) apply(ref.el);
  else ref.onref = apply;
}

async function loadPlugins(mount, pluginCount) {
  try {
    const { count } = await (await fetch('/api/plugins/count')).json();
    pluginCount.value = count.toLocaleString();
    const pluginIds = await (await fetch('/api/plugins?limit=12&orderBy=downloads')).json();
    if (!Array.isArray(pluginIds) || pluginIds.length === 0) return;

    attach(
      mount,
      <div className='featured-plugins'>
        <div className='featured-plugins__intro'>
          <div>
            <h2>Growing plugin ecosystem</h2>
            <p>Language servers, themes, formatters, and tools — or write your own.</p>
          </div>
          <a href='/plugins' className='see-all'>
            View all plugins <span className='icon chevron-right' />
          </a>
        </div>
        <div className='featured-plugins__fade'>
          <ul className='featured-plugins__list'>
            {pluginIds.map((plugin) => (
              <Plugin data={plugin} />
            ))}
          </ul>
        </div>
      </div>,
    );
  } catch {
    // ignore
  }
}

async function loadSponsors(mount) {
  try {
    const sponsors = await fetchSponsorMix({ totalLimit: 6, expiredLimit: 6 });
    if (!sponsors.length) return;

    const allExpired = sponsors.every((sponsor) => sponsor.expired);
    sponsors.sort((a, b) => Number(a.expired) - Number(b.expired) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));

    attach(
      mount,
      <div className='sponsors-section'>
        <div className='section-header'>
          <h2>{allExpired ? 'Previous sponsors' : 'Sponsors'}</h2>
          <a href='/sponsors' className='see-all'>
            View all <span className='icon chevron-right' />
          </a>
        </div>
        <div className='sponsors-grid'>{sponsors.map(renderSponsorCard)}</div>
      </div>,
    );
  } catch {
    // ignore
  }
}

async function loadContributors(mount) {
  try {
    const contributorList = await (await fetch(CONTRIBUTORS_URL)).json();
    if (!Array.isArray(contributorList)) return;

    const contributors = contributorList.filter((person) => person?.login && !person.login.includes('[bot]')).slice(0, 24);
    if (!contributors.length) return;

    attach(
      mount,
      <div className='home-contributors'>
        <h2>Built in the open.</h2>
        <p>Acode is MIT-licensed. These are some of the people who ship it.</p>
        <div className='home-contributors__faces'>
          {contributors.map((person) => (
            <a href={person.html_url} target='_blank' rel='noopener' title={person.login}>
              <img src={avatarUrl(person.avatar_url)} alt={person.login} width='40' height='40' loading='lazy' />
            </a>
          ))}
        </div>
        <a className='home-contributors__link' href={GITHUB_URL} target='_blank' rel='noopener'>
          <span className='icon github' />
          View the repo
        </a>
      </div>,
    );
  } catch {
    // ignore
  }
}

function avatarUrl(url) {
  if (!url) return '';
  return `${url}${url.includes('?') ? '&' : '?'}s=80`;
}

function Shot({ className, webp, jpg, alt, kicker, caption, width, height, priority }) {
  return (
    <figure className={className}>
      <div className='home-shot-frame'>
        <picture>
          <source srcset={webp} type='image/webp' />
          <img
            src={jpg}
            alt={alt}
            width={width}
            height={height}
            decoding={priority ? 'sync' : 'async'}
            fetchpriority={priority ? 'high' : 'low'}
            loading={priority ? 'eager' : 'lazy'}
          />
        </picture>
      </div>
      {kicker || caption ? (
        <figcaption>
          {kicker ? <strong>{kicker}</strong> : null}
          {caption ? <span>{caption}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function ensureAbsoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `https://${url}`;
}

function renderSponsorCard(sponsor) {
  const { id, name, tier, tagline, website, image, expired } = sponsor;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const hasImage = ['gold', 'platinum', 'titanium'].includes(tier);
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const Tag = website ? 'a' : 'div';

  return (
    <Tag
      key={id}
      {...(website ? { href: ensureAbsoluteUrl(website), target: '_blank', rel: 'noopener' } : {})}
      className={`sponsor-card sponsor-card-${tier}${expired ? ' sponsor-card-expired' : ''}`}
      title={`${tierLabel}${expired ? ' · Previous sponsor' : ''}`}
    >
      <span className={`sponsor-tier-badge sponsor-tier-badge-${tier}`}>{expired ? `${tierLabel} · Previous` : tierLabel}</span>
      {hasImage && (
        <div className='sponsor-avatar'>
          {image ? <img src={`/sponsor/image/${image}`} alt={name} loading='lazy' /> : <span className='avatar-fallback'>{initials}</span>}
        </div>
      )}
      <div className='sponsor-info'>
        <span className='sponsor-name'>{name}</span>
        {tagline && ['platinum', 'titanium'].includes(tier) && <p className='sponsor-tagline'>{tagline}</p>}
      </div>
    </Tag>
  );
}

function formatDownloads(value) {
  const count = Number(value) || 0;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${count}`;
}

function Plugin({ data }) {
  const { name, downloads, id, author } = data;

  return (
    <li>
      <a href={`/plugin/${id}`}>
        <img src={`/plugin-icon/${id}`} alt='' width='28' height='28' />
        <span className='plugin-meta'>
          <span className='plugin-top'>
            <span className='plugin-name'>{name}</span>
            <span className='plugin-downloads'>↓ {formatDownloads(downloads)}</span>
          </span>
          {author ? <span className='plugin-author'>{author}</span> : null}
        </span>
      </a>
    </li>
  );
}
