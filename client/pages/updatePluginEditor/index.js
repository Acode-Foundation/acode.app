import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser, loadingEnd, loadingStart } from 'lib/helpers';
import Router from 'lib/Router';
import './style.scss';

export default async function UpdatePluginEditor({ id }) {
  const user = await getLoggedInUser();

  if (!user) {
    Router.loadUrl(`/login?redirect=/update-plugin-editor/${id}`);
    return null;
  }

  const plugin = await fetch(`/api/plugin/${id}`).then((res) => res.json());

  if (plugin.error) {
    return (
      <section id='update-plugin-editor'>
        <div className='error-container'>
          <h1>Error</h1>
          <p>{plugin.error}</p>
          <a href='/'>Go Home</a>
        </div>
      </section>
    );
  }

  // Check ownership
  if (plugin.user_id !== user.id && !user.isAdmin) {
    return (
      <section id='update-plugin-editor'>
        <div className='error-container'>
          <h1>Access Denied</h1>
          <p>You don't have permission to update this plugin.</p>
          <a href={`/plugin/${id}`}>Back to Plugin</a>
        </div>
      </section>
    );
  }

  const errorText = Reactive('');
  const successText = Reactive('');
  const buttonText = Reactive('Update');
  const submitButton = Ref();

  let currentEditorText = 'Unknown';
  switch (plugin.supported_editor) {
    case 'ace':
      currentEditorText = 'Ace Editor (Legacy)';
      break;
    case 'cm':
      currentEditorText = 'CodeMirror (Recommended)';
      break;
    case 'all':
      currentEditorText = 'Both Ace & CodeMirror';
      break;
    default:
      currentEditorText = 'Not Set';
      break;
  }

  return (
    <section id='update-plugin-editor'>
      <h1>Update Editor Support</h1>

      <div className='plugin-info'>
        <div className='plugin-header'>
          <img src={plugin.icon} alt={plugin.name} className='plugin-icon' />
          <div className='plugin-details'>
            <h2>{plugin.name}</h2>
            <p className='plugin-id'>{plugin.id}</p>
            <p className='current-support'>
              Current Support: <strong>{currentEditorText}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className='info-banner'>
        <div className='icon-wrapper'>
          <span className='icon info' />
          <span>Important Information</span>
        </div>
        <p>
          <strong>Ace Editor will be deprecated soon.</strong> We strongly recommend updating your plugin to support CodeMirror for the best
          experience and future compatibility.
        </p>
        <p>If you're creating a new plugin, please develop it with CodeMirror support from the start.</p>
      </div>

      <AjaxForm
        action={`/api/plugin/${id}/supported-editor`}
        method='PATCH'
        onloadend={onloadend}
        onerror={onerror}
        loading={(form) => loadingStart(form, errorText, successText, buttonText)}
        loadingEnd={(form) => loadingEnd(form, buttonText, 'Update')}
      >
        <div className='editor-options'>
          <h3>Select Editor Support</h3>

          <label className='radio-option recommended'>
            <input type='radio' name='supported_editor' value='cm' defaultChecked={plugin.supported_editor === 'cm'} />
            <div className='option-content'>
              <div className='option-header'>
                <strong>CodeMirror</strong>
                <span className='badge recommended'>Recommended</span>
              </div>
              <p className='option-description'>
                Modern code editor with better performance and features. This is the recommended choice for all new and updated plugins.
              </p>
            </div>
          </label>

          <label className='radio-option'>
            <input type='radio' name='supported_editor' value='all' defaultChecked={plugin.supported_editor === 'all'} />
            <div className='option-content'>
              <div className='option-header'>
                <strong>Both Ace & CodeMirror</strong>
                <span className='badge'>Universal</span>
              </div>
              <p className='option-description'>
                Support both editors for maximum compatibility. Choose this if your plugin needs to work with users still using Ace editor.
              </p>
            </div>
          </label>

          <label className='radio-option deprecated'>
            <input type='radio' name='supported_editor' value='ace' defaultChecked={plugin.supported_editor === 'ace'} />
            <div className='option-content'>
              <div className='option-header'>
                <strong>Ace Editor Only</strong>
                <span className='badge deprecated'>Deprecated</span>
              </div>
              <p className='option-description'>Legacy editor support. Will be removed in future versions. Not recommended for continued use.</p>
            </div>
          </label>
        </div>

        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '16px',
            gap: '8px',
          }}
        >
          <input type='checkbox' name='agree_tested' id='tested_agreement' required={true} />
          <label htmlFor='tested_agreement' className='agreement'>
            I have tested my plugin with the selected editor(s) and confirm that it works correctly.
          </label>
        </div>

        <button ref={submitButton} type='submit'>
          <span className='icon save' />
          {buttonText}
        </button>
      </AjaxForm>
    </section>
  );

  function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    errorText.value = '';
    successText.value = 'Editor support updated successfully!';

    setTimeout(() => {
      alert('Success', 'Editor support has been updated. Your plugin is now configured for the selected editor(s).', null, true);
      Router.loadUrl(`/plugin/${id}`);
    }, 1500);
  }

  function onerror(error) {
    errorText.value = error;
  }
}
