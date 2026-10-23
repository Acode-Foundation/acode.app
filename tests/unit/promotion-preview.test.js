import Promotions from '../../client/pages/admin/promotions';

it('previews only credential-free HTTP(S) URLs and clears invalid or empty previews', async () => {
  const nodes = [];
  vi.stubGlobal('document', {
    createElement(tag) {
      const attributes = new Map();
      const node = {
        tag,
        style: {},
        listeners: {},
        validity: { valid: true },
        validationMessage: '',
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        },
        setCustomValidity(message) {
          this.validationMessage = message;
          this.validity.valid = !message;
        },
        reportValidity: vi.fn(),
        append() {},
        replaceChildren() {},
        setAttribute: (key, value) => attributes.set(key, value),
        removeAttribute: (key) => attributes.delete(key),
        getAttribute: (key) => attributes.get(key),
      };
      nodes.push(node);
      return node;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  try {
    Promotions();
    await vi.waitFor(() => expect(nodes.find((node) => node.textContent === 'Add promotion').disabled).toBe(false));
    nodes.find((node) => node.textContent === 'Add promotion').onclick();
    const preview = nodes.find((node) => node.tag === 'img');
    const icon = nodes.find((node) => node.tag === 'input' && node.name === 'icon');
    expect(preview.getAttribute('src')).toBeUndefined();
    for (const invalid of [
      '',
      'invalid',
      '/relative.png',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      'https://user:pass@example.com/a.png',
    ]) {
      icon.value = 'https://example.com/a.png?size=40&theme=dark';
      icon.onchange();
      expect(preview.getAttribute('src')).toBe(icon.value);
      expect(preview.style.visibility).toBe('visible');
      expect(icon.validationMessage).toBe('');
      icon.value = invalid;
      icon.reportValidity.mockClear();
      icon.onchange();
      expect(preview.getAttribute('src')).toBeUndefined();
      expect(preview.style.visibility).toBe('hidden');
      if (invalid) {
        expect(icon.validationMessage).toContain('HTTP or HTTPS');
        expect(icon.reportValidity).toHaveBeenCalledOnce();
      }
      icon.value = 'https://example.com/corrected.png';
      icon.listeners.input();
      expect(icon.validationMessage).toBe('');
      expect(preview.getAttribute('src')).toBeUndefined();
    }
    icon.value = 'http://example.com/a.png';
    icon.onchange();
    expect(preview.getAttribute('src')).toBe(icon.value);
    preview.onerror();
    expect(preview.style.visibility).toBe('hidden');
  } finally {
    vi.unstubAllGlobals();
  }
});
