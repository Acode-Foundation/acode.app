# Acode plugins

Acode plugins are a way to extend the functionality of Acode. They can be used to add new features, or to modify existing ones. Plugins are written in JavaScript and can be installed from the Acode plugin manager.

## News

- [acode.require('intent')](/plugin-docs/intent) - add or remove intent handler. (v1.8.7 (323))

## Installing plugins

There are multiple ways to install plugins:

- Download the plugin file to your device, open [Acode](https://play.google.com/store/apps/details?id=com.foxdebug.acodefree), go to settings, plugins, click on '+' icon, select `LOCAL`.

- If you have a plugin file url (e.g. plugin file on github) open **Acode**, go to settings, plugins, click on '+' icon, select `REMOTE`.

- Or you can install plugins from the **Acode** plugins manager from settings, click on available plugin and click on install.

**Note:** Installed plugin will remember their source, if you choose to uninstall and install again, it will install from the same source.

**Caution:** Be careful when installing plugins from unknown sources. Plugins can contain malicious code.

## Creating plugins

Plugins are written in JavaScript and can be created using any text editor. The plugin file must be a zip file with the following structure:

- [`plugin.json`](/plugin-docs/plugin-manifest) - contains information about the plugin, such as name, description, author, etc.

- [`main.js`](/plugin-docs/main-js) - contains the plugin code.

You can use the [plugin template](https://github.com/deadlyjack/acode-plugin) to get started. It contains all the necessary files and a basic plugin example.

Using the plugin template, you can start dev server using `npm run start-dev` or `yarn start-dev`. When dev server is running, it will watch for changes and create plugin zip file file, which you install it using `REMOTE` option. `REMOTE` will ask for plugin url, you can use `http://<ip (e.g. 192.168.29.77)>:3000/dist.zip` to install plugin. You need to reinstall plugin after every change.

`npm run build-release` or `yarn build-release` will create a release build, which you can publish Acode's official [website](https://acode.app/publish).
