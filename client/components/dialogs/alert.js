import DialogBox from './dialogBox';

/** @type {import('./dialogBox').DialogBox} */
let currentDialog;

/**
 * Alert dialog
 * @param {string} title
 * @param {string} message
 * @param {()=>void} [onok]
 * @param {boolean} [keep]
 */
export default function alert(title, message, onok, keep) {
  currentDialog?.hide();
  currentDialog = <DialogBox onhide={onok} title={title} message={message} onok={(hide) => hide()} keep={keep} />;
  document.body.append(currentDialog);
}
