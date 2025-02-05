# acode.require('editorFile')

The EditorFile component of Acode is used to manage and manipulate files within the editor.
It has several properties and events that can be used to interact with the file.

## Constructor

- `EditorFile(name:string, options:FileOptions)`: Creates a new instance of the EditorFile component.

## FileOptions

- `isUnsaved` _`boolean`_: A boolean property that indicates the file is not saved.
- `render` _`boolean`_: A function that makes the file active.
- `id` _`string`_: A string property that represents the ID of the file.
- `uri` _`string`_: A string property that represents the URI of the file.
- `text` _`string`_: A string property that represents the session text.
- `editable` _`boolean`_: A boolean property that indicates if the file can be edited or not.
- `deletedFile` _`boolean`_: A boolean property that indicates if the file no longer exists at the source.
- `SAFMode` _`single|tree`_: A string property that represents the storage access framework mode. Can be either `'single'` or `'tree'`.
- `encoding` _`string`_: A string property that represents the text encoding.
- `cursorPos` _`{row:number, column:number}`_: An object property that represents the cursor position.
- `scrollLeft` _`number`_: A number property that represents the scroll left position.
- `scrollTop` _`number`_: A number property that represents the scroll top position.
- `folds`: [_`Array<Folds>`_](https://ajaxorg.github.io/ace-api-docs/classes/Ace.Fold.html): An array of Fold objects that represent the folds in the file.

## FileEvents

- `blur`: Triggered when the file loses focus.
- `canrun`: Triggered when the file is checked if it can be run.
- `change`: Triggered when the file is changed.
- `close`: Triggered when the file is closed.
- `changeMode`: Triggered when the file's mode is changed.
- `changeEncoding`: Triggered when the file's encoding is changed.
- `changeReadOnly`: Triggered when the file's read-only status is changed.
- `run`: Triggered when the file is run.
- `save`: Triggered when the file is saved.
- `focus`: Triggered when the file is focused.
- `rename`: Triggered when the file is renamed.
- `run`: Triggered when the file is run.
- `load`: Triggered when the file is loaded.
- `loadError`: Triggered when an error occurs while loading the file.
- `loadStart`: Triggered when the loading of the file starts.
- `loadEnd`: Triggered when the loading of the file ends.

## Properties

- `id` _`string`_: A string property that represents the ID of the file.
- `filename` _`string`_: A string property that represents the filename of the file.
- `location` _`string`_: A string property that represents the location of the file.
- `uri` _`string`_: A string property that represents the URI of the file.
- `eol` _`string`_: A string property that represents the end of line character of the file.
- `editable` _`boolean`_: A boolean property that indicates if the file can be edited or not.
- `isUnsaved` _`boolean`_: A boolean property that indicates the file is not saved.
- `name` _`string`_ (**readonly**): A string property that represents the name of the file.
- `cacheFile` _`string`_ (**readonly**): A string property that represents the cache file of the file.
- `icon` _`string`_ (**readonly**): A string property that represents the icon classname of the file.
- `tab` _`HTMLElement`_ (**readonly**): An HTMLElement property that represents the tab of the file.
- `focusedBefore` _`boolean`_ (**readonly**): A boolean property that indicates if the file was focused before.
- `focused` _`boolean`_ (**readonly**): A boolean property that indicates if the file is focused.
- `loaded` _`boolean`_ (**readonly**): A boolean property that indicates if the file is loaded.
- `loading` _`boolean`_ (**readonly**): A boolean property that indicates if the file is loading.
- `deletedFile` _`boolean`_ (**readonly**): A boolean property that indicates if the file no longer exists at the source.
- `session`: [_`Ace.EditSession`_](https://ajaxorg.github.io/ace-api-docs/classes/Ace.EditSession.html) (**readonly**): An EditorSession property that represents the session of the file.
- `encoding` _`string`_: A string property that represents the text encoding.
- `readOnly` _`boolean`_: A boolean property that indicates if the file is read-only or not.
- `markChanged` _`boolean`_: A boolean property that indicates if the file is marked as changed.
- `onsave` _`(e:Event)=>void`_: A function property that is called when the file is saved.
- `onchange` _`(e:Event)=>void`_: A function property that is called when the file is changed.
- `onfocus` _`(e:Event)=>void`_: A function property that is called when the file is focused.
- `onblur` _`(e:Event)=>void`_: A function property that is called when the file loses focus.
- `onclose` _`(e:Event)=>void`_: A function property that is called when the file is closed.
- `onrename` _`(e:Event)=>void`_: A function property that is called when the file is renamed.
- `onload` _`(e:Event)=>void`_: A function property that is called when the file is loaded.
- `onloaderror` _`(e:Event)=>void`_: A function property that is called when an error occurs while loading the file.
- `onloadstart` _`(e:Event)=>void`_: A function property that is called when the loading of the file starts.
- `onloadend` _`(e:Event)=>void`_: A function property that is called when the loading of the file ends.
- `onchangemode` _`(e:Event)=>void`_: A function property that is called when the file's mode is changed.
- `onrun` _`(e:Event)=>void`_: A function property that is called when the file is run.
- `oncanrun` _`(e:Event)=>void`_: A function property that is called when the file is checked if it can be run.

## Methods

- `async writeToCache()` _`void`_: Writes the file to the cache.
- `async isChanged()` _`boolean`_: Checks if the file is changed.
- `async canRun()` _`boolean`_: Checks if the file can be run.
- `async readCanRun()` _`boolean`_: Reads the can run status of the file.
- `async writeCanRun(()=>boolean|Promise<boolean>)` _`void`_: Writes the can run status of the file.
- `async remove(force:boolean)` _`void`_: Removes the file.
- `save()` _`void`_: Saves the file.
- `saveAs()` _`void`_: Saves the file as.
- `setMode(mode:string)` _`void`_: Sets the mode of the file.
- `makeActive()` _`void`_: Makes the file active.
- `removeActive()` _`void`_: Removes the active status of the file.
- `openWith()` _`void`_: Opens the file with other app.
- `editWith()` _`void`_: Edits the file with other app.
- `share()` _`void`_: Shares the file.
- `runAction()` _`void`_: Activate intent with run action.
- `run()` _`void`_: Runs the file.
- `render()` _`void`_: Renders the file.
- `on(event:string, callback: (e:Event)=>void)` _`void`_: Adds an event listener to the file.
- `off(event:string, callback: (e:Event)=>void)` _`void`_: Removes an event listener from the file.

## Example

```js
const testFile = new EditorFile('Test.dart');

testFile.on('canrun', (e) => {
  e.preventDefault();
  testFile.writeCanRun(() => true);
});

testFile.on('run', (e) => {
  e.preventDefault();
  testFile.writeRun(() => {
    console.log('Running Test.dart');
  });
});
```
