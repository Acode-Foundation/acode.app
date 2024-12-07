# acode.require('fileBrowser')

It allows the user to browse and select a file/folder from their device.

**In addition to the options, the component also defines two types:**

- `BrowseMode`: a string that can be "file", "folder" or "both"
- `SelectedFile`: an object that contains the type, url and name of the selected file or folder.

## Parameters

- `mode` _`BrowserMode`_: Specify the file browser mode, the value can be 'file', 'folder' or 'both'. If no value is provided, the default is 'file'.
- `info` _`string`_: A small message to show what the file browser is opened for.
- `doesOpenLast` _`boolean`_ - Should the file browser open the lastly visited directory?
- `defaultDir` _`Array<{name: string, url: string}>`_ - Default directory to open.

## Returns

`Promise<SelectedFile>` - The component returns a promise that resolves to an object with the following properties:

- `type` _`string`_: the type of the selected item, either `'file'` or `'folder'`
- `url` _`string`_: the url of the selected item
- `name` _`string`_: the name of the selected item

## Example

```js
const fileBrowser = acode.require('fileBrowser');
const myFile = await fileBrowser('file', 'Open a sample file', true);
// you can also use defaultDir method: [{name: 'test', url: '/sdcard/test'}]
```

In this example, the file browser is opened in `"file"` mode, with a message that says `"Open a sample file"`, and it will open the last visited directory.
And it will returns `<SelectedFile> Object`
