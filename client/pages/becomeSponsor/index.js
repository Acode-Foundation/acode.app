import './style.scss';
import CurrencySelector from 'components/currencySelector';
import alert from 'components/dialogs/alert';
import { initiateSponsorCheckout } from 'components/razorpayCheckout';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser } from 'lib/helpers';
import getSponsorTiers from 'lib/sponsorTiers';

const PERKS = [
  {
    icon: 'code-fork',
    title: 'Sustain Open Source',
    description: 'Your contribution directly supports development of Acode and helps keep it free for everyone.',
  },
  {
    icon: 'earth',
    title: 'Get Visibility',
    description: 'Your brand seen by thousands of developers who use Acode every day.',
  },
  {
    icon: 'certificate',
    title: 'Supporter Badge',
    description: 'Show your commitment to the open-source community with pride.',
  },
];

export default async function BecomeSponsor() {
  const formRef = Ref();
  const tierCardsRef = Ref();
  const loggedInUser = await getLoggedInUser();

  const { tiers, symbol } = await getSponsorTiers();

  return (
    <section id='become-sponsor-page'>
      <div className='sponsors-hero'>
        <h1>
          Support the Editor <span className='highlight'>You Love</span>
        </h1>
        <p className='subtitle'>
          Join the community of supporters who help keep <span className='highlight'>Acode</span> free and open-source for everyone.
        </p>
      </div>

      <div className='sponsors-perks'>
        {PERKS.map((perk) => (
          <div className='perk-card'>
            <div className='perk-icon'>
              <span className={`icon ${perk.icon}`} />
            </div>
            <h3>{perk.title}</h3>
            <p>{perk.description}</p>
          </div>
        ))}
      </div>

      <div className='sponsors-tiers' ref={tierCardsRef}>
        <h2 className='section-heading'>Choose Your Tier</h2>
        <div className='tiers-grid'>
          {Object.entries(tiers).map(([key, tier]) => {
            return (
              <div className='tier-card' data-tier={key} onclick={() => selectTier(key)}>
                <h3 className={`tier-name tier-${key}`}>{tier.label}</h3>
                <div className='tier-price'>
                  <CurrencySelector className='tier-price-selector'>
                    <span className='currency'>{symbol}</span>
                    <span className='amount'>{tier.price}</span>
                  </CurrencySelector>
                </div>
                <p className='tier-desc'>{tier.description}</p>
                <button type='button' className='btn-select'>
                  Select
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className='sponsors-form-section' ref={formRef} style={{ display: 'none' }}>
        <SponsorshipForm
          isLoggedIn={!!loggedInUser}
          onCancel={() => hideForm()}
          onSuccess={() => {
            window.location = '/sponsors';
          }}
          loggedInEmail={loggedInUser?.email}
          loggedInName={loggedInUser?.name}
        />
      </div>
    </section>
  );

  function selectTier(tierKey) {
    const form = formRef.el;
    const currentTier = form?.getAttribute('data-tier');
    if (currentTier === tierKey && form?.style.display !== 'none') {
      return;
    }
    if (form) {
      form.setAttribute('data-tier', tierKey);
      const tierBadge = form.querySelector('.form-tier-label');
      if (tierBadge) {
        tierBadge.textContent = tiers[tierKey]?.label || tierKey;
      }
      form.style.display = 'block';
      form.scrollIntoView({ behavior: 'smooth' });
    }

    const cards = tierCardsRef.el?.querySelectorAll('.tier-card');
    if (!cards) {
      return;
    }

    for (const card of cards) {
      card.classList.toggle('selected', card.getAttribute('data-tier') === tierKey);
    }
  }

  function hideForm() {
    const form = formRef.el;
    if (form) {
      form.style.display = 'none';
    }
    const cards = tierCardsRef.el?.querySelectorAll('.tier-card');
    if (!cards) {
      return;
    }

    for (const card of cards) {
      card.classList.remove('selected');
    }
  }
}

function SponsorshipForm({ isLoggedIn, onSuccess, loggedInEmail, loggedInName }) {
  const fileRef = Ref();
  const previewRef = Ref();
  const uploadZoneRef = Ref();
  let selectedFileData = null;

  async function handleSubmit(e) {
    e.preventDefault();

    if (!isLoggedIn) {
      const form = e.target;
      const tier = form.closest('[data-tier]')?.getAttribute('data-tier');
      window.location = `/login?redirect=/become-sponsor${tier ? `?tier=${tier}` : ''}`;
      return;
    }

    const form = e.target;
    const tier = form.closest('[data-tier]')?.getAttribute('data-tier');
    const name = form.querySelector('[name="name"]')?.value?.trim();
    const email = form.querySelector('[name="email"]')?.value?.trim();
    const website = form.querySelector('[name="website"]')?.value?.trim();
    const tagline = form.querySelector('[name="tagline"]')?.value?.trim();

    if (!name) {
      alert('Error', 'Please enter your name');
      return;
    }
    if (!email) {
      alert('Error', 'Please enter your email');
      return;
    }

    const sponsorData = { tier, name, email };
    if (website) sponsorData.website = website;
    if (tagline) sponsorData.tagline = tagline;
    if (selectedFileData) sponsorData.image = selectedFileData;

    await initiateSponsorCheckout(
      sponsorData,
      () => onSuccess(),
      () => {},
    );
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 512 * 1024) {
      alert('Error', 'Logo must be under 512KB');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      selectedFileData = reader.result;
      const preview = previewRef.el;
      if (preview) {
        preview.style.backgroundImage = `url(${reader.result})`;
      }
      showPreviewState(file.name);
    };
    reader.readAsDataURL(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    uploadZoneRef.el?.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    uploadZoneRef.el?.classList.remove('drag-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    uploadZoneRef.el?.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('Error', 'Please upload a PNG, JPEG, or WebP image');
      return;
    }
    if (file.size > 512 * 1024) {
      alert('Error', 'Logo must be under 512KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      selectedFileData = reader.result;
      const preview = previewRef.el;
      if (preview) {
        preview.style.backgroundImage = `url(${reader.result})`;
      }
      showPreviewState(file.name);
    };
    reader.readAsDataURL(file);
  }

  function handleRemove(e) {
    e.stopPropagation();
    selectedFileData = null;
    if (fileRef.el) fileRef.el.value = '';
    const preview = previewRef.el;
    if (preview) {
      preview.style.backgroundImage = '';
    }
    uploadZoneRef.el?.classList.remove('has-file');
  }

  function showPreviewState(filename) {
    const zone = uploadZoneRef.el;
    if (zone) {
      zone.classList.add('has-file');
      const nameEl = zone.querySelector('.upload-filename');
      if (nameEl) nameEl.textContent = filename;
    }
  }

  return (
    <div className='sponsorship-form'>
      <div className='form-header'>
        <h3>
          Selected: <span className='form-tier-label' data-tier-bind></span>
        </h3>
        <span className='form-tier-hint'>Click a different tier above to change</span>
      </div>

      <form onsubmit={handleSubmit}>
        <div className='form-row'>
          <label>
            <span>Name</span>
            <input type='text' name='name' required placeholder='Your name or company' value={loggedInName || ''} />
          </label>
        </div>
        <div className='form-row'>
          <label>
            <span>Email</span>
            <input type='email' name='email' required placeholder='your@email.com' value={loggedInEmail || ''} />
          </label>
        </div>
        <div className='form-row form-row-website'>
          <label>
            <span>Website</span>
            <input type='url' name='website' placeholder='https://your-site.com' />
          </label>
        </div>
        <div className='form-row form-row-tagline'>
          <label>
            <span>Tagline</span>
            <input type='text' name='tagline' maxlength='80' placeholder='A short tagline (max 80 chars)' />
          </label>
        </div>
        <div className='form-row form-row-image'>
          <label>
            <span>Logo</span>
            <div
              ref={uploadZoneRef}
              className='file-upload-zone'
              onclick={() => fileRef.el?.click()}
              ondragover={handleDragOver}
              ondragleave={handleDragLeave}
              ondrop={handleDrop}
            >
              <div ref={previewRef} className='logo-preview' />
              <div className='upload-placeholder'>
                <span className='icon image' />
                <span className='upload-text'>Click to upload or drag and drop</span>
                <span className='upload-hint'>PNG, JPEG, or WebP &mdash; max 512KB</span>
              </div>
              <div className='upload-file-info'>
                <span className='upload-filename' />
                <button type='button' className='upload-remove-btn' onclick={handleRemove}>
                  <span className='icon clear' />
                </button>
              </div>
              <input ref={fileRef} type='file' accept='image/png,image/jpeg,image/webp' onchange={handleFileChange} />
            </div>
          </label>
        </div>

        <div className='form-actions'>
          <button type='submit' className='btn-submit'>
            <span className='icon credit_card' />
            Proceed
          </button>
        </div>
      </form>
    </div>
  );
}
