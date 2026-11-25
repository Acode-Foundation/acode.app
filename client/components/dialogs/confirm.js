import DialogBox from './dialogBox';

/**
 * @param {string} title
 * @param {string} message
 * @param {{okLabel?: string}} [options]
 * @returns {Promise<boolean>}
 */
export default function confirm(title, message, { okLabel } = {}) {
  return new Promise((resolve) => {
    const dialog = (
      <DialogBox
        title={title}
        message={message}
        okLabel={okLabel}
        onhide={() => resolve(false)}
        onok={(hide) => {
          resolve(true);
          hide();
        }}
        oncancel={(hide) => {
          hide();
          resolve(false);
        }}
      />
    );
    document.body.append(dialog);
  });
}
