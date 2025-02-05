# acode.require('helpers')

It provide a variety of utility functions for the application.
All the methods of `helpers` components are listed below with their uses.

## `getIconForFile()`

This helper method takes in a single parameter, a string named 'filename', and returns a string representing an icon class for the file specified by the filename. The icon class returned corresponds to the file type, which is determined by the file extension of the provided filename.
In simple, It will return icon according to filename.

- Parameters

  - `filename {string}`: The name of the file for which the icon class is to be returned.

- Returns
  - A string representing an icon class for the file specified by the filename. The icon class returned corresponds to the file type, which is determined by the file extension of the provided filename.

## `isFile()` _`boolean`_

This method is used to check whether given `type` is file or not

This method takes one parameter, which is the `type` that needs to be checked. The type must be passed in as a `string`, and can only be either `"file" or "link"`.

It returns `boolean`

## `isDir()` _`boolean`_

It checks whether the given type is a `directory or not`. The method takes in one parameter, the `type` of the item being checked. The type can be one of the following: `'dir', 'directory', or 'folder'`.

## `decodeText()` _`string`_ (Deprecated)

> **Deprecated** - This method is deprecated and will be removed in a future release. Please use [acode.require('encodings')](./encodings) instead.

This method is a helper component that allows for the conversion of an `ArrayBuffer` to a `string` using a specified encoding type.

The method takes in two parameters, the first being the `ArrayBuffer` that needs to be decoded, and the second being an optional encoding type. The default encoding type is `'utf-8'`.
