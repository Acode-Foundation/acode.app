import agentJpg from 'res/acode-shot-agent.jpg';
import agentWebp from 'res/acode-shot-agent.webp';
import commandsPng from 'res/acode-shot-commands.png';
import commandsWebp from 'res/acode-shot-commands.webp';
import editorJpg from 'res/acode-shot-editor.jpg';
import editorWebp from 'res/acode-shot-editor.webp';
import formatterPng from 'res/acode-shot-formatter.png';
import formatterWebp from 'res/acode-shot-formatter.webp';
import panesJpg from 'res/acode-shot-panes.jpg';
import panesWebp from 'res/acode-shot-panes.webp';
import pluginsPng from 'res/acode-shot-plugins.png';
import pluginsWebp from 'res/acode-shot-plugins.webp';
import searchPng from 'res/acode-shot-search.png';
import searchWebp from 'res/acode-shot-search.webp';
import sftpPng from 'res/acode-shot-sftp.png';
import sftpWebp from 'res/acode-shot-sftp.webp';
import terminalJpg from 'res/acode-shot-terminal.jpg';
import terminalWebp from 'res/acode-shot-terminal.webp';
import themesPng from 'res/acode-shot-themes.png';
import themesWebp from 'res/acode-shot-themes.webp';

const portrait = { width: 720, height: 1387 };

export const screenshots = {
  editor: {
    ...portrait,
    webp: editorWebp,
    src: editorJpg,
    alt: 'Acode editor showing TypeScript hover documentation',
    title: 'Editor & LSP',
    caption: 'Hover docs and completions.',
  },
  terminal: {
    ...portrait,
    webp: terminalWebp,
    src: terminalJpg,
    alt: 'Acode Linux terminal installing npm packages',
    title: 'Linux terminal',
    caption: 'Alpine. apk, npm, git, python.',
  },
  sftp: {
    ...portrait,
    webp: sftpWebp,
    src: sftpPng,
    alt: 'Acode SFTP connection setup with password and key-file authentication options',
    title: 'SFTP',
    caption: 'Connect to your remote files.',
  },
  commands: {
    ...portrait,
    webp: commandsWebp,
    src: commandsPng,
    alt: 'Acode command palette with editor commands and keyboard shortcuts',
    title: 'Command palette',
    caption: 'Your next action, a few keys away.',
  },
  search: {
    ...portrait,
    webp: searchWebp,
    src: searchPng,
    alt: 'Acode project-wide search panel with case, whole-word, and regular-expression options',
    title: 'Project-wide search',
    caption: 'Find it across your project.',
  },
  formatter: {
    ...portrait,
    webp: formatterWebp,
    src: formatterPng,
    alt: 'Acode formatter settings with Prettier and Language Server options for CSS',
    title: 'Format with Prettier',
    caption: 'Consistent code, in your editor.',
  },
  plugins: {
    ...portrait,
    webp: pluginsWebp,
    src: pluginsPng,
    alt: 'Acode plugin marketplace with language servers, formatters, and developer tools',
    title: 'Plugins',
    caption: 'More tools. One editor.',
  },
  themes: {
    ...portrait,
    webp: themesWebp,
    src: themesPng,
    alt: 'Acode theme picker with a syntax-highlighted code preview',
    title: 'Themes',
    caption: 'A workspace that feels like you.',
  },
  agent: {
    webp: agentWebp,
    src: agentJpg,
    width: 1800,
    height: 942,
    alt: 'Acode on a tablet running OpenCode beside the project file tree',
    title: 'AI agents',
    caption: 'OpenCode beside your project files.',
  },
  panes: {
    webp: panesWebp,
    src: panesJpg,
    width: 1800,
    height: 951,
    alt: 'Acode with four split panes: Dockerfile, JSON, config.xml, and an Alpine Linux terminal',
    title: 'Split panes',
    caption: 'Editors, config, and a Linux terminal. One workspace.',
  },
};

export const heroScreenshots = [
  screenshots.editor,
  screenshots.terminal,
  screenshots.sftp,
  screenshots.commands,
  screenshots.search,
  screenshots.formatter,
  screenshots.plugins,
  screenshots.themes,
];
