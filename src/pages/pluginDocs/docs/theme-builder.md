# acode.require('themeBuilder')

This module is used to create a theme object that can be used as a theme for the Acode.

## Usage

```js
const ThemeBuilder = acode.require('themeBuilder');
```

## Constructor

### `new ThemeBuilder(name: string, type: 'dark'|'light')` _`ThemeBuilder`_

This method is used to create a new theme builder object.

- Parameters

  - `name (string)`: The name of the theme.
  - `type ('dark'|'light')`: The type of the theme.

- Returns

  - [`ThemeBuilder`](./theme-builder): The theme builder object.

```js
const myTheme = new ThemeBuilder('My Theme', 'dark');
```

## Methods

### `toJSON(): object`

This method is used to convert the theme builder object to a JSON object.

- Returns

  - `object`: The JSON object.

```js
const json = myTheme.toJSON();
```

## Static Methods

### `fromJSON(json: object)` _`ThemeBuilder`_

This method is used to create a theme builder object from a JSON object.

- Parameters

  - `json (object)`: The JSON object.

- Returns

  - [`ThemeBuilder`](./theme-builder): The theme builder object.

```js
const myTheme = ThemeBuilder.fromJSON(json);
```

### `fromCSS(css: string)` _`ThemeBuilder`_

This method is used to create a theme builder object from a CSS string.

- Parameters

  - `css (string)`: The CSS string.

- Returns

  - [`ThemeBuilder`](./theme-builder): The theme builder object.

```js
const myTheme = ThemeBuilder.fromCSS(css);
```

## Properties

### `name` _`string`_

The name of the theme.

### `type` _`'dark'|'light'`_

The type of the theme.

### `autoDarkened` _`boolean`_

Automatically darken the primary color.

### `preferredEditorTheme` _`string`_

The preferred editor theme.

### `preferredFont` _`string`_

The preferred font.

### `popupBorderRadius` _`string`_

The border radius of the popup.

e.g. `10px`

### `activeColor` _`string`_

### `activeTextColor` _`string`_

The color of the active element.

### `activeIconColor` _`string`_

The color of the icon of the active element.

### `borderColor` _`string`_

The color of the border.

### `boxShadowColor` _`string`_

The color of the box shadow.

### `buttonActiveColor` _`string`_

The color of the active button.

### `buttonBackgroundColor` _`string`_

The background color of the button.

### `buttonTextColor` _`string`_

The text color of the button.

### `errorTextColor` _`string`_

The text color of the error message.

### `primaryColor` _`string`_

The primary color of the application.

### `primaryTextColor` _`string`_

The text color of the primary color.

### `secondaryColor` _`string`_

The secondary color of the application.

### `secondaryTextColor` _`string`_

The text color of the secondary color.

### `linkTextColor` _`string`_

The text color of the link.

### `scrollbarColor` _`string`_

The color of the scrollbar.

### `popupBorderColor` _`string`_

The color of the popup border.

### `popupIconColor` _`string`_

The color of the popup icon.

### `popupBackgroundColor` _`string`_

The background color of the popup.

### `popupTextColor` _`string`_

The text color of the popup.

### `popupActiveColor` _`string`_

The color of the active popup element.

### `fileTabWidth` _`string`_

The width of the file tab.

The color of the active popup element.

### `css` _`string`_ (read-only)

The CSS string of the theme.

## Example

```js
const oled = new ThemeBuilder('OLED');
oled.primaryColor = 'rgb(0, 0, 0)';
oled.primaryTextColor = WHITE;
oled.darkenedPrimaryColor = 'rgb(0, 0, 0)';
oled.secondaryColor = 'rgb(0, 0, 0)';
oled.secondaryTextColor = WHITE;
oled.activeColor = 'rgb(56, 56, 56)';
oled.activeIconColor = 'rgba(255, 255, 255, 0.2)';
oled.linkTextColor = 'rgb(181, 180, 233)';
oled.borderColor = 'rgb(124, 124, 124)';
oled.popupIconColor = WHITE;
oled.popupBackgroundColor = 'rgb(0, 0, 0)';
oled.popupTextColor = WHITE;
oled.popupActiveColor = 'rgb(121, 103, 0)';
oled.popupBorderColor = 'rgba(255, 255, 255, 0.4)';
oled.boxShadowColor = BLACK;
```

## Related

- [`acode.require('Themes')`](./themes)
- [`acode.require('fonts)`](./fonts)
