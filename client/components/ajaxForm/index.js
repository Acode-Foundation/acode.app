import './style.scss';

/**
 *
 * @param {Object} props
 * @param {string} props.method
 * @param {string} props.action
 * @param {string} [props.className]
 * @param {(any)=>void} props.onloadend
 * @param {(any)=>void} props.onerror
 * @param {(formData: FormData, form: HTMLFormElement)=>boolean|void|Promise<boolean|void>} props.onbeforesubmit
 * @param {()=>void} props.loading
 * @param {()=>void} props.loadingEnd
 * @param {string} props.contentType
 * @param {boolean} props.autofill
 * @returns
 */
export default function AjaxForm(
  { ref, className, onloadend, onerror, onbeforesubmit, loading, loadingEnd, autofill = true, method, action, encoding, contentType },
  children,
) {
  const actionUrl = typeof action === 'function' ? '#' : action;
  const form = (
    <form ref={ref} action={actionUrl} method={method} encoding={encoding} autocomplete={autofill ? 'on' : 'off'} className={className}>
      {children}
    </form>
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    try {
      const shouldSubmit = await onbeforesubmit?.(formData, form);
      if (shouldSubmit === false) return;
    } catch (error) {
      onerror?.(error);
      return;
    }

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
