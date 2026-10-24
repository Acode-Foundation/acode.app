import './promotions.scss';

export default function Promotions() {
  const root = document.createElement('section');
  root.className = 'promotion-manager';
  let active = [];
  let archived = [];
  let ready = false;
  let busy = false;
  const saved = new WeakMap();
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const activeList = document.createElement('div');
  const archiveList = document.createElement('div');
  const add = button('Add promotion', () => {
    active.push({});
    render();
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
    saved.set(promotion, { fields: snapshot(promotion), archived: Boolean(promotion.archived) });
  }
  function isDirty(promotion) {
    return saved.get(promotion)?.fields !== snapshot(promotion);
  }
  function wasActive(promotion) {
    return saved.get(promotion)?.archived === false;
  }
  function slotCount() {
    return active.length + archived.filter(wasActive).length;
  }
  function render() {
    const drafts = active.filter((row) => !row.id).length;
    count.textContent = `${slotCount()} / 3 slots${drafts ? ` · ${drafts} unsaved` : ''}`;
    add.disabled = !ready || busy || slotCount() >= 3;
    retry.disabled = busy || [...active, ...archived].some(isDirty);
    activeList.replaceChildren(...active.map((promotion) => card(promotion, false)));
    archiveList.replaceChildren(...archived.map((promotion) => card(promotion, true)));
    if (ready && !active.length) activeList.textContent = 'No active promotions. Add one to get started.';
    if (ready && !archived.length) archiveList.textContent = 'No archived promotions.';
  }
  function card(promotion, isArchived) {
    const article = document.createElement('article');
    article.className = 'promotion-card';
    const save = button('Save', () => persist(promotion, article));
    save.className = 'promotion-primary promotion-save';
    save.hidden = !isDirty(promotion);
    save.disabled = busy;
    const cardActions = document.createElement('div');
    cardActions.className = 'promotion-card-actions';
    cardActions.hidden = save.hidden;
    cardActions.append(save);
    const fields = document.createElement('div');
    fields.className = 'promotion-fields';
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
    else if (isArchived && wasActive(promotion)) state.textContent = 'Archive pending';
    else if (!isArchived && !wasActive(promotion)) state.textContent = 'Restore pending';
    identity.append(name, state);
    cardHeader.append(preview, identity);
    for (const [key, title] of [
      ['label', 'Title'],
      ['url', 'Destination URL'],
      ['icon', 'Icon URL'],
      ['link_text', 'Description'],
    ]) {
      const label = document.createElement('label');
      label.textContent = title;
      const input = document.createElement('input');
      input.name = key;
      input.type = key === 'url' || key === 'icon' ? 'url' : 'text';
      input.value = promotion[key] || '';
      input.required = true;
      input.maxLength = input.type === 'url' ? 2048 : 300;
      input.disabled = isArchived || busy;
      input.oninput = () => {
        promotion[key] = input.value;
        if (key === 'label') name.textContent = input.value || 'New promotion';
        save.hidden = cardActions.hidden = !isDirty(promotion);
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
      label.append(input);
      fields.append(label);
    }
    const removeLabel = promotion.id ? 'Archive' : 'Remove draft';
    const action = button(isArchived ? 'Restore' : removeLabel, () => {
      if (isArchived) {
        active.push(promotion);
        archived = archived.filter((row) => row !== promotion);
      } else {
        active = active.filter((row) => row !== promotion);
        if (promotion.id) archived.push(promotion);
      }
      promotion.archived = Number(!isArchived);
      render();
      if (promotion.id && !isArchived) history.open = true;
      message.textContent = promotion.id && isDirty(promotion) ? 'Select Save on this card to apply the status change.' : '';
    });
    action.disabled = busy || (isArchived && !wasActive(promotion) && slotCount() >= 3);
    action.className = 'promotion-archive';
    cardHeader.append(action);
    article.append(cardHeader, fields, cardActions, stats(promotion.analytics, Boolean(promotion.id)));
    return article;
  }
  function stats(data, saved) {
    const section = document.createElement('section');
    section.className = 'promotion-analytics';
    const heading = document.createElement('h4');
    heading.textContent = 'Click analytics';
    section.append(heading);
    if (!saved) {
      const note = document.createElement('p');
      note.className = 'promotion-empty';
      note.textContent = 'Save this promotion to start tracking clicks.';
      section.append(note);
      return section;
    }
    const metrics = document.createElement('div');
    metrics.className = 'promotion-metrics';
    for (const [label, value] of [
      ['Lifetime clicks', data?.total || 0],
      ['Last 30 days · UTC', data?.recent || 0],
    ]) {
      const metric = document.createElement('div');
      const count = document.createElement('strong');
      count.textContent = value.toLocaleString();
      const caption = document.createElement('span');
      caption.textContent = label;
      metric.append(count, caption);
      metrics.append(metric);
    }
    section.append(metrics);
    if (!data?.recent) {
      const note = document.createElement('p');
      note.className = 'promotion-empty';
      note.textContent = 'No clicks in the last 30 days. Device, OS and origin breakdowns will appear here once someone follows this promotion.';
      section.append(note);
      return section;
    }
    const trend = document.createElement('div');
    trend.className = 'promotion-trend';
    trend.setAttribute('aria-label', 'Daily clicks over the last 30 days, UTC');
    const max = Math.max(1, ...(data?.daily || []).map((row) => row.count));
    for (const row of data?.daily || []) {
      const bar = document.createElement('span');
      bar.style.height = `${Math.max(0, (row.count / max) * 100)}%`;
      bar.title = `${row.day}: ${row.count} clicks`;
      bar.setAttribute('aria-label', bar.title);
      trend.append(bar);
    }
    section.append(trend);
    const dates = document.createElement('div');
    dates.className = 'promotion-chart-dates';
    for (const day of [data.daily?.[0]?.day, data.daily?.at(-1)?.day]) {
      const label = document.createElement('span');
      label.textContent = day || '';
      dates.append(label);
    }
    section.append(dates);
    const groups = document.createElement('div');
    groups.className = 'promotion-breakdowns';
    for (const [key, title] of [
      ['devices', 'Device'],
      ['operatingSystems', 'OS'],
      ['origins', 'Origin'],
    ]) {
      const group = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = `${title} · last 30 days`;
      group.append(heading);
      for (const row of data?.[key] || []) {
        const line = document.createElement('div');
        line.textContent = `${row.name}: ${row.count.toLocaleString()}`;
        group.append(line);
      }
      if (!data?.[key]?.length) group.append(document.createTextNode(' No clicks yet'));
      groups.append(group);
    }
    section.append(groups);
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
  async function persist(promotion, article) {
    for (const input of article.querySelectorAll('input')) if (!input.reportValidity()) return;
    busy = true;
    render();
    try {
      const response = await fetch('/api/admin/promotions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotion }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save promotion');
      Object.assign(promotion, data.promotion);
      remember(promotion);
      message.textContent = 'Saved';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  }
}
