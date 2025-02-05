# acode.require('dialogBox')

You can use this component to create a dialog box.

## Usage

```js
const DialogBox = acode.require('dialogBox');

const myDialogBox = DialogBox(
  'Title',
  '<h1>Dialog content</h1>',
  'hideBUttonText',
  'cancelButtonText'
);
```

## Methods

### `hide()` _`DialogBox`_

This method is used to hide the dialog box.

```js
myDialogBox.hide();
```

### `wait(time: number)` _`DialogBox`_

This method is disable the ok button for the given time.

- Parameters

  - `time` _`number`_: The time in milliseconds for which the ok button should be disabled.

```js
myDialogBox.wait(1000);
```

### `onhide(callback: Function)` _`DialogBox`_

This method is used to set a callback function to be called when the dialog box is hidden.

- `callback` _`()=>void`_: The callback function to be called when the dialog box is hidden.

```js
myDialogBox.onhide(() => {
  console.log('Dialog box is hidden');
});
```

### `onclick(callback: Function)` _`DialogBox`_

This method is used to set a callback function to be called when the content is clicked.

- `callback` _`()=>`_: The callback function to be called when the ok button is clicked.

```js
myDialogBox.onclick((e) => {
  const target = e.target;
  console.log(target, 'is clicked');
});
```

### `then(callback: Function)` _`DialogBox`_

This method is used to set a callback function to be called when the ok button is clicked.

- `callback` _`()=>void`_: The callback function to be called when the ok button is clicked.

```js
myDialogBox.then(() => {
  console.log('Ok button is clicked');
});
```

### `ok(callback: Function)` _`DialogBox`_

This method is used to set a callback function to be called when the ok button is clicked.

- `callback` _`()=>void`_: The callback function to be called when the ok button is clicked.

```js
myDialogBox.ok(() => {
  console.log('Ok button is clicked');
});
```

### `cancel(callback: Function)` _`DialogBox`_

This method is used to set a callback function to be called when the cancel button is clicked.

- `callback` _`()=>void`_: The callback function to be called when the cancel button is clicked.

```js
myDialogBox.cancel(() => {
  console.log('Cancel button is clicked');
});
```

## Related

- [alert](./alert)
- [prompt](./prompt)
- [loader](./loader)
- [select](./select)
- [confirm](./confirm)
- [multi-prompt](./multi-prompt)
- [color-picker](./color-picker)
