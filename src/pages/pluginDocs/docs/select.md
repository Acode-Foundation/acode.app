# acode.require('select')

`select` is a acode component that allows the user to select one or more options from a dropdown menu. It is similar to the `<select>` element of HTML.

## Preview

![select](/select.png)

## Parameters

- `title` _`string`_: A string that will be displayed as the title of the _select menu_.
- `options` _`object`_: An array of _array_ or _string_ representing the options in the _select menu_. Each array should have a **value**, **text**, **icon** and **disable** property.
- `opt`: An _object_ or _boolean_ that will allow additional functionality to be added to the **select menu**.
  - `onCancel` _`()=>void`_: A function that will be called when the user cancel the **select menu**.
  - `hideOnSelect` _`boolean`_: A boolean that specifies whether the **select menu** will **hide** when an option is selected.
  - `textTransform` _`boolean`_: A boolean that specifies whether the text of the options should be transformed (for example, to uppercase).
  - `default` _`string`_: A string that represents the _default selected option_.

## Example

```js
const select = acode.require('select');
const options = [
  ['option1', 'Option 1', 'icon1', true],
  ['option2', 'Option 2', 'icon2', false],
];
const opt = {
  onCancel: () => window.toast('Cancel Clicked', 3000),
  hideOnSelect: true,
  textTransform: true,
  default: 'option2',
};

const mySelect = await select('My Title', options, opt);
```

In this example, the select menu will have two options: "Option 1" & "Option 2" with their respective values, icons and disable property.
The opt parm will allow the user to cancel the selection and the menu will hide on selection and the text will be transformed to uppercase, and the default option will be option2.

## Related

- [box](./box)
- [alert](./alert)
- [prompt](./prompt)
- [loader](./loader)
- [confirm](./confirm)
- [color-picker](./color-picker)
- [multi-prompt](./multi-prompt)
