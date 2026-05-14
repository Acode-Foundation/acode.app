import './style.scss';

/**
 *
 * @param {Object} props
 * @param {string} props.method
 * @param {string} props.action
 * @param {(any)=>void} props.onloadend
 * @param {(any)=>void} props.onerror
 * @param {()=>void} props.loading
 * @param {()=>void} props.loadingEnd
 * @param {string} props.contentType
 * @param {boolean} props.autofill
 * @returns
 */
export default function AjaxForm({ ref, onloadend, onerror, loading, loadingEnd, autofill = true, method, action, encoding, contentType }, children) {
  const actionUrl = typeof action === 'function' ? '#' : action;
  const form = (
    <form ref={ref} action={actionUrl} method={method} encoding={encoding} autocomplete={autofill ? 'on' : 'off'}>
      {children}
    </form>
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    let body = formData;
    const jsonData = {};

    if (contentType === 'json') {
      for (const [key, value] of formData.entries()) {
        jsonData[key] = value;
      }
      body = JSON.stringify(jsonData);
    }

    // if method doesn't support body, remove it
    if (['GET', 'HEAD'].includes(method)) {
      body = undefined;
    }

    try {
      loading?.(form);
      const url = typeof action === 'function' ? action(form) : action;
      const response = await fetch(url, {
        method,
        body,
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      onloadend?.(data);
    } catch (error) {
      onerror?.(error);
    } finally {
      loadingEnd?.(form);
    }
  });

  return form;
}
