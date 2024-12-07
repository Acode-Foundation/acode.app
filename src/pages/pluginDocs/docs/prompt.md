# Prompt Dialog

![prompt](/prompt.png)

The `prompt` component of `Acode` is used to display a prompt to the user, typically for input.

## Parameters

- `message` _`string`_: a string that represents the message to be displayed to the user.
- `defaultValue` _`string`_: a string that represents the default value of the input.
- `type` _`string`_: a string that represents the type of input, such as:
  - textarea
  - text
  - number
  - tel
  - search
  - email
  - url
- `options` _`object`_: an object that contains additional options for the prompt.
  - `match` _`RegExp`_: a regular expression that the input must match.
  - `required` _`boolean`_: a boolean that indicates whether the input is required or not.
  - `placeholder` _`string`_: a string that represents the placeholder text of the input.
  - `test` _`(any)=>boolean`_: a function that takes in a value and returns a boolean indicating whether the value is valid.

## Example

```js
const prompt = acode.require('prompt');

const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
const options = {
  match: emailRegex,
  required: true,
  placeholder: 'Enter your email',
  test: (value) => emailRegex.test(value),
};

const userEmail = await prompt('What is your email?', '', 'email', options);
```

In this example, It will create a prompt with given options and parameter and it will also validate email.

## Related

- [box](./box)
- [alert](./alert)
- [loader](./loader)
- [select](./select)
- [confirm](./confirm)
- [color-picker](./color-picker)
- [multi-prompt](./multi-prompt)
