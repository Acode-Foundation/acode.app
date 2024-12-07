# acode.require('projects')

This module allows you to manipulate project template for eg: `HTML Template`

## Methods

- `list()` _`Array<object>`_: It returns an array of objects containing the `name` and `icon` of each project in the `projects` object.
- `get(name: string)` _`object`_: It takes a `project name` as an argument and returns the `files` and `icon` of that project.
- `set(object)` _`void`_: It adds new project template. It takes a `project name`, `files`, and `iconSrc` as arguments and sets the given project's files and icon.

## Example

```js
const projects = acode.require('projects');

// Get a list of all projects and their icons
console.log(projects.list());
// Output: [{ name: 'html', icon: 'html-project-icon' }]

// Get the files and icon of the 'html' project
console.log(projects.get('html'));
// Output: {
//   files: {
//     'index.html': '...',
//     'css/index.css': '',
//     'js/index.js': '',
//   },
//   icon: 'html-project-icon',
// }

// Set the files and icon of the 'html' project to new values
const projectFileObj = {
  filename: 'content for file',
};
projects.set('project name', projectFileObj, iconsrc);
```
