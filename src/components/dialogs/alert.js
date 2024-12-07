import DialogBox from './dialogBox';

export default function alert(title, message, onok) {
  const dialog = <DialogBox
    onhide={onok}
    title={title}
    message={message}
    onok={(hide) => hide()}
  />;

  document.body.append(dialog);
}
