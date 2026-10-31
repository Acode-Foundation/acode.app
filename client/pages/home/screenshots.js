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
import themesPng from 'res/acode-shot-themes.png';
import themesWebp from 'res/acode-shot-themes.webp';
import agentSmall from 'res/optimized/acode-shot-agent-640.webp';
import agentLarge from 'res/optimized/acode-shot-agent-1280.webp';
import commandsSmall from 'res/optimized/acode-shot-commands-360.webp';
import commandsLarge from 'res/optimized/acode-shot-commands-720.webp';
import editorSmall from 'res/optimized/acode-shot-editor-360.webp';
import editorLarge from 'res/optimized/acode-shot-editor-720.webp';
import formatterSmall from 'res/optimized/acode-shot-formatter-360.webp';
import formatterLarge from 'res/optimized/acode-shot-formatter-720.webp';
import panesSmall from 'res/optimized/acode-shot-panes-640.webp';
import panesLarge from 'res/optimized/acode-shot-panes-1280.webp';
import pluginsSmall from 'res/optimized/acode-shot-plugins-360.webp';
import pluginsLarge from 'res/optimized/acode-shot-plugins-720.webp';
import themesSmall from 'res/optimized/acode-shot-themes-360.webp';
import themesLarge from 'res/optimized/acode-shot-themes-720.webp';

const portrait = { width: 720, height: 1387 };

export const screenshots = {
  editor: {
    previewSet: `${editorSmall} 360w, ${editorLarge} 720w`,
    ...portrait,
    webp: editorWebp,
    src: editorJpg,
    alt: 'Acode editor showing TypeScript hover documentation',
    title: 'Editor & LSP',
    caption: 'Hover docs and completions.',
  },
  commands: {
    previewSet: `${commandsSmall} 360w, ${commandsLarge} 720w`,
    ...portrait,
    webp: commandsWebp,
    src: commandsPng,
    alt: 'Acode command palette with editor commands and keyboard shortcuts',
    title: 'Command palette',
    caption: 'Your next action, a few keys away.',
  },
  formatter: {
    previewSet: `${formatterSmall} 360w, ${formatterLarge} 720w`,
    ...portrait,
    webp: formatterWebp,
    src: formatterPng,
    alt: 'Acode formatter settings with Prettier and Language Server options for CSS',
    title: 'Format with Prettier',
    caption: 'Consistent code, in your editor.',
  },
  plugins: {
    previewSet: `${pluginsSmall} 360w, ${pluginsLarge} 720w`,
    ...portrait,
    webp: pluginsWebp,
    src: pluginsPng,
    alt: 'Acode plugin marketplace with language servers, formatters, and developer tools',
    title: 'Plugins',
    caption: 'More tools. One editor.',
  },
  themes: {
    previewSet: `${themesSmall} 360w, ${themesLarge} 720w`,
    ...portrait,
    webp: themesWebp,
    src: themesPng,
    alt: 'Acode theme picker with a syntax-highlighted code preview',
    title: 'Themes',
    caption: 'A workspace that feels like you.',
  },
  agent: {
    previewSet: `${agentSmall} 640w, ${agentLarge} 1280w`,
    webp: agentWebp,
    src: agentJpg,
    width: 1800,
    height: 1125,
    alt: 'Acode on a tablet running OpenCode beside the project file tree',
    title: 'AI agents',
    caption: 'OpenCode beside your project files.',
  },
  panes: {
    previewSet: `${panesSmall} 640w, ${panesLarge} 1280w`,
    webp: panesWebp,
    src: panesJpg,
    width: 1800,
    height: 1125,
    alt: 'Acode with four split panes: Dockerfile, JSON, config.xml, and an Alpine Linux terminal',
    title: 'Split panes',
    caption: 'Editors, config, and a Linux terminal. One workspace.',
  },
};
