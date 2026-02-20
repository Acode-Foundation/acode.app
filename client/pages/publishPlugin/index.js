import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import JSZip from 'jszip';
import { capitalize, getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading } from 'lib/helpers';
import Router from 'lib/Router';
import './style.scss';

export default async function PublishPlugin({ mode = 'publish', id }) {
  const user = await getLoggedInUser();

  if (!user) {
    Router.loadUrl('/login?redirect=/publish');
    return null;
  }

  /** @type {object} */
  const plugin = id ? await fetch(`/api/plugin/${id}`).then((res) => res.json()) : null;
  const jsZip = new JSZip();
  const errorText = Reactive();
  const updateType = Reactive();
  const successText = Reactive();
  const pluginId = Reactive(plugin?.id);
  const pluginName = Reactive(plugin?.name);
  const license = Reactive(plugin?.license);
  const pluginVersion = Reactive(plugin?.version);
  const pluginPrice = Reactive(+plugin?.price ? `INR ${plugin.price}` : 'Free');
  const keywords = Reactive(plugin?.keywords && json(plugin.keywords)?.join(', '));
  const contributors = Reactive(
    plugin?.contributors &&
      json(plugin.contributors)
        ?.map((contributor) => contributor.name)
        .join(', '),
  );
  const pluginAuthor = Reactive(plugin?.author || user.name);
  const minVersionCode = Reactive(plugin?.minVersionCode);
  const buttonText = Reactive(capitalize(mode));

  const submitButton = Ref();
  const changelogsInput = Ref();
  const method = mode === 'publish' ? 'post' : 'put';
  const pluginIcon = <img style={{ height: '120px', width: '120px' }} src={plugin?.icon || '#'} alt='Plugin icon' />;

  let supportedEditorText = '?';

  switch (plugin?.supported_editor) {
    case 'ace':
      supportedEditorText = 'Ace';
      break;

    case 'cm':
      supportedEditorText = 'CodeMirror';
      break;

    case 'all':
      supportedEditorText = 'Both';
      break;

    default:
      break;
  }

  return (
    <section id='publish-plugin'>
      <h1 style={{ textAlign: 'center' }}>{capitalize(mode)} plugin</h1>

      {mode === 'update' && (
        <div className='update-banner'>
          <div className='icon-wrapper'>
            <span className='icon announcement' />
            <span>
              We've upgraded from Ace to CodeMirror!
              <span className='badge'>MANDATORY UPDATE</span>
            </span>
          </div>
          <p>
            Your plugin currently supports <strong>{supportedEditorText}</strong> editor(s). Please update your plugin to ensure compatibility with
            CodeMirror for the best experience.
          </p>
          <a href={`update-plugin-editor/${pluginId.value}`}>Update Editor Support Now</a>
        </div>
      )}

      <AjaxForm
        action='/api/plugin'
        method={method}
        encoding='multipart/form-data'
        onloadend={onloadend}
        onerror={onerror}
        loading={(form) => loadingStart(form, errorText, successText, buttonText)}
        loadingEnd={(form) => loadingEnd(form, buttonText, capitalize(mode))}
      >
        <Input required={true} onchange={onFileChange} type='file' name='plugin' label='Select plugin or drop here.' />
        <Input
          ref={changelogsInput}
          value={plugin?.changelogs || ''}
          type='textarea'
          name='changelogs'
          label='Change logs'
          placeholder="What's new in this update."
        />
        <span className='error'>{errorText}</span>
        <span className='success'>{successText}</span>

        <table>
          <tbody>
            <tr>
              <th>ID</th>
              <td>{pluginId}</td>
            </tr>
            <tr>
              <th>Editor Type</th>
              <td>
                <select name='supported_editor' id='editor_type' value={plugin?.supported_editor || 'cm'}>
                  <option value='ace'>Ace</option>
                  <option value='cm' selected>
                    CodeMirror
                  </option>
                  <option value='all'>Both</option>
                </select>
              </td>
            </tr>
            <tr>
              <th>Name</th>
              <td>{pluginName}</td>
            </tr>
            <tr>
              <th>Version</th>
              <td>
                {pluginVersion} {id && <small>{updateType}</small>}
              </td>
            </tr>
            <tr>
              <th>Author</th>
              <td>{pluginAuthor}</td>
            </tr>
            <tr>
              <th>License</th>
              <td>{license}</td>
            </tr>
            <tr>
              <th>Keywords</th>
              <td>{keywords}</td>
            </tr>
            <tr>
              <th>Contributors</th>
              <td>{contributors}</td>
            </tr>
            <tr>
              <th>Min Version Code</th>
              <td>{minVersionCode}</td>
            </tr>
            <tr>
              <th>Price</th>
              <td>{pluginPrice}</td>
            </tr>
            <tr>
              <th>Icon</th>
              <td>{pluginIcon}</td>
            </tr>
          </tbody>
        </table>

        <button ref={submitButton} type='submit'>
          <span className='icon publish' />
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

    let message = 'Plugin published successfully.';

    if (id) {
      const updateType = getUpdateType(pluginVersion.value, plugin.version);
      message = `Plugin updated to ${pluginVersion.value} (${updateType}) successfully.`;
    }

    alert('Success', message, null, true);
    Router.loadUrl(`/plugin/${pluginId.value}`);
  }

  function onerror(error) {
    errorText.value = error;
    submitButton.el.disabled = true;
    submitButton.el.ariaDisabled = true;
  }

  function onFileChange() {
    const [file] = this.files;

    if (!file) {
      errorText.value = '';
      successText.value = '';
      pluginId.value = '';
      pluginName.value = '';
      pluginVersion.value = '';
      pluginAuthor.value = '';
      pluginPrice.value = '';
      pluginIcon.src = '#';
      minVersionCode.value = '';
      submitButton.el.disabled = true;
      submitButton.el.ariaDisabled = true;
      return;
    }

    const reader = new FileReader();
    submitButton.el.disabled = false;
    submitButton.el.ariaDisabled = false;

    reader.onload = async () => {
      showLoading();
      const zip = await jsZip.loadAsync(reader.result);
      try {
        const manifest = JSON.parse(await zip.file('plugin.json').async('string'));
        const iconFileFromManifest = manifest?.icon || 'icon.png';
        const icon = await zip.file(iconFileFromManifest)?.async('base64');

        if (id && id !== manifest.id) {
          throw new Error('Plugin ID is not same as previous version.');
        }

        if (id && !isVersionGreater(manifest.version, plugin.version)) {
          submitButton.el.disabled = true;
          submitButton.el.ariaDisabled = true;
          throw new Error('Version should be greater than previous version.');
        }

        if (!icon) errorText.value = 'Unable to load plugin icon: no icon was provided or the default icon (icon.png) is missing.';

        const changelogs = (await zip.file('changelogs.md')?.async('string')) || (await zip.file('changelog.md')?.async('string'));

        if (changelogs) {
          changelogsInput.el.value = changelogs;
        }

        if (manifest.contributors) {
          contributors.value = manifest.contributors.map((contributor) => contributor.name).join(', ');
        } else {
          contributors.value = '';
        }

        if (manifest.keywords) {
          keywords.value = manifest.keywords.join(', ');
        } else {
          keywords.value = '';
        }

        if (manifest.license) {
          license.value = manifest.license;
        } else {
          license.value = '';
        }

        if (manifest.author?.name) {
          pluginAuthor.value = manifest.author?.name;
        } else {
          pluginAuthor.value = user.name;
        }

        if (id) {
          updateType.value = `(${getUpdateType(manifest.version, plugin.version)} from ${plugin.version})`;
        }

        if (+manifest.price) {
          pluginPrice.value = `INR ${manifest.price || 0}`;
        } else {
          pluginPrice.value = 'Free';
        }

        pluginId.value = manifest.id;
        pluginName.value = manifest.name;
        pluginVersion.value = manifest.version;
        minVersionCode.value = manifest.minVersionCode || -1;
        // Checking for icon before rendering
        if (!icon) {
          submitButton.el.disabled = true;
          submitButton.el.ariaDisabled = true;
          throw new Error('Unable to load plugin icon: no icon was provided or the default icon (icon.png) is missing.');
        }
        pluginIcon.src = `data:image/png;base64,${icon}`;

        errorText.value = '';
        submitButton.el.disabled = false;
      } catch (error) {
        console.error(error);
        errorText.value = error.message;
      }
      hideLoading();
    };

    reader.readAsArrayBuffer(file);
  }
}

