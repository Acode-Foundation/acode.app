import ScreenshotGallery from './screenshotGallery';
import { screenshots } from './screenshots';

const features = [
  {
    id: 'editing',
    eyebrow: 'CODE & NAVIGATE',
    title: ['A real editor.', 'A smaller screen.'],
    description:
      'Get completions and type information as you write. Find your next command, search across your project, and keep code consistent with Prettier.',
    shots: [screenshots.editor, { ...screenshots.commands, title: 'Commands' }, { ...screenshots.formatter, title: 'Prettier' }],
  },
  {
    id: 'workspace',
    eyebrow: 'TERMINALS & AGENTS',
    title: ['Your tools.', 'One workspace.'],
    description: 'Run a Linux terminal and AI agents beside your files. Split editors, configs, and tools into panes that fit the way you work.',
    shots: [screenshots.panes, screenshots.agent],
    wide: true,
  },
  {
    id: 'customization',
    eyebrow: 'MAKE IT YOURS',
    title: ['Your editor,', 'your way.'],
    description:
      'Add language tools and developer utilities with plugins. Pick a theme, tune your shortcuts, and make the workspace feel like yours. Nothing is locked. If you can think it, you can wire it.',
    shots: [screenshots.plugins, screenshots.themes],
    link: { href: '/plugins', label: 'Explore plugins' },
  },
];

export default function FeatureSections() {
  return (
    <div className='home-features'>
      {features.map((feature) => (
        <section className={`home-feature${feature.wide ? ' home-feature--wide' : ''}`} aria-labelledby={`feature-${feature.id}`}>
          <div className='home-feature__copy'>
            <span className='home-feature__eyebrow'>{feature.eyebrow}</span>
            <h2 id={`feature-${feature.id}`}>
              <span>{feature.title[0]}</span> <span>{feature.title[1]}</span>
            </h2>
            <p>{feature.description}</p>
            {feature.link ? (
              <a className='home-feature__link' href={feature.link.href}>
                {feature.link.label}
                <span className='icon navigate_next' aria-hidden='true' />
              </a>
            ) : null}
          </div>
          <ScreenshotGallery
            className='home-feature__gallery'
            shots={feature.shots}
            label={`${feature.eyebrow.toLowerCase()} screenshots`}
            autoplay={false}
            labeledControls={true}
            priority={false}
          />
        </section>
      ))}
    </div>
  );
}
