import Router from 'lib/Router';
import { setupScreenshotCarousel } from './screenshotCarousel';

export default function ScreenshotGallery({
  shots,
  label = 'Acode mobile screenshots',
  className = '',
  autoplay = true,
  labeledControls = false,
  priority = true,
}) {
  const gallery = (
    <section className={`home-gallery ${className}`} aria-label={label} aria-roledescription='carousel'>
      <div className='home-gallery__stage'>
        <button type='button' className='home-gallery__arrow' data-previous aria-label='Previous screenshot'>
          <GalleryIcon name='previous' />
        </button>
        <div className='home-gallery__viewport'>
          <div className='home-gallery__track'>
            {shots.map((shot, index) => (
              <div
                className='home-gallery__slide'
                role='group'
                aria-roledescription='slide'
                aria-label={`${index + 1} of ${shots.length}: ${shot.title}`}
              >
                <button
                  type='button'
                  className='home-gallery__image'
                  data-expand={index}
                  aria-label={`Expand ${shot.title} screenshot`}
                  aria-haspopup='dialog'
                >
                  <picture>
                    <source srcset={shot.webp} type='image/webp' />
                    <img
                      src={shot.src}
                      alt={shot.alt}
                      width={shot.width}
                      height={shot.height}
                      loading={priority && index === 0 ? 'eager' : 'lazy'}
                      decoding='async'
                      draggable={false}
                    />
                  </picture>
                  <span className='home-gallery__expand' aria-hidden='true'>
                    <GalleryIcon name='expand' />
                    Expand
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <button type='button' className='home-gallery__arrow' data-next aria-label='Next screenshot'>
          <GalleryIcon name='next' />
        </button>
      </div>
      <div className='home-gallery__caption'>
        <strong data-title>{shots[0].title}</strong>
        <p data-caption>{shots[0].caption}</p>
      </div>
      <div className='home-gallery__controls'>
        <div className='home-gallery__pagination' role='group' aria-label='Choose a screenshot'>
          {shots.map((shot, index) => (
            <button
              type='button'
              className={labeledControls ? 'home-gallery__tab' : 'home-gallery__dot'}
              data-slide={index}
              title={shot.title}
              aria-label={`Show ${shot.title}`}
              aria-current={index === 0 ? 'true' : 'false'}
            >
              {labeledControls ? shot.title : <span />}
            </button>
          ))}
        </div>
        <button type='button' className='home-gallery__playback' data-playback aria-label='Pause slideshow' hidden={!autoplay}>
          <span data-pause-icon>
            <GalleryIcon name='pause' />
          </span>
          <span data-play-icon hidden>
            <GalleryIcon name='play' />
          </span>
        </button>
      </div>
      <span className='home-gallery__sr-only' data-announcement aria-live='polite' aria-atomic='true' />
      <dialog className='home-gallery__viewer' aria-label='Full-size Acode screenshots'>
        <div className='home-gallery__viewer-bar'>
          <div className='home-gallery__viewer-label'>
            <span data-viewer-count />
            <strong data-viewer-title />
          </div>
          <button type='button' className='home-gallery__viewer-close' data-close aria-label='Close full-size screenshot' autofocus>
            <GalleryIcon name='close' />
          </button>
        </div>
        <div className='home-gallery__viewer-stage'>
          <button type='button' className='home-gallery__arrow' data-viewer-previous aria-label='Previous full-size screenshot'>
            <GalleryIcon name='previous' />
          </button>
          <picture>
            <source data-viewer-source type='image/webp' />
            <img data-viewer-image alt='' width='720' height='1387' draggable={false} />
          </picture>
          <button type='button' className='home-gallery__arrow' data-viewer-next aria-label='Next full-size screenshot'>
            <GalleryIcon name='next' />
          </button>
        </div>
        <p className='home-gallery__viewer-caption' data-viewer-caption aria-live='polite' />
      </dialog>
    </section>
  );

  const dispose = setupScreenshotCarousel(gallery, shots, { autoplay });
  const cleanup = () => {
    dispose();
    Router.off('navigate', cleanup);
  };
  Router.on('navigate', cleanup);
  return gallery;
}

function GalleryIcon({ name }) {
  const paths = {
    previous: 'm14 6-6 6 6 6',
    next: 'm10 6 6 6-6 6',
    expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
    close: 'm6 6 12 12M6 18 18 6',
    pause: 'M9 5v14M15 5v14',
    play: 'm9 5 10 7-10 7Z',
  };
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='1.6'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
      focusable='false'
    >
      <path d={paths[name]} />
    </svg>
  );
}
