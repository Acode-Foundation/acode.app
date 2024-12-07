# `window.addedFolder` _`Array<object>`_

The `window.addedFolder` object is the global object that provides access to the currently open folders in the sidenav.

## Properties

- `url` _`string`_: The URL of the folder.
- `remove` _`()=>void`_: Removes the folder from the sidenav.
- `$node` _`HTMLElement`_: The HTML element of the folder.
- `reload` _`()=>void`_: Reloads the folder.
- `listState` _`Map<dir:string, open:boolean>`_: The state of the folders in the folder.
- `reloadOnResume` _`boolean`_: Whether to reload the folder when the app resumes.
- `saveState` _`boolean`_: Whether to save the state of the folder when the app is closed.
- `title` _`string`_: The title of the folder.
- `id` _`string`_: The ID of the folder.
