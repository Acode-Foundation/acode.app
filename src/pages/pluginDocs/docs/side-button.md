# `acode.require("sideButton")`

A function that creates and renders side button that is shown in right side of the editor in vertical direction.

> Supported in version code >= 316

## Usage

```js
const SideButton = acode.require('sideButton');

const sideButton = SideButton({
  text: 'My Side Button',
  icon: 'my-icon',
  onclick() {
    console.log('clicked');
  },
  backgroundColor: '#fff',
  textColor: '#000',
});

// to show side button
sideButton.show();

// to hide side button
sideButton.hide();
```

## Parameters

- `options` _`object`_: The options of the side button.
  - `text` _`string`_: The text of the side button.
  - `icon` _`string`_: The class name of the icon of the side button.
  - `onclick` _`()=>void`_: The function to be called when the side button is clicked.
  - `backgroundColor` _`string`_: The background color of the side button.
  - `textColor` _`string`_: The text color of the side button.

## Returns

- `object`: The side button object.
  - `show()` _`()=>void`_: A function that shows the side button.
  - `hide()` _`()=>void`_: A function that hides the side button.
