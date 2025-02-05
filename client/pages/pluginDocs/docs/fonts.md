# acode.require('fonts')

You can add new fonts using this module.

## Usage

```js
const fonts = acode.require('fonts');
```

## Methods

### `add(name: string, css: string)`

This method is used to add a new font to the font list.

- Parameters

  - `name (string)`: The name of the font to be added.
  - `css (string)`: The css for the font to be added.

```js
add(
  'Noto Mono',
  `@font-face {
  font-display: swap;
  font-family: 'Noto Mono';
  src: url(https://acode.app/NotoMono-Regular.woff) format("woff");
  font-weight: 400;
  font-style: normal;
  unicode-range: U+0590-06FF;
}`
);
```

### `get(name: string)` _`Font`_

This method is used to get a font from the font list.

- Parameters

  - `name (string)`: The name of the font to be retrieved.

- Returns

  - `Font`: The font object.
    - `name (string)`: The name of the font.
    - `css (string)`: The css for the font.

```js
const font = get('Noto Mono');
```

### `getNames()` _`string[]`_

This method is used to get the names of all the fonts in the font list.

- Returns

  - `string[]`: The names of all the fonts in the font list.

```js
const fontNames = getNames();
```

### `setFont(name: string)`

This method is used to set the font for the editor.

- Parameters

  - `name (string)`: The name of the font to be set.

```js
setFont('Noto Mono');
```

## Related

- [`acode.require('ThemeBuilder')`](./theme-builder)
- [`acode.require('Themes')`](./themes)
