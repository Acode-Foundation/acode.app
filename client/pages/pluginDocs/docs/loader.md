# acode.require('loader')

The `loader component` is a utility component of `acode` that can be used to display a **loading dialog** with a specified `title` and `message`. It also provides an option to **set a timeout** and `callback function` for when the loading process is cancelled.

## Methods

**The component has some methods that can be used to control the loader:**

- `showTitleLoader()`: Shows the title loader.

- `removeTitleLoader()`: Hides the title loader.

- `create(options: object)`: Creates a new loading dialog with the specified options. The options should contain the following data:

  - `titleText` _`string`_: The title text to display on the loading dialog.
  - `message` _`string`_: The message to display on the loading dialog.
  - `cancel` _`object`_: An object that contains the following properties:
    - `timeout` _`number`_: The time (in milliseconds) after which the loading process will automatically be cancelled.
    - `callback` _`()=>void`_: A function that will be called when the loading process is cancelled.

- `destroy()`: Removes the loading dialog from the DOM permanently.

- `hide()`: Hides the loading dialog temporarily. The dialog can be restored using the `show()` method.

- `show()`: Shows previously hidden loading dialog.

- `setTitle(titleText: string)`: Sets the title text of the loading dialog.

- `setMessage(message: string)`: Sets the message of the loading dialog.

> Note: The `create()` method should be called before calling other methods.

## Example

```js
const loader = acode.require('loader');

// create the loader
loader.create('Title Text', 'Message...', {
  timeout: 5000,
  callback: () => window.toast('Loading cancelled', 4000),
});

// hide the loader
setTimeout(() => {
  loader.hide();
}, 2000);

// show the loader
setTimeout(() => {
  loader.show();
}, 4000);

// destroy the loader
setTimeout(() => {
  loader.destroy();
}, 6000);
```

In this example, the create() method is called with the specified options, the loader is hidden after 2 seconds, shown after 4 seconds, and destroyed after 6 seconds.

## Related

- [box](./box)
- [alert](./alert)
- [prompt](./prompt)
- [select](./select)
- [confirm](./confirm)
- [color-picker](./color-picker)
- [multi-prompt](./multi-prompt)
