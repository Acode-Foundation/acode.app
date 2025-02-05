# acode.require('contextmenu')

The Context Menu API provides an interface for creating custom context menus in your web application.

## Definitions

### ContextMenuObj

The `ContextMenuObj` is an object that extends the HTMLElement and includes two methods for managing the context menu: `hide` and `show`.

- `hide` _`()=>void`_: A function that hides the context menu.
- `show` _`()=>void`_: A function that displays the context menu.

## Functions

### `contextmenu(content, [options])`

The main function of the Context Menu API. It creates and returns a `ContextMenuObj`.

- `content` _`string`_: A string object specifying the content or options for the context menu.
- `options` _`object`_: An optional `contextMenuOptions` object specifying additional options for the context menu.

### `contextmenu([options])`

The main function of the Context Menu API. It creates and returns a `ContextMenuObj`.

- `options`: An optional `contextMenuOptions` object specifying additional options for the context menu.

### contextMenuOptions

The `contextMenuOptions` object is used to customize the behavior and appearance of the context menu.

- `left` _`number`_: A number specifying the left position of the context menu.
- `top` _`number`_: A number specifying the top position of the context menu.
- `bottom` _`number`_: A number specifying the bottom position of the context menu.
- `right` _`number`_: A number specifying the right position of the context menu.
- `transformOrigin` _`string`_: A string specifying the origin of the transform.
- `toggle` _`HTMLElement`_: An HTMLElement that acts as a switch for the context menu.
- `onshow` _`()=>void`_: A function that is executed when the context menu is displayed.
- `onhide` _`()=>void`_: A function that is executed when the context menu is hidden.
- `innerHTML` _`()=>string`_: A function that returns a string of HTML to be inserted inside the context menu.

## Usage

```js
import contextmenu from 'contextmenu.js';

// Create a context menu with some content and options
const menu = contextmenu('This is some content', {
  top: 50,
  left: 100,
  onshow: () => console.log('Show'),
  onhide: () => console.log('Hide'),
});

// Show the context menu
menu.show();

// Hide the context menu
menu.hide();
```

This document provides a concise and clear description of the API, its functions, and how to use them. Please adjust the details as needed to fit the actual behavior of your implementation.
