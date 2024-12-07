import JSZip from 'jszip';
import Input from 'components/input';
import {
  capitalize, getLoggedInUser, loadingEnd, loadingStart,
} from 'lib/helpers';
import AjaxForm from 'components/ajaxForm';
import Router from 'lib/Router';

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
  const pluginIcon = <img style={{ height: '120px', width: '120px' }} src="#" alt="Plugin icon" />;

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

      <button type='submit'> <span className="icon publish"></span> {buttonText}</button>
    </AjaxForm>
  </section>;

  function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    successText.value = 'Plugin published successfully.';
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
}
