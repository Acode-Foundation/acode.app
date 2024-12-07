# acode.require('alert')

![alert](/alert.png)

The `alert` component is used to display message or errors to the user in a modal window, it is similar to javascript `alert()`.

## Parameters

- `titleText` _`string`_: The text to display in the title of the alert modal.
- `message` _`string`_: The message to display in the body of the alert modal.
- `onhide` _`()=>void`_: An optional function to call when the alert modal is closed.

## Example

```js
const alert = acode.require('alert');

const handleOnHide = () => {
  window.toast('Alert modal closed', 4000);
};

alert('Title of Alert', 'The alert body message..', (onhide = handleOnHide()));
```

In this example, when the alert modal is closed, the `handleOnHide` function will be called and the message 'Alert modal closed' will be toasted.

## Related

- [box](./box)
- [prompt](./prompt)
- [loader](./loader)
- [confirm](./confirm)
- [multi-prompt](./multi-prompt)
- [color-picker](./color-picker)
