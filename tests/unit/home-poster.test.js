// @vitest-environment jsdom
import fs from 'node:fs';
import vm from 'node:vm';
import { transformFromAstSync, transformSync, types } from '@babel/core';
import tag from 'html-tag-js';

it('renders the actual hero poster JSX with a high-priority content attribute', () => {
  let poster;
  transformSync(fs.readFileSync('client/pages/home/index.js', 'utf8'), {
    configFile: false,
    babelrc: false,
    plugins: [
      'html-tag-js/jsx/syntax-parser.js',
      () => ({
        visitor: {
          JSXElement(path) {
            if (path.node.openingElement.attributes.some((attr) => attr.name?.name === 'className' && attr.value?.value === 'home-demo__poster'))
              poster = types.cloneNode(path.node, true);
          },
        },
      }),
    ],
  });
  expect(poster).toBeDefined();
  const { code } = transformFromAstSync(types.file(types.program([types.expressionStatement(poster)])), undefined, {
    configFile: false,
    babelrc: false,
    plugins: ['html-tag-js/jsx/jsx-to-tag.js'],
  });
  const image = vm.runInNewContext(code, { tag, demoPoster: '/poster.webp', posterSmall: '/small.webp', posterMedium: '/medium.webp' });
  expect(image.getAttribute('fetchpriority')).toBe('high');
  expect(image.getAttribute('srcset')).toContain('/small.webp 480w');
});
