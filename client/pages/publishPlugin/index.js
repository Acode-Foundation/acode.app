import JSZip from 'jszip';
import Input from 'components/input';
import {
  capitalize, getLoggedInUser, loadingEnd, loadingStart,
} from 'lib/helpers';
import AjaxForm from 'components/ajaxForm';
import Router from 'lib/Router';
import Ref from 'html-tag-js/ref';

export default async function PublishPlugin({ mode = 'publish', id }) {
  const user = await getLoggedInUser();

  if (!user) {
    Router.loadUrl('/login?redirect=/publish');
    return null;
  }

  const jsZip = new JSZip();
  const pluginId = <></>;
  const pluginVersion = <></>;
  const pluginAuthor = <></>;
  const pluginName = <></>;
  const pluginDescription = <></>;
  const errorText = <></>;
  const successText = <></>;
  const pluginPrice = <></>;
  const minVersionCode = <></>;
  const method = mode === 'publish' ? 'post' : 'put';
  const buttonText = <>{capitalize(mode)}</>;
  const submitButton = new Ref();
  const pluginIcon = <img style={{ height: '120px', width: '120px' }} src="#" alt="Plugin icon" />;

  let plugin;
  if (id) {
    plugin = await fetch(`/api/plugin/${id}`).then(res => res.json());
    pluginId.value = plugin.id;
    pluginName.value = plugin.name;
    pluginVersion.value = plugin.version;
    pluginAuthor.value = plugin.author;
    pluginDescription.value = plugin.description;
    minVersionCode.value = plugin.minVersionCode;
    pluginPrice.value = `INR ${plugin.price}`;
    pluginIcon.src = `/plugin-icon/${plugin.id}`;
  }

  return <section id='publish-plugin'>
    <h1>{capitalize(mode)} plugin</h1>
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
      <Input value={plugin?.changelogs || ''} type='textarea' name='changelogs' label='Change logs' placeholder="What's new in this update." />
      <Input value={plugin?.contributors || ''} type='textarea' name='contributors' label='Contributors' placeholder='Contributors' />
      <Input value={plugin?.keywords || ''} type='textarea' name='keywords' label='Keywords' placeholder='e.g. AI Assistance, Autocomplete' />
      <Input value={plugin?.license || ''} type='text' name='license' label='License' placeholder='e.g. MIT' />
      <span className="error">{errorText}</span>
      <span className="success">{successText}</span>

      <table>
        <tbody>
          <tr>
            <th>ID</th>
            <td>{pluginId}</td>
          </tr>
          <tr>
            <th>Name</th>
            <td>{pluginName}</td>
          </tr>
          <tr>
            <th>Version</th>
            <td>{pluginVersion}</td>
          </tr>
          <tr>
            <th>Author</th>
            <td>{pluginAuthor}</td>
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
        <span className="icon publish"></span>{buttonText}
      </button>
    </AjaxForm>
  </section>;

  function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    successText.value = 'Plugin published successfully.';
    Router.loadUrl(`/plugin/${data.id}`);
  }

  function onerror(error) {
    errorText.value = error;
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
      pluginDescription.value = '';
      pluginPrice.value = '';
      pluginIcon.src = '#';
      minVersionCode.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = async () => {
      const zip = await jsZip.loadAsync(reader.result);
      try {
        const manifest = JSON.parse(await zip.file('plugin.json').async('string'));
        const icon = await zip.file('icon.png').async('base64');

        if (id && id !== manifest.id) {
          errorText.value = 'Plugin ID is not same as previous version.';
          return;
        }

        if (id && !isVersionGreater(manifest.version, plugin.version)) {
          submitButton.el.disabled = true;
          errorText.value = 'Version should be greater than previous version.';
          return;
        }

        errorText.value = '';
        submitButton.el.disabled = false;
        pluginId.value = manifest.id;
        pluginName.value = manifest.name;
        pluginVersion.value = manifest.version;
        pluginAuthor.value = manifest.author?.name;
        pluginDescription.value = manifest.description;
        minVersionCode.value = manifest.minVersionCode || -1;
        pluginPrice.value = `INR ${manifest.price || 0}`;
        pluginIcon.src = `data:image/png;base64,${icon}`;
      } catch (error) {
        errorText.value = 'Invalid plugin file.';
      }
    };

    reader.readAsArrayBuffer(file);
  }

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

    return 'unknown';
  }
}
