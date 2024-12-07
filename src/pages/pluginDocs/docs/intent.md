# acode.require("intent")

Adds and remove intent handler for the app. The intent handler supports URI scheme `acode://<module>/<action>/<value>`. The intent handler is used to open the app from other apps.

**Note:** The intent handler is not supported on older versions of the app so it is recommended to check if the intent handler is supported before adding it.

## Methods

- `addHandler(handler: (event: IntentEvent) => void)`: Adds an intent handler to the app. The handler will be called when the app is opened from other apps.

- `removeHandler(handler: (event: IntentEvent) => void)`: Removes an intent handler from the app.

## Example

```js
const intent = acode.require('intent');

const handler = (event) => {
  // to prevent default behavior
  //event.preventDefault();
  // to prevent other handlers from being called
  //event.stopPropagation();

  const { module, action, value } = event;
  console.log(`Intent: ${module}/${action}/${value}`);
};

// add intent handler
intent?.addHandler(handler);

// remove intent handler
intent?.removeHandler(handler);
```

## IntentEvent

The intent event object contains the following properties:

- `module` _`string`_: The module name.

- `action` _`string`_: The action name.

- `value` _`string`_: The value.

- `preventDefault()`: Prevents the default behavior of the intent.

- `stopPropagation()`: Stops the propagation of the intent.
