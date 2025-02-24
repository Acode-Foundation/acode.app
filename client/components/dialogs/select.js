import DialogBox from './dialogBox';

export default async function select(title, options) {
  return new Promise((resolve) => {
    const onselect = (index, hide) => {
      hide(false);
      resolve(options[index]);
    };
    const dialog = (
      <DialogBox
        onhide={() => {
          resolve(null);
        }}
        title={title}
        options={options}
        onselect={onselect}
      />
    );
    document.body.append(dialog);
  });
}
