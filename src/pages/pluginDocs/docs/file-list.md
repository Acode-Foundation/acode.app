# `acode.require("fileList")`

A function that returns a tree structure of the files in the workspace.

## Usage

```js
const fileList = acode.require('fileList');
const list = await fileList();

list.forEach((item) => {
  console.log(item.name, item.path);
});
```

## Tree

Tree is an object that represents a file or a folder in the workspace.

### Properties

- `name` _`string`_: The name of the file or folder.
- `url` _`string`_: The url of the file or folder. (Absolute)
- `path` _`string`_: The path of the file or folder.(Relative)
- `children` _`Array<Tree>`_: An array of children of the file or folder.
- `parent` _`Tree`_: The parent of the file or folder.
- `isConnected` _`boolean`_: A boolean that specifies if the root of the tree is added to the open folder list.
- `root` _`Tree`_: The root of the tree.
- `update(url: string, name?: string): void`: A function that updates the url and name of the file or folder.
- `toJSON(): object`: A function that returns a JSON representation of the tree.
- `static fromJSON(json: object): Tree`: A function that returns a tree from a JSON representation.
- `static create(url: string, name?: string, isDirectory?: boolean): Tree`: A function that creates a tree from a url and name.
