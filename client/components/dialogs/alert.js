import DialogBox from './dialogBox';

/** @type {import('./dialogBox').DialogBox} */
let currentDialog;

/**
 * Alert dialog
 * @param {string} title
 * @param {string} message
 * @param {()=>void} [onok]
 * @param {boolean} [keep]
 * @param {{icon?: string, variant?: 'success'}} [appearance]
 */
export default function alert(title, message, onok, keep, appearance = {}) {
  currentDialog?.hide();
  currentDialog = <DialogBox {...appearance} onhide={onok} title={title} message={message} onok={(hide) => hide()} keep={keep} />;
  document.body.append(currentDialog);
}
