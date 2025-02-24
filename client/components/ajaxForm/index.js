import './style.scss';

/**
 *
 * @param {Object} param0
 * @param {string} param0.method
 * @param {string} param0.action
 * @param {(any)=>void} param0.onloadend
 * @param {(any)=>void} param0.onerror
 * @param {()=>void} param0.loading
 * @param {()=>void} param0.loadingEnd
 * @param {string} param0.contentType
 * @returns
 */
export default function AjaxForm({ ref, onloadend, onerror, loading, loadingEnd, method, action, encoding, contentType }, children) {
  const actionUrl = typeof action === 'function' ? '#' : action;
  const form = (
    <form ref={ref} action={actionUrl} method={method} encoding={encoding}>
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
