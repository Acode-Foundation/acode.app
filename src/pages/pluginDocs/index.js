import Docs from 'components/docs';
import { marked } from 'marked';

export default function PluginDocs({ doc = 'getting-started', title }) {
  const ACE_DOCS = 'https://ajaxorg.github.io/ace-api-docs/index.html';
  const constants = {
    ASSETS_DIRECTORY: '`<string>` The directory where all the assets are stored.',
    CACHE_STORAGE: '`<string>` The directory where all the cache files are stored.',
    DATA_STORAGE: '`<string>` The directory where all the data files are stored.',
    PLUGIN_DIR: '`<string>` The directory where all the plugins are stored.',
    DOES_SUPPORT_THEME: '`<boolean>` Whether the app supports theme or not.',
    IS_FREE_VERSION: '`<boolean>` Whether the app is free version or not.',
    KEYBINDING_FILE: '`<string>` The file where all the keybindings are stored.',
    ANDROID_SDK_INT: '`<number>` The Android SDK version.',
  };

  if (doc === 'ace') {
    window.location.href = ACE_DOCS;
    return null;
  }

  const docs = [
    'getting-started',
    'plugin-manifest',
    'main-js',
    'global-api',
    [
      'ace',
      'acode',
      'added-folder',
      'editor-manager',
      ...Object.keys(constants),
    ],
    'dialog-box',
    [
      'box',
      'alert',
      'confirm',
      'color-picker',
      'loader',
      'multi-prompt',
      'prompt',
      'select',
    ],
    'url',
    'toast',
    'action-stack',
    'fs-operation',
    'projects',
    'selection-menu',
    'file-browser',
    'file-list',
    'to-internal-url',
    'editor-file',
    'page',
    'palette',
    'settings',
    'helpers',
    'input-hints',
    'open-folder',
    'fonts',
    'themes',
    'theme-builder',
    'sidebar-apps',
    'side-button',
    'context-menu',
    'ace-modes',
    'encodings',
    'intent',
  ];

  return <Docs docs={docs} doc={doc} load={load} base='/plugin-docs' title={title} />;

  async function load(docName) {
    if (docName === 'ace') {
      window.location.href = ACE_DOCS;
      return null;
    }

    if (constants[docName.toUpperCase()]) {
      return `<h1>${docName}</h1><p>${marked(constants[docName.toUpperCase()])}</p>`;
    }

    try {
      const { default: mdFile } = await import(`./docs/${docName}.md`);
      return marked(mdFile, {
        highlight(code, lang) {
          const { value } = window.hljs.highlight(code, { language: lang, style: 'base16/zenburn' });
          return value;
        },
      });
    } catch (error) {
      return `<h1>ERROR</h1> <p class="error" >${error.message}</p>`;
    }
  }
}
