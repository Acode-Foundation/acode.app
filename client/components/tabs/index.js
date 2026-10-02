import './style.scss';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';

/**
 * @typedef {Object} TabDefinition
 * @property {string} id - Unique tab identifier
 * @property {string} label - Display text
 * @property {string} [icon] - Icon class name (e.g. 'shopping_bag')
 * @property {boolean} [visible=true] - Whether this tab is shown
 * @property {function|HTMLElement} [content] - Content element or factory returning element (sync or async)
 */

/**
 * Reusable tab component with two visual variants.
 *
 * @param {Object} props
 * @param {'pill'|'underline'} [props.variant='pill'] - Visual style
 * @param {string} [props.defaultActive] - Initially active tab ID (defaults to first visible)
 * @param {TabDefinition[]} props.tabs - Tab definitions
 * @param {function(string):void} [props.onChange] - Called with tab id on switch
 * @param {string} [props.className] - Additional CSS class on wrapper
 * @returns {Promise<HTMLElement>}
 */
export default async function Tabs({ variant = 'pill', defaultActive, tabs, onChange, className }) {
  const visibleTabs = tabs.filter((t) => t.visible !== false);
  if (!visibleTabs.length) return <div />;

  const initialTab = defaultActive && visibleTabs.find((t) => t.id === defaultActive) ? defaultActive : visibleTabs[0].id;

  const activeTab = Reactive(initialTab);
  const contentRef = Ref();
  const loadedContent = {};
  const wasActivated = { [initialTab]: true };

  const wrapper = (
    <div className={`tabs tabs--${variant}${className ? ` ${className}` : ''}`}>
      <div
        className='tabs-nav'
        role='tablist'
        on:click={(e) => {
          const btn = e.target.closest('.tab-btn');
          if (!btn) return;
          switchTab(btn.dataset.tab);
        }}
      >
        {variant === 'pill' && <span className='tabs-indicator' />}
        {visibleTabs.map((tab) => (
          <button
            type='button'
            role='tab'
            data-tab={tab.id}
            className={`tab-btn${tab.id === initialTab ? ' active' : ''}`}
            aria-selected={String(tab.id === initialTab)}
          >
            {tab.icon && <span className={`icon ${tab.icon}`} />}
            {tab.label}
          </button>
        ))}
      </div>
      <div ref={contentRef} className='tabs-content' />
    </div>
  );

  setTimeout(() => initContent(), 0);

  if (variant === 'pill') {
    // Button widths change when web fonts load or the viewport resizes.
    const nav = wrapper.querySelector('.tabs-nav');
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => updateIndicator());
      for (const btn of nav.querySelectorAll('.tab-btn')) observer.observe(btn);
    }
    document.fonts?.ready.then(() => updateIndicator());
  }

  return wrapper;

  function updateIndicator() {
    const nav = wrapper.querySelector('.tabs-nav');
    const indicator = nav?.querySelector('.tabs-indicator');
    const activeBtn = nav?.querySelector(`[data-tab="${activeTab.value}"]`);
    if (!indicator || !activeBtn) return;
    // offsetLeft and the indicator's `left: 0` share the nav's padding edge.
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
    indicator.style.width = `${activeBtn.offsetWidth}px`;
  }

  async function switchTab(tabId) {
    if (!tabId) return;
    activeTab.value = tabId;

    const nav = wrapper.querySelector('.tabs-nav');
    if (nav) {
      for (const btn of nav.querySelectorAll('.tab-btn')) {
        const active = btn.dataset.tab === tabId;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      }

      if (variant === 'pill') {
        updateIndicator();
      }
    }

    const contentEl = contentRef.el;
    if (contentEl) {
      contentEl.innerHTML = '';
      const tab = visibleTabs.find((t) => t.id === tabId);
      if (tab && tab.content !== undefined) {
        if (!wasActivated[tabId]) {
          wasActivated[tabId] = true;
          loadedContent[tabId] = typeof tab.content === 'function' ? tab.content() : tab.content;
        }
        const content = await Promise.resolve(loadedContent[tabId]);
        if (content) contentEl.append(content);
      }
    }

    onChange?.(tabId);
  }

  async function initContent() {
    const el = contentRef.el;
    if (!el) return;
    const tab = visibleTabs.find((t) => t.id === initialTab);
    if (!tab || tab.content === undefined) return;
    loadedContent[initialTab] = typeof tab.content === 'function' ? tab.content() : tab.content;
    const content = await Promise.resolve(loadedContent[initialTab]);
    if (content) el.append(content);

    if (variant === 'pill') {
      updateIndicator();
    }
  }
}
