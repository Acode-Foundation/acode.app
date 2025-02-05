# acode.require('page')

_Acode_ `Page` Component allows you to create a page with a title and optional lead and tail elements that in the page header.

## Parameters

- `title (string)`: The title of the page. This will be displayed at the top of the page.
- `options (object)`: An optional object containing additional options for the page.
  - `lead (HTMLElement)`: An optional lead element that will be displayed at the top of the page header, before the title. Typically used to display a `back icon`.
  - `tail (HTMLElement)`: An optional tail element that will be displayed at the right side of the page header after the title. Typically used to display an additional icon such as `search icon`.

## Methods

- `appendBody(...els: HTMLElement[])`: Appends the given elements to the page body.
- `appendOuter(...els: HTMLElement[])`: Appends the given elements to the page outer.
- `on(event: string, cb: Function)`: Adds an event listener to the page.
- `off(event: string, cb: Function)`: Removes an event listener from the page.
- `settitle(title: string)`: Sets the title of the page.
- `show()`: Shows the page.
- `hide()`: Hides the page.

## Properties

- `body` _`HTMLElement`_: The body element of the page.
- `header` _`HTMLElement`_: The header element of the page.
- `innerHTML` _`string`_: The inner HTML of the page.
- `textContent` _`string`_: The text content of the page.
- `lead` _`HTMLElement`_: The lead element of the page.

## Example

```js
const page = acode.require('page');
page('Title', { options });
```
