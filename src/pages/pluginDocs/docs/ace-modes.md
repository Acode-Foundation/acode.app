# acode.require('aceModes)

This object is used to set/remove ace modes.

## Methods

### `addMode(name, extensions, caption)`

Adds a new mode to ace editor.

- `name` _`string`_ - mode name
- `extensions` _`string|string[]`_ - array of extensions
- `caption` _`string`_ - mode caption or display name

Example:

```js
const { addMode } = acode.require('aceModes');

addMode('myMode', ['ext'], 'My Mode');
```

### `removeMode(name)`

Removes a mode from ace editor.

- `name` _`string`_ - mode name

example:

```js
const { removeMode } = acode.require('aceModes');

removeMode('myMode');
```

### Example plugin

- [acode-plugin-smali](https://github.com/deadlyjack/acode-plugin-smali) - An Acode plugin to add smali syntax highlighting.
