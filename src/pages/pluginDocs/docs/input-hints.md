# acode.require('inputHints')

It adds autocomplete functionality to an HTML input element.

## Parameters

- `$input` _`HTMLInputElement`_: an HTMLInputElement object representing the input element to add the autocomplete functionality.
- `hints` _`Array<string>`_: an array of strings or a callback function that returns an array of strings. The strings in this array are the possible autocomplete suggestions to be displayed when the input element is focused
- `onSelect` _`(val: string)=>void`_: a callback function that is called when an autocomplete suggestion is selected

## Example

```js
const inputHints = acode.require('inputHints');
const $input = <input type="text" id="fruits" />;
const hints = ['apple', 'banana', 'watermelon', 'guava', 'orange'];
const onSelect = (value) => {
  window.toast(value, 3000);
};
inputHints($input, hints, onSelect);
```

## Related

- [acode.require('palette')](./palette)
