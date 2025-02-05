# acode.require('toInternalUrl')

The `toInternalUrl` component of Acode is a functions that allows for the conversion of `file://` URLs to internal URLs. This can be useful when making `Ajax` or `fetch` requests.

## Parameters

- `url` _`string`_: `file:///` urls

> Returns a Promise.

## Example

```js
const toInternalUrl = acode.require('toInternalUrl');
let newUrl = await toInternalUrl('file:///path/to/file.txt');
// now use newUrl in your Ajax or fetch request.
```
