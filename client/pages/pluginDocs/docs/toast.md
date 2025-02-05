# acode.require('toast')

![toast](/toast.png)

It allows you to display a message to the user for a specified duration of time. The message is displayed as a "toast", which appears briefly on the screen before disappearing.

## Usage

```js
const toast = acode.require('toast');
```

## Parameters

- `msg` _`string`_: The message to be displayed in the toast.
- `milliSecond` _`number`_: The duration in milliseconds for which the toast should be displayed.

## Example

```js
toast('Hello, World!', 3000);
```

This will display the message "Hello, World!" for 3 seconds (3000 milliseconds).
