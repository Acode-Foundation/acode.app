# acode.require('actionStack')

This object manages the action stack, when user press the `back button` it lets the user go back to the previous action.

## Methods

### `push(action: object)`

Example:

```js
actionStack.push({
  id: 'action-id',
  action() {
    // this function will be called when user press the back button
  },
});
```

### `pop(repeat: number)`

Gets the last action and calls the action function. When there is action in the stack, it will prompt the user to close the application.

- `repeat` _`number`_: The number of times to repeat the action.

Example:

```js
actionStack.pop(repeat);
```

### `get(id: string)` _`object`_

Gets the action from the stack.

**Returns:** The action object.

- `id` _`string`_: The id of the action.
- `action` _`()=>void`_: The action function.

Example:

```js
actionStack.get('action-id');
```

### `remove(actionId: string)`

Removes the action from the stack.

Example:

```js
actionStack.remove('action-id');
```

### `has(actionId: string)` _`boolean`_

Checks if the action is in the stack.

Example:

```js
actionStack.has('action-id');
```

### `setMark()`

Sets a mark at the current length of the stack.

### `clearFromMark()`

Clears the stack from the mark.

Example:

```js
actionStack.setMark();
actionStack.push({
  id: 'action-id',
  action() {
    // this function will be called when user press the back button
  },
});
actionStack.clearFromMark();
```
