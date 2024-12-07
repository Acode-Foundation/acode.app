# Plugin.json

**Plugin.json** is a manifest file that contains information about the plugin, such as name, description, author, etc. It is required for every plugin.

```json
{
  "id": "ID of the plugin, reverse domain name format",
  "name": "Name of the plugin",
  "main": "Path to the main.js file",
  "version": "Version of the plugin",
  "readme": "Path to the readme.md file",
  "icon": "Path to the icon.png file",
  "files": ["List of files to be included in the plugin zip file"],
  "minVersionCode": "Minimum acode version code required to run the plugin",
  "price": "Price of the plugin in INR (min. 10 and max. 10000), if 0 or omitted, plugin is free, this can be changed later.",
  "author": {
    "name": "Author name",
    "email": "Author email",
    "url": "Author url",
    "github": "Author github username"
  }
}
```

If you want to publish update of your plugin, you need to increase the version number in the plugin.json file and if you want update name, description, icon, etc. you have to upload new zip file.

For example, if you want to change plugin price, change the price in plugin.json file and upload the new zip file.

An example of a plugin.json file:

```json
{
  "id": "com.example.plugin",
  "name": "Example Plugin",
  "main": "dist/main.js", // 'dist' will be the root directory
  "version": "1.0.0",
  "readme": "readme.md",
  "icon": "icon.png",
  "files": ["worker.js"], // files will be looked for in 'dist' folder
  "minVersionCode": 292, // if mentioned, plugin will be available only for acode version >= 292
  "price": 0,
  "author": {
    "name": "Example Author",
    "email": "example@email.com",
    "url": "https://example.com",
    "github": "example"
  }
}
```

## Related

- [main.js](./main-js)
