# acode.require('openFolder')

It allows the user to open a specified folder `in side nav`.

## Parameters

This component takes two parameters:

- `_path` _`string`_: The path of the folder to be opened. This is a required parameter.
- `opts` _`object`_: An optional object that can contain additional options for the component.
  - `name` _`string`_: A name to be assigned to the folder. If not provided, the name of the folder will be the same as the name of the folder on the file system.
  - `id` _`string`_: An id to be assigned to the folder. If not provided, an id will be automatically generated.
  - `saveState` _`boolean`_: A flag that determines whether or not the state of the folder should be saved when the user closes it. The default value is `true`.
  - `reloadOnResume` _`boolean`_: A flag that determines whether or not the folder should be reloaded when the user reopens it. The default value is `true`.

## Example

```js
const openFolder = acode.require('openFolder');
const opts = {
  name: 'My Documents',
  id: 'folder-1',
  saveState: false,
  reloadOnResume: false,
};
openFolder('/path/to/my/documents', opts);
```

This will open the folder located at `"/path/to/my/documents"` in `side nav` and assign it the name `"My Documents"` and id `"folder-1"`. The state of the folder will not be saved when the user closes it and it will not be reloaded when the user reopens it.
