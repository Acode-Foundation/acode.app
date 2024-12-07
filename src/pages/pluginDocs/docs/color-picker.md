# acode.require('colorPicker')

It allows users to choose colors. It opens a color picker, which displays a variety of color options for the user to choose from.

To use the `colorPicker` component, call the function and pass in the desired default color as a string argument.

## Example

```js
const colorPicker = acode.require('colorPicker');

let selectedColor = await colorPicker('#ff0000'); // opens color picker with default color set to red
```

## Related

- [box](./box)
- [alert](./alert)
- [prompt](./prompt)
- [loader](./loader)
- [select](./select)
- [confirm](./confirm)
- [multi-prompt](./multi-prompt)
