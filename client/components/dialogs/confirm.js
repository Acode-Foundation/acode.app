import DialogBox from './dialogBox';

export default function confirm(title, message) {
  return new Promise((resolve) => {
    const dialog = <DialogBox title={title} message={message} onok={(hide) => {
      hide();
      resolve(true);
    }} oncancel={(hide) => {
      hide();
      resolve(false);
    }} />;
    document.body.append(dialog);
  });
}
