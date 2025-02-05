# acode.require('fs')

The fs module provides an API for interacting with the file system in Acode. It allows for operations such as reading, writing, and manipulating files and directories.

Parameters:
`url: string`

> url : either the location of any file or directory

Returns:
`{FileSystem}`

Example:

```js
const fs = acode.require('fs');
const filesystem = await fs(url); // {FileSystem}
```

## Methods

- `lsDir()`

  - Returns `Promise<Array<Entry>>`
  - It is used to list the contents of a specified directory, including all subdirectories and files within it.
  - For eg:

    ```js
    const allFiles = await fs(url).lsDir();
    ```

- `readFile(_encoding: string_)`

  - Returns `Promise <string | ArrayBuffer>`
  - It allows you to read the contents of a specified file.
  - For eg:

    ```js
    const readFile = await fs(url).readFile();
    ```

- `createFile(name: string, content: string)`

  - Parameters `name: string, content: string`
  - Returns `Promise<string>`
  - It creates a new, empty file in the specified location with the specified file {name}. If a file with the same name already exists, it will be overwritten.
  - For eg:

    ```js
    const file = await fs("location where you want to create").createFile("filename with extension(for eg: index.js)","file content(for eg: console.log("hello")));
    ```

  - or

    ```js
    const file = await fs(
      'location where you want to create file with filename and extension'
    ).createFile('file content');
    ```

- `writeFile(content: string | ArrayBuffer)`

  - Parameters `content {string | ArrayBuffer}`
  - Returns `Promise<void>`
  - It used to write data to a file.
  - For eg:

    ```js
    const file = await fs(
      'location of file, for eg: /sdcard/test/index.js'
    ).writeFile('the content which you want to write');
    ```

- `createDirectory(name: string)`:

  - Parameters `name:string`
  - Returns `Promise<string>`
  - It is used to create a new directory in the file system.
  - For eg:

    ```js
    const folder = await fs(
      'url where to create new directory'
    ).createDirectory('name of new directory');
    ```

- `delete()`

  - Returns `Promise<void>`
  - It is used to remove a specified file or directory from the file system. It is important to use caution when using this method as deleted files and directories cannot be recovered.
  - For eg:

    ```js
    const deletedFile = await fs(
      'url of folder/file which is going to delete'
    ).delete();
    ```

- `copyTo(destination: string)`

  - Parameters `destination: string`
  - Returns `Promise<string>`
  - It is used to copy a file or directory from a specified source path to a specified destination path.
  - For eg:

    ```js
    const copyFile = await fs('url of file which you want to copy').copyTo(
      'destination'
    );
    ```

- `moveTo(destination: string)`

  - Parameters `destination: string`
  - Returns `Promise<string>`
  - It allows you to move a file or directory from its current location to a new destination.
  - For eg:

    ```js
    const moveFile = await fs('url of file which you want to move').moveTo(
      destination
    );
    ```

- `renameTo(newName: string)`

  - Parameters `newName: string`
  - Returns `Promise<string>`
  - It allows for the renaming of a file or directory.
  - For eg:

    ```js
    const renameFile = await fs(
      'url of file which you want to rename'
    ).renameTo('new name');
    ```

- `exists()`

  - Returns `Promise<Boolean>`
  - It checks if a specified file or directory exists in the file system and returns a boolean value indicating the result.
  - For eg:

    ```js
    const exists = await fs('url of file/folder').exists();
    ```

- `stat()`

  - Returns `Promise<Stat>`
  - It retrieves information about a file, including its size, creation and modification date, and file permissions(such as can write, isFile, isDirectory). It returns a Stats object containing the requested information.
  - For eg:

    ```js
    const fileStats = await fs('url of file').stat();
    ```

## Related

Encode and decode file content using [acode.require('encodings')](./encodings)
