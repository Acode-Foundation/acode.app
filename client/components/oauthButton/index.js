import './style.scss';
import Ref from 'html-tag-js/ref';
import { showLoading } from 'lib/helpers';

/**
 * @param {object} props
 * @param {'github'|'google'} props.provider
 * @param {string} redirectUrl
 */
export default function OAuthButton({ provider, redirectUrl }) {
  const label = provider === 'github' ? 'GitHub' : 'Google';
  const authUrl = oauthUrl(provider, redirectUrl);
  const button = Ref();

  return (
    <button
      type='button'
      title={authUrl}
      ref={button}
      className={`button oauth-button ${provider}`}
      onclick={() => {
        showLoading();
        button.el.disabled = true;
        window.location = authUrl;
      }}
    >
      <span className={`icon ${provider}`} />
      <p>
        Continue with <span className='provider'>{label}</span>
      </p>
    </button>
  );
}

function oauthUrl(provider, redirectUrl) {
  const base = `/oauth/${provider}`;
  return redirectUrl ? `${base}?redirect=${encodeURIComponent(redirectUrl)}` : base;
}
