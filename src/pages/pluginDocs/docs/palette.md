# acode.require('palette')

The `Pallete` component is a customizable input field with a dropdown list of options that is shown when the user interacts with the input field. The component is designed to provide suggestions or options to the user to choose from based on the input they have entered. The component is useful in situations where there is a large list of options to choose from or when the user is not sure about the exact input required. For eg: Its used in command pallete of Acode.

## Usage

To use the `Palette` component, you need to import it into your plugin using the following syntax:

```js
const palette = acode.require('pallete');
```

Once you have imported the `Palette` component, you can create an instance of it by calling the function and passing the required parameters.

```js
palette(getList, onselect, placeholder, onremove);
```

### Parameters

- `getList` _`()=>Array<string|string[]>`_: A function that returns an array of options to be displayed in the dropdown list. This function can also return a Promise that resolves to the list of options.
- `onselect` _`(val:string)=>void`_: A function that is called when an option is selected from the dropdown list. The function receives the value of the selected option as an argument.
- `placeholder?` _`string`_: A string that is displayed as a placeholder text in the input field.
- `onremove?` _`()=>void`_: A function that is called when the `Pallete` component is removed from the DOM.

### Example

```js
// Import the Pallete component
const pallete = acode.require('pallete');

// Define a function to return the list of options
function getList() {
  return [
    { text: 'Option 1', value: 'option1' },
    { text: 'Option 2', value: 'option2' },
    { text: 'Option 3', value: 'option3' },
  ];
}

// Define a function to handle the selected option
function onselect(value) {
  console.log(`Selected value: ${value}`);
}

// Create an instance of the Pallete component
pallete(getList, onselect, 'Search options...');
```

In the above example, we import the `Pallete` component and define a `getList` function to return an array of options. We also define an `onselect` function to handle the selected option. We then create an instance of the `Pallete` component and pass the required parameters.

## Related

- [box](./box)
- [input-hints](./input-hints)