/**
 * Check if version is greater
 * @param {string} newV
 * @param {string} oldV
 * @returns {boolean}
 */
function isVersionGreater(newV, oldV) {
  const [newMajor, newMinor, newPatch] = newV.split('.').map(Number);
  const [oldMajor, oldMinor, oldPatch] = oldV.split('.').map(Number);

  if (newMajor > oldMajor) {
    return true;
  }

  if (newMajor === oldMajor && newMinor > oldMinor) {
    return true;
  }

  if (newMajor === oldMajor && newMinor === oldMinor && newPatch > oldPatch) {
    return true;
  }

  return false;
}

/**
 * Get update type
 * @param {string} newV
 * @param {string} oldV
 * @returns {'major' | 'minor' | 'patch' | 'unknown'}
 */
function getUpdateType(newV, oldV) {
  const [newMajor, newMinor, newPatch] = newV.split('.').map(Number);
  const [oldMajor, oldMinor, oldPatch] = oldV.split('.').map(Number);

  if (newMajor > oldMajor) {
    return 'major';
  }

  if (newMajor === oldMajor && newMinor > oldMinor) {
    return 'minor';
  }

  if (newMajor === oldMajor && newMinor === oldMinor && newPatch > oldPatch) {
    return 'patch';
  }

  return null;
}

function json(string) {
  try {
    return JSON.parse(string);
  } catch (_error) {
    return null;
  }
}
