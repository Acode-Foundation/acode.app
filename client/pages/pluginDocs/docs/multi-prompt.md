# acode.require('multiPrompt')

`multiPrompt` is a component in `Acode` that allows for the prompt of multiple inputs at once.

## Parameters

- `message` _`string`_: The title for the prompt modal.
- `inputs` _`Array<Input|Array<Input>>`_: The inputs to prompt the user for. Can be a single input or an array of inputs.
- `help` _`string`_: The help icon at the top of the multiPrompt will be enabled with the help url

## Returns

`Promise<Strings>`: A promise that resolves to an array of strings representing the user's input.

## Example

```js
const multiPrompt = acode.require('multiPrompt');
const myPrompt = await multiPrompt(
  'Enter you name & age',
  [
    { type: 'text', id: 'name' },
    { type: 'number', id: 'age' },
  ],
  'https://example.com/help/'
);
```

> now you can get the value of input of prompt like : `myPrompt["name"] and myPrompt["age"]`

## Related

- [box](./box)
- [alert](./alert)
- [prompt](./prompt)
- [loader](./loader)
- [select](./select)
- [confirm](./confirm)
- [color-picker](./color-picker)
