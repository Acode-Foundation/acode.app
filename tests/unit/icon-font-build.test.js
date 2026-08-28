import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { compileString } from 'sass';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');

function getStylesheetRules() {
  const config = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'webpack.config.js'), 'utf8'), {
    __dirname: root,
    module: config,
    require: (name) => (name === 'node:fs' ? { existsSync: () => false } : require(name)),
  });
  // Do not let the config's normal build-directory cleanup run in unit tests.
  return config.exports({}, { mode: 'production' })[0].module.rules;
}

describe('production icon font stylesheet', () => {
  it('keeps Sass encoding markers out of concatenated stylesheets', () => {
    const rules = getStylesheetRules();
    const iconCss = fs.readFileSync(path.join(root, 'client/res/icons/style.css'), 'utf8');
    for (const filename of ['icons.css', 'main.scss', 'component.module.scss']) {
      const rule = rules.find((candidate) => candidate.test.test(filename));
      const loader = rule.use.find((entry) => entry.loader === 'sass-loader');
      const { css } = compileString(iconCss, { style: 'compressed', ...loader.options.sassOptions });
      expect(css).not.toContain('\uFEFF');
      expect(css).toMatch(/^@font-face\{/);
      expect(css).toContain('font-family:"acode"');
      expect(css).toContain('.icon.googleplay:before');
    }
  });

  it('defines an icon for every static icon class used by the client', () => {
    const iconCss = fs.readFileSync(path.join(root, 'client/res/icons/style.css'), 'utf8');
    const supported = new Set([...iconCss.matchAll(/\.icon\.([\w-]+):before/g)].map((match) => match[1]));
    const client = path.join(root, 'client');
    const missing = [];
    for (const file of fs.readdirSync(client, { recursive: true })) {
      if (!file.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(client, file), 'utf8');
      for (const match of source.matchAll(/className=['"]icon ([^'"]+)['"]/g)) {
        if (!match[1].split(/\s+/).some((name) => supported.has(name))) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
