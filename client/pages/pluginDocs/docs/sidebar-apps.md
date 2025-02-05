# acode.require('sidebarApps')

You can add mini apps to the sidebar using this module.

## Usage

```js
const sidebarApps = acode.require('sidebarApps');
```

## Methods

### `add(icon: string, id: string, title: string, initFunction: Function)`

This method is used to add a new sidebar app to the sidebar app list.

- Parameters

  - `icon` _`string`_: Class name of icon.
  - `id` _`string`_: The id of the sidebar app.
  - `title` _`string`_: The title of the sidebar app.
  - `initFunction` _`()=>void`_: The function to be called when the sidebar app is opened.
    - Parameters
      - `app` _`HTMLElement`_: The sidebar app element.

```js
acode.addIcon('my-icon', 'https://acode.app/my-icon.svg');
sidebarApps.add('my-icon', 'my-sidebar-app', 'My Sidebar App', (app) => {
  app.innerHTML = 'Hello World!';
});
```

### `get(id: string)` _`HTMLElement`_

This method is used to get a sidebar app from the sidebar app list.

- Parameters

  - `id` _`string`_: The id of the sidebar app to be retrieved.

- Returns

  - `HTMLElement`: The sidebar app element.

```js
const app = sidebarApps.get('my-sidebar-app');
```
