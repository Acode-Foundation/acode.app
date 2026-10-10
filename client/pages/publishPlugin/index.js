import AjaxForm from 'components/ajaxForm';
import alert from 'components/dialogs/alert';
import Input from 'components/input';
import Select from 'components/select';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import JSZip from 'jszip';
import { marked } from 'marked';
import { capitalize, getLoggedInUser, hideLoading, loadingEnd, loadingStart, showLoading } from 'lib/helpers';
import Router from 'lib/Router';
import './style.scss';
import '../user/style.scss';

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
  const pluginPrice = Reactive(+plugin?.price ? `₹${plugin.price}` : 'Free');
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
  const emptyStateRef = Ref();
  const infoTableRef = Ref();
  const priceBadgeRef = Ref();
  const updateTypeBadgeRef = Ref();
  const isParsing = Reactive(false);
  const parseError = Reactive('');
  const parseErrorRef = Ref();
  const checklist = Reactive({
    hasJson: null,
    hasIcon: null,
    versionOk: null,
    hasMain: null
  });

  const method = mode === 'publish' ? 'post' : 'put';
  const pluginIcon = <img style={{ width: '100%', height: '100%', objectFit: 'cover' }} src={plugin?.icon || '#'} alt='Plugin icon' />;

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
      <div className='profile' style={{ marginBottom: '24px', width: 'fit-content', margin: '0 auto 24px auto' }}>
        <div className='profile-info' style={{ alignItems: 'center' }}>
          <h1 style={{ textAlign: 'center', margin: 0 }}>
            <span className={`icon ${mode === 'publish' ? 'publish' : 'create'}`} style={{ marginRight: '10px' }} />
            {capitalize(mode)} Plugin
          </h1>
        </div>
      </div>

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
          <a href={`/update-plugin-editor/${pluginId.value}`} className='action action--primary' style={{ marginTop: '10px' }}>
             Update Editor Support Now
          </a>
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
        <div className='reworked-publish-layout' style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Step 1: File Upload Block */}
          <div className='panel'>
            <div className='panel-head'>
              <h3>1. Upload Plugin</h3>
            </div>
            <div className='panel-body'>
              <Input required={true} onchange={onFileChange} type='file' name='plugin' label='Select a plugin or drop here' />
              
              <div className='upload-checklist' style={{ display: (isParsing.value || checklist.value.hasJson !== null) ? 'flex' : 'none', flexDirection: 'column', gap: '10px', padding: '16px', background: 'var(--dash-surface)', border: '1px solid var(--dash-line)', borderRadius: '12px', marginTop: '16px' }}>
                <strong style={{ fontSize: '14px', marginBottom: '4px' }}>{isParsing.value ? 'Analyzing Plugin...' : 'Analysis Complete'}</strong>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: checklist.value.hasJson === null ? 'var(--dash-muted)' : checklist.value.hasJson ? 'var(--dash-good)' : 'var(--dash-bad)' }}>
                  <span className={`icon ${checklist.value.hasJson === null ? 'loop' : checklist.value.hasJson ? 'check' : 'clear'}`} style={checklist.value.hasJson === null && isParsing.value ? { animation: 'spin 1s linear infinite' } : {}} />
                  <span>Valid plugin.json found</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: checklist.value.hasIcon === null ? 'var(--dash-muted)' : checklist.value.hasIcon ? 'var(--dash-good)' : 'var(--dash-bad)' }}>
                  <span className={`icon ${checklist.value.hasIcon === null ? 'loop' : checklist.value.hasIcon ? 'check' : 'clear'}`} style={checklist.value.hasIcon === null && isParsing.value ? { animation: 'spin 1s linear infinite' } : {}} />
                  <span>Plugin icon provided</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: checklist.value.hasMain === null ? 'var(--dash-muted)' : checklist.value.hasMain ? 'var(--dash-good)' : 'var(--dash-bad)' }}>
                  <span className={`icon ${checklist.value.hasMain === null ? 'loop' : checklist.value.hasMain ? 'check' : 'clear'}`} style={checklist.value.hasMain === null && isParsing.value ? { animation: 'spin 1s linear infinite' } : {}} />
                  <span>Main script exists</span>
                </div>
                
                <div style={{ display: id ? 'flex' : 'none', alignItems: 'center', gap: '8px', color: checklist.value.versionOk === null ? 'var(--dash-muted)' : checklist.value.versionOk ? 'var(--dash-good)' : 'var(--dash-bad)' }}>
                  <span className={`icon ${checklist.value.versionOk === null ? 'loop' : checklist.value.versionOk ? 'check' : 'clear'}`} style={checklist.value.versionOk === null && isParsing.value ? { animation: 'spin 1s linear infinite' } : {}} />
                  <span>Version is incremented</span>
                </div>

                <div ref={parseErrorRef} style={{ display: 'none', marginTop: '8px', padding: '10px', background: 'rgba(248, 113, 113, 0.1)', color: '#f87171', borderRadius: '8px', fontSize: '13px' }}>
                  {parseError}
                </div>
              </div>
            </div>
          </div>

          {/* Empty State when no plugin is parsed yet */}
          <div ref={emptyStateRef} className='panel' style={{ borderStyle: 'dashed', backgroundColor: 'transparent', textAlign: 'center', padding: '40px 20px', color: 'var(--dash-muted)' }}>
             <span className='icon file_download' style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }} />
             <p style={{ margin: 0, fontSize: '15px' }}>Upload a valid plugin to proceed to the next steps.</p>
          </div>

          {/* Step 2: Plugin Details and Submit (Initially Hidden until parsed) */}
          <div ref={infoTableRef} className='details-block' style={{ display: 'none', flexDirection: 'column', gap: '24px' }}>
            <div className='panel'>
              <div className='panel-head'>
                <h3>2. Review Details</h3>
              </div>
              <div className='panel-body'>
                <div className='review-details-list' style={{ display: 'flex', flexDirection: 'column', background: 'var(--dash-surface)', borderRadius: '12px', border: '1px solid var(--dash-line)', overflow: 'hidden' }}>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, backgroundColor: 'rgba(0,0,0,0.2)' }}>
                      {pluginIcon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--dash-text)', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pluginName}
                      </div>
                      <div style={{ fontFamily: 'monospace', color: 'var(--dash-muted)', fontSize: '0.85rem' }}>
                        {pluginId}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>Version</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span className='badge primary'>v{pluginVersion}</span>
                      {id && <span ref={updateTypeBadgeRef} className='badge'>{updateType}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>Price</div>
                    <span ref={priceBadgeRef} className='badge'>{pluginPrice}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>Min Version</div>
                    <div style={{ fontWeight: 500, color: 'var(--dash-text)' }}>{minVersionCode}</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>Author</div>
                    <div style={{ fontWeight: 500, color: 'var(--dash-text)', textAlign: 'right' }}>{pluginAuthor}</div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>License</div>
                    <div style={{ fontWeight: 500, color: 'var(--dash-text)' }}>{license}</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--dash-line)' }}>
                    <div className='stat-label'>Keywords</div>
                    <div style={{ color: 'var(--dash-muted)', fontSize: '0.9rem', wordBreak: 'break-word' }}>{keywords}</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 16px' }}>
                    <div className='stat-label'>Contributors</div>
                    <div style={{ color: 'var(--dash-muted)', fontSize: '0.9rem', wordBreak: 'break-word' }}>{contributors}</div>
                  </div>

                </div>

                <div style={{ marginTop: '24px' }}>
                  <div className='stat-label' style={{ marginBottom: '8px' }}>Editor Support</div>
                  <Select
                    name='supported_editor'
                    style={{ width: '100%' }}
                    options={[
                      { label: 'CodeMirror', value: 'cm' },
                      { label: 'Both', value: 'all' },
                      ...(plugin?.supported_editor === 'ace' ? [{ label: 'Ace', value: 'ace' }] : []),
                    ]}
                    value={plugin?.supported_editor || 'cm'}
                  />
                </div>
              </div>
            </div>

            <div className='panel'>
              <div className='panel-head'>
                <h3>3. Change Logs & Publish</h3>
              </div>
              <div className='panel-body'>
                <Input
                  inputRef={changelogsInput}
                  value={plugin?.changelogs || ''}
                  type='textarea'
                  name='changelogs'
                  label='Change logs'
                  placeholder="What's new in this update."
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                  <span className='error'>{errorText}</span>
                  <span className='success'>{successText}</span>
                  <button ref={submitButton} type='submit' style={{ width: '100%', justifyContent: 'center', height: '48px', fontSize: '1rem', background: 'var(--dash-accent)', color: '#fff', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className='icon publish' />
                    {buttonText}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AjaxForm>
    </section>
  );

  function onloadend(data) {
    if (data.error) {
      errorText.value = data.error;
      return;
    }

    let message = 'Plugin published successfully.';

    if (data.review) {
      // The security scan held this update; it goes live once an admin approves it.
      alert('Submitted for review', data.message, null, true);
      Router.loadUrl(`/plugin/${pluginId.value}/security`);
      return;
    }

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
      if (emptyStateRef.el) emptyStateRef.el.style.display = 'flex';
      if (infoTableRef.el) infoTableRef.el.style.display = 'none';
      checklist.value = { hasJson: null, hasIcon: null, versionOk: null, hasMain: null };
      parseError.value = '';
      return;
    }

    const reader = new FileReader();
    submitButton.el.disabled = true;

    reader.onload = async () => {
      isParsing.value = true;
      parseError.value = '';
      checklist.value = { hasJson: null, hasIcon: null, versionOk: null, hasMain: null };
      
      // Simulate slight delay for smooth animation
      await new Promise(r => setTimeout(r, 600));

      try {
        const zip = await jsZip.loadAsync(reader.result);
        
        let manifestStr;
        try {
          manifestStr = await zip.file('plugin.json').async('string');
        } catch (e) {
          checklist.value = { ...checklist.value, hasJson: false };
          throw new Error('plugin.json is missing or corrupted.');
        }

        const manifest = JSON.parse(manifestStr);
        checklist.value = { ...checklist.value, hasJson: true };

        const iconFileFromManifest = manifest?.icon || 'icon.png';
        const icon = await zip.file(iconFileFromManifest)?.async('base64');
        
        if (icon) {
          checklist.value = { ...checklist.value, hasIcon: true };
        } else {
          checklist.value = { ...checklist.value, hasIcon: false };
          throw new Error('Unable to load plugin icon: no icon was provided or default icon missing.');
        }

        let validationMsg = '';
        if (id && id !== manifest.id) {
          checklist.value = { ...checklist.value, versionOk: false };
          validationMsg = 'Plugin ID is not same as previous version.';
        } else if (id && !isVersionGreater(manifest.version, plugin.version)) {
          checklist.value = { ...checklist.value, versionOk: false };
          validationMsg = 'Version should be greater than previous version.';
        } else {
          checklist.value = { ...checklist.value, versionOk: true };
        }
        
        const mainScript = await zip.file(manifest.main || 'main.js')?.async('string');
        if (mainScript) {
          checklist.value = { ...checklist.value, hasMain: true };
        } else {
          checklist.value = { ...checklist.value, hasMain: false };
          // throw new Error('Main script (e.g. main.js) is missing.');
        }

        const changelogs = (await zip.file('changelogs.md')?.async('string')) || (await zip.file('changelog.md')?.async('string'));

        if (changelogs) {
          changelogsInput.el.value = changelogs;
        }

        if (manifest.contributors) {
          contributors.value = manifest.contributors.map((contributor) => contributor.name).join(', ');
        }

        pluginId.value = manifest.id;
        pluginName.value = manifest.name;
        pluginVersion.value = manifest.version;
        pluginAuthor.value = manifest.author?.name || manifest.author || user.name;
        pluginPrice.value = +manifest.price ? `₹${manifest.price}` : 'Free';
        pluginIcon.src = `data:image/png;base64,${icon}`;
        minVersionCode.value = manifest.minVersionCode || 1;
        
        // Setup badges
        if (priceBadgeRef.el) {
          priceBadgeRef.el.className = 'badge ' + (+manifest.price ? 'primary' : 'recommended');
        }
        if (updateTypeBadgeRef.el && id) {
          if (!isVersionGreater(manifest.version, plugin.version)) {
            updateTypeBadgeRef.el.textContent = 'SAME VERSION';
            updateTypeBadgeRef.el.className = 'badge deprecated';
          } else {
            const isMajor = manifest.version.split('.')[0] !== plugin.version.split('.')[0];
            updateTypeBadgeRef.el.textContent = isMajor ? 'MAJOR UPDATE' : 'MINOR UPDATE';
            updateTypeBadgeRef.el.className = 'badge ' + (isMajor ? 'primary' : 'recommended');
          }
        }

        if (emptyStateRef.el) emptyStateRef.el.style.display = 'none';
        if (infoTableRef.el) infoTableRef.el.style.display = 'flex';
        
        if (validationMsg) {
          parseError.value = validationMsg;
          errorText.value = validationMsg;
          if (parseErrorRef.el) parseErrorRef.el.style.display = 'block';
          submitButton.el.disabled = true;
          submitButton.el.ariaDisabled = true;
        } else {
          parseError.value = '';
          errorText.value = '';
          if (parseErrorRef.el) parseErrorRef.el.style.display = 'none';
          submitButton.el.disabled = false;
          submitButton.el.ariaDisabled = false;
        }

      } catch (error) {
        console.error(error);
        parseError.value = error.message;
        if (parseErrorRef.el) parseErrorRef.el.style.display = 'block';
        if (emptyStateRef.el) emptyStateRef.el.style.display = 'flex';
        if (infoTableRef.el) infoTableRef.el.style.display = 'none';
      } finally {
        isParsing.value = false;
        hideLoading();
      }
    };

    reader.onerror = () => {
      parseError.value = 'Failed to read ZIP file.';
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

        if (parseErrorRef.el) parseErrorRef.el.style.display = 'block';
      if (parseErrorRef.el) parseErrorRef.el.style.display = 'block';