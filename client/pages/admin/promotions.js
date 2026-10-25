import './promotions.scss';
import confirm from '../../components/dialogs/confirm';
import Input from '../../components/input';

const sourceLabels = new Map([
  ['https://localhost', 'Android app'],
  ['https://acode.app', 'Website'],
  ['acode://localhost', 'iOS app'],
  ['unknown', 'Unknown'],
]);

export default function Promotions() {
  const root = document.createElement('section');
  root.className = 'promotion-manager';
  let active = [];
  let archived = [];
  let ready = false;
  let busy = false;
  const saved = new WeakMap();
  const editing = new WeakSet();
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const activeList = document.createElement('div');
  const archiveList = document.createElement('div');
  const add = button('Add promotion', () => {
    active.push({});
    render();
    activeList.lastElementChild?.querySelector('input')?.focus();
  });
  const retry = button('Reload', load);
  const count = document.createElement('span');
  const actions = document.createElement('div');
  actions.className = 'promotion-toolbar';
  actions.append(count, retry, add);
  const history = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Archived promotions';
  history.append(summary, archiveList);
  root.append(actions, message, activeList, history);
  load();
  return root;

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.onclick = action;
    return element;
  }
  function snapshot(promotion) {
    return JSON.stringify(['label', 'url', 'icon', 'link_text', 'archived'].map((key) => promotion[key] || ''));
  }
  function remember(promotion) {
    saved.set(promotion, { fields: snapshot(promotion), values: { ...promotion } });
  }
  function isDirty(promotion) {
    return saved.get(promotion)?.fields !== snapshot(promotion);
  }
  function slotCount() {
    return active.length;
  }
  function render() {
    const drafts = active.filter((row) => !row.id).length;
    count.textContent = `${slotCount()} / 3 slots${drafts ? ` · ${drafts} unsaved` : ''}`;
    add.disabled = !ready || busy || slotCount() >= 3;
    retry.disabled = busy || [...active, ...archived].some(isDirty);
    activeList.replaceChildren(...active.map((promotion) => card(promotion, false)));
    archiveList.replaceChildren(...archived.map((promotion) => card(promotion, true)));
    if (ready && !active.length) activeList.textContent = 'No active promotions.';
    if (ready && !archived.length) archiveList.textContent = 'No archived promotions.';
  }
  function card(promotion, isArchived) {
    const isEditing = !promotion.id || editing.has(promotion);
    const article = document.createElement('article');
    article.className = 'promotion-card';
    const save = button('Save changes', () => persist(promotion, article));
    save.className = 'promotion-primary promotion-save';
    save.disabled = busy || !isDirty(promotion);
    const cardActions = document.createElement('div');
    cardActions.className = 'promotion-card-actions';
    cardActions.hidden = !isEditing;
    const cancel = button('Cancel', () => {
      if (promotion.id) Object.assign(promotion, saved.get(promotion).values);
      else active = active.filter((row) => row !== promotion);
      editing.delete(promotion);
      message.textContent = '';
      render();
      if (promotion.id) articleFor(promotion)?.querySelector('.promotion-edit')?.focus();
      else add.focus();
    });
    cancel.disabled = busy;
    cardActions.append(cancel, save);
    const fields = document.createElement('div');
    fields.className = 'promotion-fields';
    fields.hidden = !isEditing;
    article.dataset.promotionId = promotion.id || '';
    const preview = document.createElement('img');
    preview.alt = 'Promotion icon';
    preview.width = 40;
    preview.height = 40;
    preview.referrerPolicy = 'no-referrer';
    function iconUrl(value) {
      try {
        const url = new URL(value);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
      } catch {
        /* Incomplete URLs should not start image requests. */
      }
      return '';
    }
    function updatePreview(value) {
      const url = iconUrl(value);
      if (url) preview.setAttribute('src', url);
      else preview.removeAttribute('src');
      preview.style.visibility = url ? 'visible' : 'hidden';
    }
    updatePreview(promotion.icon);
    preview.onerror = () => {
      preview.style.visibility = 'hidden';
    };
    const cardHeader = document.createElement('div');
    cardHeader.className = 'promotion-card-header';
    const identity = document.createElement('div');
    identity.className = 'promotion-identity';
    const name = document.createElement('h3');
    name.textContent = promotion.label || 'New promotion';
    const state = document.createElement('span');
    state.className = 'promotion-state';
    state.textContent = isArchived ? 'Archived' : 'Active';
    if (!promotion.id) state.textContent = 'Unsaved draft';
    const titleRow = document.createElement('div');
    titleRow.className = 'promotion-title-row';
    titleRow.append(name, state);
    identity.append(titleRow);
    cardHeader.append(preview, identity);
    for (const [key, title] of [
      ['label', 'Title'],
      ['url', 'Destination URL'],
      ['icon', 'Icon URL'],
      ['link_text', 'Description'],
    ]) {
      const inputRef = {};
      const type = key === 'url' || key === 'icon' ? 'url' : 'text';
      const field = Input({
        inputRef,
        name: key,
        label: title,
        placeholder: title,
        type,
        value: promotion[key] || '',
        required: true,
        maxlength: type === 'url' ? 2048 : 300,
      });
      const input = inputRef.el;
      input.disabled = isArchived || busy;
      input.oninput = () => {
        promotion[key] = input.value;
        if (key === 'label') name.textContent = input.value || 'New promotion';
        save.disabled = busy || !isDirty(promotion);
        retry.disabled = [...active, ...archived].some(isDirty);
      };
      if (key === 'icon') {
        const validate = () =>
          input.setCustomValidity(
            input.value && !iconUrl(input.value) ? 'Enter a complete HTTP or HTTPS image URL without a username or password.' : '',
          );
        input.addEventListener('input', validate);
        input.onchange = () => {
          validate();
          updatePreview(input.value);
          if (input.value && !input.validity.valid) input.reportValidity();
        };
        validate();
      }
      fields.append(field);
    }
    const controls = document.createElement('div');
    controls.className = 'promotion-controls';
    if (promotion.id && !isArchived) {
      const edit = iconButton(`Edit ${promotion.label}`, 'edit', () => {
        editing.add(promotion);
        render();
        articleFor(promotion)?.querySelector('input')?.focus();
      });
      edit.className += ' promotion-edit';
      edit.disabled = busy;
      edit.hidden = isEditing;
      controls.append(edit);
    }
    if (promotion.id) {
      const changeStatus = async () => {
        if (!isArchived && !(await confirm(`Archive “${promotion.label}”?`, 'You can restore it later. Click history will be kept.'))) return;
        if (busy) return;
        await persist(promotion, null, { ...saved.get(promotion).values, archived: Number(!isArchived) });
      };
      const action = isArchived ? button('Restore', changeStatus) : iconButton(`Archive ${promotion.label}`, 'archive', changeStatus);
      action.disabled = busy || isEditing || (isArchived && slotCount() >= 3);
      if (isArchived && slotCount() >= 3) action.title = 'Archive an active promotion to free a slot first.';
      controls.append(action);
    }
    cardHeader.append(controls);
    const description = document.createElement('p');
    description.className = 'promotion-description';
    description.textContent = promotion.link_text || '';
    const destination = document.createElement('a');
    destination.className = 'promotion-destination';
    const url = iconUrl(promotion.url);
    if (url) {
      destination.href = url;
      destination.target = '_blank';
      destination.rel = 'noopener noreferrer';
      destination.textContent = new URL(url).hostname;
      destination.title = url;
    }
    const details = document.createElement('div');
    details.className = 'promotion-details';
    details.hidden = isEditing;
    details.append(description, destination);
    identity.append(details);
    article.append(cardHeader, fields, cardActions);
    if (promotion.id) article.append(stats(promotion.analytics, promotion.id));
    return article;
  }
  function articleFor(promotion) {
    if (!promotion.id) return activeList.children[active.indexOf(promotion)];
    return [...root.querySelectorAll('.promotion-card')].find((article) => article.dataset.promotionId === String(promotion.id));
  }
  function iconButton(label, icon, action) {
    const element = button('', action);
    element.className = 'promotion-icon-button';
    element.title = label;
    element.setAttribute('aria-label', label);
    const paths = {
      edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/>',
      archive: '<path d="M4 8v13h16V8 M3 3h18v5H3Z M9 12h6"/>',
    };
    element.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg>`;
    return element;
  }
  function stats(data, id) {
    const section = document.createElement('section');
    section.className = 'promotion-analytics';
    const heading = document.createElement('h4');
    heading.textContent = 'Clicks · last 30 days';
    const overview = document.createElement('div');
    overview.className = 'promotion-overview';
    overview.append(heading);
    const metrics = document.createElement('div');
    metrics.className = 'promotion-metrics';
    const recent = data?.recent || 0;
    const total = data?.total || 0;
    const count = document.createElement('strong');
    count.textContent = recent.toLocaleString();
    metrics.append(count);
    if (total !== recent) {
      const lifetime = document.createElement('span');
      lifetime.textContent = `${total.toLocaleString()} all time`;
      metrics.append(lifetime);
    }
    overview.append(metrics);
    section.append(overview);
    if (!data?.recent) {
      const note = document.createElement('p');
      note.className = 'promotion-empty';
      note.textContent = 'No clicks in the last 30 days.';
      section.append(note);
      return section;
    }
    const trend = document.createElement('div');
    trend.className = 'promotion-trend';
    trend.setAttribute('aria-label', 'Daily clicks over the last 30 days, UTC');
    const max = Math.max(1, ...(data?.daily || []).map((row) => row.count));
    for (const row of data?.daily || []) {
      const bar = document.createElement('span');
      bar.className = 'promotion-bar';
      bar.style.height = `${Math.max(0, (row.count / max) * 100)}%`;
      bar.title = `${row.day}: ${row.count} clicks`;
      bar.setAttribute('aria-label', bar.title);
      if (row.count) {
        const value = document.createElement('span');
        value.className = 'promotion-bar-value';
        value.textContent = row.count.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
        value.setAttribute('aria-hidden', 'true');
        bar.append(value);
      }
      trend.append(bar);
    }
    const chartCaption = document.createElement('p');
    chartCaption.className = 'promotion-chart-caption';
    chartCaption.textContent = 'Daily clicks · UTC';
    const plot = document.createElement('div');
    plot.className = 'promotion-plot';
    const scale = document.createElement('div');
    scale.className = 'promotion-chart-scale';
    scale.setAttribute('aria-hidden', 'true');
    for (const value of [max, 0]) {
      const tick = document.createElement('span');
      tick.textContent = value.toLocaleString();
      scale.append(tick);
    }
    plot.append(scale, trend);
    const chart = document.createElement('div');
    chart.className = 'promotion-chart';
    chart.id = `promotion-chart-${id}`;
    chart.append(chartCaption, plot);
    const dates = document.createElement('div');
    dates.className = 'promotion-chart-dates';
    for (const day of [data.daily?.[0]?.day, data.daily?.at(-1)?.day]) {
      const label = document.createElement('span');
      label.textContent = day || '';
      dates.append(label);
    }
    chart.append(dates);
    section.append(chart);
    const groups = document.createElement('div');
    groups.className = 'promotion-breakdowns';
    const detailIds = [chart.id];
    for (const [key, title] of [
      ['origins', 'Opened from'],
      ['devices', 'Device type'],
      ['operatingSystems', 'Operating system'],
    ]) {
      const group = document.createElement('div');
      if (key !== 'origins') {
        group.className = 'promotion-breakdown-detail';
        group.id = `promotion-${key}-${id}`;
        detailIds.push(group.id);
      }
      const heading = document.createElement('strong');
      heading.textContent = title;
      group.append(heading);
      for (const row of data?.[key] || []) {
        const line = document.createElement('div');
        const label = document.createElement('span');
        label.textContent = key === 'origins' ? sourceLabels.get(row.name) || row.name : row.name;
        const value = document.createElement('span');
        value.textContent = row.count.toLocaleString();
        line.className = 'promotion-breakdown-row';
        if (key === 'origins') line.title = row.name;
        line.append(label, value);
        group.append(line);
      }
      if (!data?.[key]?.length) group.append(document.createTextNode(' No clicks yet'));
      groups.append(group);
    }
    section.append(groups);
    const toggle = button('More analytics', () => {
      const expanded = section.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Less analytics' : 'More analytics';
    });
    toggle.className = 'promotion-analytics-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', detailIds.join(' '));
    section.append(toggle);
    return section;
  }
  async function load() {
    busy = true;
    message.textContent = 'Loading promotions…';
    render();
    try {
      const responses = await Promise.all([fetch('/api/admin/promotions'), fetch('/api/admin/promotions?status=archived')]);
      if (responses.some((response) => !response.ok)) throw new Error('Failed to load promotions. Select Reload to retry.');
      const lists = await Promise.all(responses.map((response) => response.json()));
      if (!lists.every(Array.isArray)) throw new Error('Invalid promotion response');
      [active, archived] = lists;
      ready = true;
      for (const promotion of [...active, ...archived]) remember(promotion);
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  }
  async function persist(promotion, article, payload = promotion) {
    for (const input of article?.querySelectorAll('input') || []) if (!input.reportValidity()) return;
    busy = true;
    render();
    try {
      const response = await fetch('/api/admin/promotions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotion: payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to save promotion');
      const updated = data?.promotion;
      if (
        !updated?.id ||
        typeof updated.id !== 'string' ||
        (promotion.id && updated.id !== promotion.id) ||
        !['label', 'url', 'icon', 'link_text'].every((key) => typeof updated[key] === 'string') ||
        ![0, 1].includes(updated.archived)
      )
        throw new Error('Unexpected server response. Reload the page to check whether your changes were saved.');
      Object.assign(promotion, data.promotion);
      if (promotion.archived && active.includes(promotion)) {
        active = active.filter((row) => row !== promotion);
        archived.push(promotion);
      } else if (!promotion.archived && archived.includes(promotion)) {
        archived = archived.filter((row) => row !== promotion);
        active.push(promotion);
      }
      remember(promotion);
      editing.delete(promotion);
      if (promotion.archived) history.open = true;
      message.textContent = 'Promotion saved.';
      if (!article) message.textContent = promotion.archived ? 'Promotion archived.' : 'Promotion restored.';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      render();
      if (root.isConnected) {
        const card = articleFor(promotion);
        if (editing.has(promotion) || !promotion.id) card?.querySelector('input')?.focus();
        else card?.querySelector('.promotion-controls button:not([hidden])')?.focus();
      }
    }
  }
}
