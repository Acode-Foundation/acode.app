# Plugin Initialization

Along with the `plugin.json` file, you need to create a `main.js` file. This file is the entry point of your plugin. It is executed when the plugin is loaded. You can use this file to initialize your plugin.

In `main.js` file, you need to global variable `acode` to access the Acode API. You can use this variable to access the API methods.

To register your plugin, you have to call the `acode.setPluginInit(pluginId: string, init: Function)` method. This method takes two parameters, `pluginId` and `init` function. The `pluginId` is the ID of your plugin. The `init` function is the function that will be called when the plugin is loaded.

When the `init` function is called, it will receive 3 parameters:

- `baseUrl: string`: The base URL of the plugin. You can use this URL to access the files in the plugin directory.

- `$page: WcPage`: This page object can be used to show content.

- `cache: object`: This object can be used to access the cached files.
  - `cache.cacheFileUrl: string`: Url of the cached file.
  - `cache.cacheFile: File`: File object of the cached file. Using this object, you can write/read the file.

Here is an example of a `main.js` file:

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

The `main.js` file must also set an unmount function. This function will be called when the plugin is unloaded. You can use this function to clean up the plugin. Here is an example of an unmount function:

```js
acode.setPluginUnmount('com.example.plugin', () => {
  const { commands } = editorManager.editor;
  commands.removeCommand('example-plugin');
});
```

## Related

- [plugin.json](./plugin-manifest)
