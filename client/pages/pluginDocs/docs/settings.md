# acode.require('settings')

The `Settings` module allows you to get and set app settings.

## Usage

```js
const settings = acode.require('settings');

settings.update({
  fontSize: 16,
});
```

## Methods

- `update(settings: object, showToast: boolean)` - Updates the settings. This method takes two parameters, `settings` and `showToast`. The `settings` is an object containing the settings to update. The `showToast` is a boolean indicating whether to show a toast when the settings are updated.
- `reset(setting?: string)` - Resets the setting to its default value. This method takes one parameter, `setting`. The `setting` is the name of the setting to reset. If `setting` is not provided, all settings will be reset.
- `on('{reset|update}:<setting>': string, cb: Function)` - Adds an event listener to the settings. This method takes two parameters, `event` and `cb`. The `event` is the event name. The `cb` is the callback function that will be called when the event is triggered. The `cb` function takes one parameter, `value`. The `value` is the value of the setting.
- `off('{reset|update}:<setting>': string, cb: Function)` - Removes an event listener from the settings. This method takes two parameters, `event` and `cb`. The `event` is the event name. The `cb` is the callback function that will be called when the event is triggered. The `cb` function takes one parameter, `value`. The `value` is the value of the setting.
- `get(setting: string)` - Gets the value of the setting. This method takes one parameter, `setting`. The `setting` is the name of the setting to get.
