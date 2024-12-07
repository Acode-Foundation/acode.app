# acode.require('encodings')

Used to encode and decode strings with different encodings.

## Usage

```js
const encodings = acode.require('encodings');
```

## Methods

### `encode(text: string, charset: string): Promise<ArrayBuffer>`

Encodes a string with the specified charset.

- `text` _`string`_ : text to encode
- `charset` _`string`_ : charset name e.e. UTF-8, GBK

### `decode(buffer: ArrayBuffer, charset: string): Promise<string>`

Decodes a string with the specified charset.

- `buffer` _`ArrayBuffer`_ : file to decode
- `charset` _`string`_ : charset name e.e. UTF-8, GBK

## Properties

### `encodings` _`Array<Encoding>`_

An array of all the supported encodings.

## type: Encoding

An object that represents an encoding.

- `name` _`string`_: The name of the encoding.
- `labels` _`string`_: The labels of the encoding.
- `aliases` _`string`_: The aliases of the encoding.

## Example

```js
const encodings = acode.require('encodings');

const text = 'Hello World!';
const charset = 'utf-8';

const encoded = await encodings.encode(text, charset);
const decoded = await encodings.decode(encoded, charset);
```

## Related

- [acode.require('fs')](/docs/fs-operation)
