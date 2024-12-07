# acode.require('themes')

Acode supports themes. You can add new themes using this module.

## Usage

```js
const themes = acode.require('themes');
```

## Methods

### `add(theme: ThemeBuilder)`

This method is used to add a new theme to the theme list.

- Parameters

  - [`theme` _`ThemeBuilder`_](./theme-builder): The theme to be added.

```js
const theme = new ThemeBuilder('My Theme', 'dark');
themes.add(theme);
```

### `get(name: string)` _`ThemeBuilder`_

This method is used to get a theme from the theme list.

- Parameters

  - `name` _`string`_: The name of the theme to be retrieved.

- Returns

  - [`ThemeBuilder`](./theme-builder): The theme object.

```js
const theme = themes.get('My Theme');
```

### `update(theme: ThemeBuilder)`

This method is used to update a theme in the theme list.

- Parameters

  - `theme` [_`ThemeBuilder`_](./theme-builder): The theme to be updated.

```js
themes.update(theme);
```

### `list()` _`string[]`_

List all the themes in the theme list.

- Returns

  - `string[]`: The names of all the themes in the theme list.

```js
const themeNames = themes.list();
```

## Related

- [`acode.require('ThemeBuilder')`](./theme-builder)
- [`acode.require('fonts)`](./fonts)
