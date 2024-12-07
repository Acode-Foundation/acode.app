# window.editorManager

It allows developers to interact with the Ace editor with the help of different methods

## Methods

- `editor`

  - This is an instance of the Ace editor. Check out editor methods [here](https://ace.c9.io/#nav=howto&api=editor)
  - For adding/removing command in command platte use `commands` method:
    - For adding : `editorManager.editor.commands.addCommand("command name or command object")`
    - For removing : `editorManager.editor.commands.removeCommand("command name or command object")`

- `addNewFile(filename?:string, options?: object)`

  - This function adds a new file to the workspace.
    - `filename` _`string`_: the name of the file.
    - `options` _`object`_ : an optional object that can be passed with the following properties:
      - `text` _`string`_: the file content.
      - `isUnsaved` _`boolean`_: whether the file is unsaved.
      - `render` _`boolean`_: whether to switch to this file.
      - `id` _`string`_: a unique id for the file.
      - `uri` _`string`_: the file's uri, or location.
      - `record`: Record
      - `deletedFile` _`boolean`_: whether the file is deleted.
      - `readOnly` _`boolean`_: whether the file is read-only
      - `mode` _`string`_: the SAF (Storage access framework) mode (TREE | SINGLE).
      - `type` _`string`_: the file type (regular | git | gist).
      - `encoding` _`string`_: the file encoding.
      - `onsave` _`()=>void`_: callback function called when the file is saved.

- `getFile(test: any, type: string)`

  - This function gets files from the list of opened files.
    - `test` _`object`_: the file id, uri, repo, or gist to find the file.
    - `type` _`string`_: the type of test (uri | id | name | git | gist).

- `switchFile(id: string)`

  - This function switches the tab to the given file id.

- `activeFile` _`object`_

  - This property returns the current file.

- `hasUnsavedFiles()`

  - This function returns the number of unsaved files.

- `files` _`Array<object>`_

  - This property returns a list of all files.

- `setSubText(file: File)`

  - This function sets the sub text of the header, i.e. the location of the file.

- `container` _`HTMLElement`_

  - This property returns the container of the editor.

- `on(event: string, listener(): void)`

  - This function adds a listener for the specified event.

- `off(event: string, listener(): void)`

  - This function removes a listener for the specified event.

- `emit(event: string, ...args: ...any)`

  - This function emits an event with the specified arguments.

- `isScrolling` _`boolean`_

  - Weather the editor is currently scrolling.

- List of events:
  - `switch-file`
  - `rename-file`
  - `save-file`
  - `file-loaded`
  - `file-content-changed`
  - `add-folder`
  - `remove-folder`
  - `new-file`
  - `init-open-file-list`
  - `update`
