# window.acode

The `window.acode` object is the global object that provides access to the Acode API. You can use this object to access the API methods.

## Methods

### `setPluginInit(pluginId: string, init: Function, settings? Object)`

This method is used to register the plugin. This method takes two parameters, `pluginId` and `init` function. The `pluginId` is the ID of your plugin. The `init` function is the function that will be called when the plugin is loaded.

#### `init(baseUrl: string, $page: WCPage, options: object)`

When the `init` function is called, it will receive 3 parameters:

- `baseUrl` _`string`_: The base URL of the plugin. You can use this URL to access the files in the plugin directory.
- `$page` _`WcPage`_: This page object can be used to show content.
- `options` _`object`_: This object can be used to access the cached files.
  - `cacheFileUrl` _`string`_: Url of the cached file.
  - `cacheFile` _`File`_: File object of the cached file. Using this object, you can write/read the file.
  - `firstInit` _`boolean`_: If this is the first time the plugin is loaded, this value will be `true`. Otherwise, it will be `false`.

#### `settings` _`Object`_

This parameter is optional. You can use this parameter to define the settings of the plugin. The settings will be displayed in the plugin page.

Settings requires the following properties:

- `list` _`Array<object>`_: An array of settings.

  - `key` _`string`_: The key of the setting. This key will be used to access the value of the setting.
  - `text` _`string`_: The text of the setting. This text will be displayed in the settings page.
  - `icon?` _`string`_: The icon of the setting. This icon will be displayed in the settings page.
  - `iconColor?` _`string`_: The icon color of the setting. This icon color will be displayed in the settings page.
  - `info?` _`string`_: The info of the setting. This info will be displayed in the settings page.
  - `value?` _`any`_: The value of the setting. This value will be displayed in the settings page.
  - `valueText?` _`(value:any)=>string`_: The value text of the setting. This value text will be displayed in the settings page.
  - `checkbox?` _`boolean`_: If this property is set to `true`, the setting will be displayed as a checkbox.
  - `select?: Array<Array<string>|string>`: If this property is set to an array, the setting will be displayed as a select. The array should contain the options of the select. Each option can be a string or an array of two strings. If the option is a string, the value and the text of the option will be the same. If the option is an array of two strings, the first string will be the value of the option and the second string will be the text of the option.
  - `prompt?` _`string`_: If this property is set to `true`, the setting will be displayed as a prompt.
  - `promptType?` _`string`_: The type of the prompt. This property is only used when the `prompt` property is set to `true`. The default value is `text`.
  - `promptOptions?` _`Array<object>`_: The options of the prompt. This property is only used when the `prompt` property is set to `true` and the `promptType` property is set to `select`.
    - `match` _`RegExp`_: The regular expression to match the value.
    - `required` _`boolean`_: If this property is set to `true`, the value is required.
    - `placeholder` _`string`_: The placeholder of the prompt.
    - `test` _`(value: any) => boolean`_: The test function to test the value.

- `cb` _`(key: string, value: any) => void`_: The callback function that will be called when the settings are changed.

Example:

```js
acode.setPluginInit('com.example.plugin', (baseUrl, $page, cache) => {
  const { commands } = editorManager.editor;
  commands.addCommand({
    name: 'example-plugin',
    bindKey: { win: 'Ctrl-Alt-E', mac: 'Command-Alt-E' },
    exec: () => {
      $page.content = `
        <h1>Example Plugin</h1>
        <p>This is an example plugin.</p>
      `;
      $page.show();
    },
  });
});
```

### `setPluginUnmount(pluginId: string, unmount: Function)`

This method is used to set the unmount function. This function will be called when the plugin is unloaded. You can use this function to clean up the plugin.

Example:

```js
acode.setPluginUnmount('com.example.plugin', () => {
  const { commands } = editorManager.editor;
  commands.removeCommand('example-plugin');
});
```

### `define(moduleName: string, module: any)`

This method is used to define a module. This method takes two parameters, `moduleName` and `module`. The `moduleName` is the name of the module. The `module` is the module object. Module name is case insensitive.

Example:

```js
acode.define('say-hello', {
  hello: () => {
    console.log('Hello World!');
  },
});

// You can access the module using the module name

acode.require('say-hello').hello(); // Hello World!
```

### `require(moduleName: string)` _`any`_

This method is used to require a module. This method takes one parameter, `moduleName`. The `moduleName` is the name of the module. Module name is case insensitive.

Example:

```js
acode.require('say-hello').hello(); // Hello World!
```

### `exec(command: string, value?: any)`

This method executes a command defined in file `src/lib/commands.js`. This method takes one or two parameters, `command` and `value`. The `command` is the name of the command. The `value` is the value of the command. Command name is case insensitive.

Example:

```js
acode.exec('console'); // Opens the console
```

### `registerFormatter(pluginId: string, extensions: string[], format: Function)`

This method is used to register a formatter. This method takes three parameters, `pluginId`, `extensions` and `format` function. The `pluginId` is the ID of your plugin. The `extensions` is an array of file extensions. The `format` function is the function that will be called when the file is formatted.

Example:

```js
acode.registerFormatter('com.example.plugin', ['js'], () => {
  // formats the active file if supported
  const text = editorManager.editor.session.getValue();
  // format the text
  editorManager.editor.session.setValue(text);
});
```

### `unregisterFormatter(pluginId: string)`

This method is used to unregister a formatter. This method takes one parameter, `pluginId`. The `pluginId` is the ID of your plugin.

### `addIcon(iconName: string, iconSrc: string)`

This method is used to add an icon. This method takes two parameters, `iconName` and `iconSrc`. The `iconName` is the name of the icon. The `iconSrc` is the URL of the icon.

Example:

```js
acode.addIcon('my-icon', 'https://example.com/icon.png');
```

Later you can use the icon by adding to class name `my-icon` to an element.

Example:

```html
<i class="icon my-icon"></i>
```

### `toInternalUrl(url: string)` _`Promise<string>`_

When making `Ajax` or `fetch` requests, you need to convert `file://` URLs to internal URLs.
