import DialogBox from './dialogBox';

/**
 * Alert dialog
 * @param {string} title 
 * @param {string} message 
 * @param {()=>void} [onok] 
 * @param {boolean} [keep] 
 */
export default function alert(title, message, onok, keep) {
  const dialog = <DialogBox
    onhide={onok}
    title={title}
    message={message}
    onok={(hide) => hide()}
    keep={keep}
  />;

  document.body.append(dialog);
}
