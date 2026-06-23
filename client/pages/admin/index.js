import './style.scss';
import Chart from 'chart.js/auto';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import DialogBox from 'components/dialogs/dialogBox';
import select from 'components/dialogs/select';
import Input from 'components/input';
import Tabs from 'components/tabs';
import Reactive from 'html-tag-js/reactive';
import Ref from 'html-tag-js/ref';
import { getLoggedInUser } from 'lib/helpers';
import moment from 'moment';

export default async function Admin({ queries = {} }) {
  const usersList = Ref();
  const loggedInUser = await getLoggedInUser();
  if (!loggedInUser?.isAdmin) {
    return <div className='error'>Access denied</div>;
  }

  const activeTab = queries.tab || 'dashboard';

  const onTabChange = (tabId) => {
    const url = new URL(window.location);
    url.searchParams.set('tab', tabId);
    history.replaceState(history.state, '', url);
  };

  return (
    <section ref={usersList} id='admin'>
      <h1>Admin Panel</h1>
      <Tabs
        defaultActive={activeTab}
        onChange={onTabChange}
        tabs={[
          { id: 'dashboard', label: 'Dashboard', content: <Dashboard /> },
          { id: 'settings', label: 'Settings', content: <AppSettings /> },
          { id: 'users', label: 'Users', content: <Users /> },
          { id: 'email', label: 'Email', content: <EmailUsers /> },
          { id: 'payments', label: 'Payments', content: <Payments /> },
          { id: 'promotions', label: 'Promotions', content: <Promotions /> },
          { id: 'sponsors', label: 'Sponsors', content: <Sponsors /> },
          { id: 'plugins', label: 'Plugins', content: <Plugins /> },
          { id: 'modes', label: 'Modes', content: <Modes /> },
        ]}
      />
    </section>
  );
}

function Sponsors() {
  const currentPage = Reactive(1);
  const totalPages = Reactive(-1);
  const limit = 10;
  const ref = Ref(goTo.bind(null, 1));

  return (
    <div className='sponsors'>
      <div className='table-container'>
        <table className='info'>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Tier</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody on:click={sponsorClickHandler} ref={ref} />
        </table>
      </div>
      <div className='pagination'>
        <button type='button' on:click={() => goTo(--currentPage.value)} title='previous page' className='icon navigate_before' /> {currentPage}/
        {totalPages} <button type='button' on:click={() => goTo(++currentPage.value)} title='next page' className='icon navigate_next' />
      </div>
    </div>
  );

  async function goTo(page) {
    if (totalPages.value === 0) {
      currentPage.value = 0;
      return;
    }

    if (page < 1) {
      page = 1;
      currentPage.value = 1;
    } else if (totalPages.value > 0 && page > totalPages.value) {
      currentPage.value = totalPages.value;
      return;
    }

    const res = await fetch(`/api/admin/sponsors?page=${page}&limit=${limit}`);
    if (!res.ok) {
      ref.innerHTML = 'Failed to load sponsors';
      return;
    }
    const { sponsors, pages } = await res.json();
    if (!Array.isArray(sponsors)) {
      ref.innerHTML = 'Failed to load sponsors';
      return;
    }
    totalPages.value = pages || 0;

    if (pages === 0) {
      currentPage.value = 0;
      ref.innerHTML = '';
      return;
    }

    currentPage.value = page;
    ref.innerHTML = '';
    ref.append(
      ...sponsors.map((s) => {
        const expired = s.expires_at && new Date(s.expires_at) < new Date();
        let statusLabel = 'Pending';
        if (expired) {
          statusLabel = 'Expired';
        } else if (s.status === 0) {
          statusLabel = 'Active';
        } else if (s.status === 1) {
          statusLabel = 'Canceled';
        }
        const statusClass = expired ? 'status-expired' : '';
        return (
          <tr id={`sponsor-${s.id}`}>
            <td>{s.id}</td>
            <td>{s.name}</td>
            <td>{s.tier}</td>
            <td>{s.email}</td>
            <td className={statusClass}>{statusLabel}</td>
            <td>{moment(s.created_at).format('DD-MM-YY')}</td>
            <td style={{ textAlign: 'center' }}>
              <span data-action='delete' data-sponsor-id={s.id} className='icon delete' />
            </td>
          </tr>
        );
      }),
    );
  }

  async function sponsorClickHandler(e) {
    const { action, sponsorId } = e.target.dataset;
    if (action === 'delete') {
      const confirmation = await confirm('WARNING', 'Are you sure you want to delete this sponsor?');
      if (confirmation) {
        try {
          const res = await fetch(`/api/sponsors/${sponsorId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Delete failed');
          goTo(currentPage.value);
        } catch {
          alert('Error', 'Failed to delete sponsor');
        }
      }
    }
  }
}

function Plugins() {
  const tblBody = Ref();
  const summaryRef = Ref();
  const prevBtn = Ref();
  const nextBtn = Ref();
  const currentPage = Reactive(1);
  const totalPages = Reactive(0);
  const totalCount = Reactive(0);
  const limit = 10;
  let abortController;
  let debounceTimer;
  let searchQuery = '';
  let statusFilter = '';

  const onSearchInput = (e) => {
    searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchPlugins(1), 400);
  };

  const onStatusFilter = (e) => {
    statusFilter = e.target.value;
    fetchPlugins(1);
  };

  tblBody.onref = () => fetchPlugins(1);

  async function fetchPlugins(page) {
    if (!tblBody.el) return;
    if (abortController) abortController.abort();
    abortController = new AbortController();

    tblBody.el.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';

    let url = `/api/admin/plugins?page=${page}&limit=${limit}`;
    if (statusFilter !== '') {
      url += `&status=${encodeURIComponent(statusFilter)}`;
    }
    if (searchQuery) {
      url += `&search=${encodeURIComponent(searchQuery)}`;
    }

    try {
      const res = await fetch(url, { signal: abortController.signal });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const { plugins, pages, total } = data;
      currentPage.value = page;
      totalPages.value = pages;
      totalCount.value = total;
      updatePaginationButtons();

      if (summaryRef.el) {
        const start = total === 0 ? 0 : (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);
        summaryRef.el.textContent = `Showing ${start}–${end} of ${total} plugins`;
      }

      if (!total) {
        tblBody.el.innerHTML = '<tr><td colspan="6" class="empty-cell">No plugins found</td></tr>';
        return;
      }

      const statusLabels = ['Pending', 'Approved', 'Rejected', 'Deleted'];

      tblBody.el.innerHTML = '';
      tblBody.el.append(
        ...plugins.map((p) => (
          <tr id={`plugin-${p.id}`}>
            <td>
              <a href={`/plugin/${p.id}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', textAlign: 'left', margin: 0 }}>
                {p.name}
                <span>{p.id}</span>
                <span>
                  {Number(p.price) > 0 && <span className='plugin-price'>&#8377;{Number(p.price).toLocaleString()}</span>}
                  <span className='icon download'></span> {Number(p.downloads).toLocaleString()}
                </span>
              </a>
            </td>
            <td>{p.author}</td>
            <td>
              <span className={`status-badge status-${p.status_text}`} data-action='update-status' data-plugin-id={p.id} data-status={p.status}>
                {statusLabels[p.status] || p.status_text} <span className='chevron' />
              </span>
            </td>
            <td>
              <span className='editor-badge' data-action='update-editor' data-plugin-id={p.id} data-editor={p.supported_editor}>
                {p.supported_editor} <span className='chevron' />
              </span>
            </td>
            <td>{moment(p.created_at).format('DD-MM-YY')}</td>
            <td style={{ textAlign: 'center' }}>
              <span data-action='delete' data-plugin-id={p.id} className='icon delete' />
            </td>
          </tr>
        )),
      );
    } catch (err) {
      if (err?.name === 'AbortError') return;
      currentPage.value = 1;
      totalPages.value = 0;
      totalCount.value = 0;
      updatePaginationButtons();
      if (summaryRef.el) summaryRef.el.textContent = '';
      tblBody.el.innerHTML = '<tr><td colspan="6" class="error-cell"></td></tr>';
      tblBody.el.querySelector('.error-cell').textContent = err.message || 'Failed to load plugins';
    }
  }

  function updatePaginationButtons() {
    if (prevBtn.el) prevBtn.el.disabled = currentPage.value <= 1 || totalPages.value < 1;
    if (nextBtn.el) nextBtn.el.disabled = currentPage.value >= totalPages.value || totalPages.value < 1;
  }

  const rowClickHandler = async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const { action, pluginId } = target.dataset;

    if (action === 'update-status') {
      e.stopPropagation();
      const currentStatus = target.dataset.status;
      try {
        const statusValue = await select('Change Status', ['Pending', 'Approved', 'Rejected', 'Deleted']);
        if (!statusValue) return;
        const statusMap = { Pending: 0, Approved: 1, Rejected: 2, Deleted: 3 };
        const newStatus = statusMap[statusValue];
        if (String(newStatus) === currentStatus) return;

        const res = await fetch('/api/admin/plugin', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pluginId, status: newStatus }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        fetchPlugins(currentPage.value);
      } catch (err) {
        alert('ERROR', err.message || err);
      }
      return;
    }

    if (action === 'update-editor') {
      e.stopPropagation();
      const currentEditor = target.dataset.editor;
      try {
        const editorValue = await select('Change Editor', ['ace', 'cm', 'all']);
        if (!editorValue) return;
        if (editorValue === currentEditor) return;

        const res = await fetch('/api/admin/plugin', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pluginId, supported_editor: editorValue }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        fetchPlugins(currentPage.value);
      } catch (err) {
        alert('ERROR', err.message || err);
      }
      return;
    }

    if (action === 'delete') {
      const confirmation = await confirm('WARNING', 'Are you sure you want to delete this plugin?');
      if (!confirmation) return;
      try {
        const res = await fetch(`/api/plugin/${pluginId}?mode=hard`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        fetchPlugins(currentPage.value);
      } catch (err) {
        alert('ERROR', err.message || err);
      }
    }
  };

  const goTo = (page) => {
    if (page < 1 || (totalPages.value > 0 && page > totalPages.value)) return;
    if (totalPages.value < 1) return;
    fetchPlugins(page);
  };

  return (
    <div className='admin-plugins'>
      <div className='table-container'>
        <table className='info plugins-table'>
          <thead>
            <tr>
              <th>
                <input className='search-input' type='search' placeholder='Search by name...' oninput={onSearchInput} />
              </th>
              <th>Author</th>
              <th>
                <select className='status-filter' onchange={onStatusFilter}>
                  <option value=''>All Status</option>
                  <option value='0'>Pending</option>
                  <option value='1'>Approved</option>
                  <option value='2'>Rejected</option>
                  <option value='3'>Deleted</option>
                </select>
              </th>
              <th>Editor</th>
              <th>Date</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody ref={tblBody} onclick={rowClickHandler} />
        </table>
      </div>
      <small ref={summaryRef} className='summary-text'>
        Loading...
      </small>
      <div className='pagination'>
        <button ref={prevBtn} type='button' on:click={() => goTo(currentPage.value - 1)} title='Previous page' className='icon navigate_before' />
        <span>
          {currentPage}/{totalPages}
        </span>
        <button ref={nextBtn} type='button' on:click={() => goTo(currentPage.value + 1)} title='Next page' className='icon navigate_next' />
      </div>
    </div>
  );
}

function Dashboard() {
  const ref = Ref();

  (async () => {
    try {
      const [statsRes, analyticsRes] = await Promise.all([fetch('api/admin/'), fetch('api/admin/analytics')]);
      const stats = await statsRes.json();
      const analytics = await analyticsRes.json();

      const revenueCanvas = Ref();
      const paymentsCanvas = Ref();
      const paymentStatusCanvas = Ref();
      const editorCanvas = Ref();
      const topDevCanvas = Ref();
      const providerStatusCanvas = Ref();

      ref.append(
        <div className='dashboard-grid'>
          <Card title='Total Users' text={stats.users} />
          <Card title='Amount Paid' text={stats.amountPaid || 0} />
          <Card title='Plugin Sales' text={stats.pluginSales || 0} />
          <Card title='Plugin Downloads' text={stats.pluginDownloads || 0} />
          <Card title='Download Report' icon='download' onclick={openReportDialog} />
        </div>,
        <div className='charts-grid'>
          <div className='chart-card'>
            <h3>Monthly Revenue (INR)</h3>
            <div className='chart-container'>
              <canvas ref={revenueCanvas} />
            </div>
          </div>
          <div className='chart-card'>
            <h3>Monthly Payments (INR)</h3>
            <div className='chart-container'>
              <canvas ref={paymentsCanvas} />
            </div>
          </div>
          <div className='chart-card'>
            <h3>Top Developers (INR)</h3>
            <div className='chart-container'>
              <canvas ref={topDevCanvas} />
            </div>
          </div>
          <div className='chart-card'>
            <h3>Orders: Provider vs Status</h3>
            <div className='chart-container'>
              <canvas ref={providerStatusCanvas} />
            </div>
          </div>
          <div className='chart-card'>
            <h3>Payment Status</h3>
            <div className='chart-container chart-container--small'>
              <canvas ref={paymentStatusCanvas} />
            </div>
          </div>
          <div className='chart-card'>
            <h3>Editor Distribution</h3>
            <div className='chart-container chart-container--small'>
              <canvas ref={editorCanvas} />
            </div>
          </div>
        </div>,
      );

      initChart(revenueCanvas, lineChartConfig(analytics.monthlyRevenue, 'Revenue (INR)', '#22c55e'));
      initChart(paymentsCanvas, lineChartConfig(analytics.monthlyPayments, 'Payments (INR)', '#3b82f6'));
      initChart(topDevCanvas, horizontalBarChartConfig(analytics.topDevelopers, 'name', 'total'));
      initChart(providerStatusCanvas, providerStatusChartConfig(analytics.providerStatus));
      initChart(paymentStatusCanvas, doughnutChartConfig(analytics.paymentStatus, 'status', 'count'));
      initChart(editorCanvas, doughnutChartConfig(analytics.editorDistribution, 'editor', 'count'));
    } catch {
      ref.innerHTML = '<div class="error">Failed to load dashboard data</div>';
    }
  })();

  return <div ref={ref} className='admin-dashboard' />;
}

function initChart(canvasRef, config) {
  let instance = null;
  canvasRef.onref = () => {
    if (instance) instance.destroy();
    instance = new Chart(canvasRef.el, config);
  };
}

function lineChartConfig(rows, label, color = '#3b82f6') {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const dataMap = {};
  for (const row of rows) {
    dataMap[row.month] = Number(row.total || row.count || 0);
  }
  const values = months.map((m) => dataMap[m] || 0);

  return {
    type: 'line',
    data: {
      labels: months.map((m) => {
        const [yr, mo] = m.split('-');
        return `${monthNames[Number(mo) - 1].slice(0, 3)} '${yr.slice(2)}`;
      }),
      datasets: [
        {
          label,
          data: values,
          borderColor: color,
          backgroundColor: `${color}1a`,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: color,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    },
    options: chartBaseOptions(),
  };
}

function doughnutChartConfig(rows, labelKey, valueKey) {
  const labels = rows.map((r) => r[labelKey]);
  const values = rows.map((r) => Number(r[valueKey]) || 0);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

  return {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors.slice(0, rows.length),
          borderColor: 'rgba(0,0,0,0.2)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255,255,255,0.7)', padding: 16, font: { size: 12 } },
        },
      },
    },
    plugins: [
      {
        id: 'doughnutPercentLabels',
        afterDatasetsDraw(chart) {
          const { ctx, data: chartData } = chart;
          const dataset = chartData.datasets[0];
          const meta = chart.getDatasetMeta(0);
          ctx.save();
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let i = 0; i < dataset.data.length; i++) {
            const value = dataset.data[i];
            if (value === 0) continue;
            const pct = Math.round((value / total) * 100);
            const arc = meta.data[i];
            const { x, y } = arc.tooltipPosition(true);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.fillText(`${pct}%`, x, y);
            ctx.shadowBlur = 0;
          }
          ctx.restore();
        },
      },
    ],
  };
}

function horizontalBarChartConfig(rows, labelKey, valueKey) {
  const names = rows.map((r) => r[labelKey] || 'Unknown');
  const values = rows.map((r) => Number(r[valueKey]) || 0);
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16', '#f97316'];

  return {
    type: 'bar',
    data: {
      labels: names,
      datasets: [
        {
          label: 'Earnings (INR)',
          data: values,
          backgroundColor: names.map((_, i) => colors[i % colors.length]),
          borderColor: 'rgba(0,0,0,0.2)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
          beginAtZero: true,
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.7)', font: { size: 12 }, padding: 8 },
          grid: { display: false },
        },
      },
    },
  };
}

function providerStatusChartConfig(rows) {
  const providerLabels = [...new Set(rows.map((r) => r.provider))];
  const statuses = [...new Set(rows.map((r) => r.status))];
  const colorMap = { Successful: '#22c55e', Failed: '#ef4444', Other: '#f59e0b' };
  const providerNameMap = { google_play: 'Google Play', razorpay: 'Razorpay' };

  const dataMap = {};
  for (const row of rows) {
    if (!dataMap[row.status]) dataMap[row.status] = {};
    dataMap[row.status][row.provider] = (dataMap[row.status][row.provider] || 0) + Number(row.count);
  }

  const datasets = statuses.map((status) => ({
    label: status,
    data: providerLabels.map((p) => dataMap[status]?.[p] || 0),
    backgroundColor: colorMap[status] || '#8b5cf6',
    borderColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1,
  }));

  return {
    type: 'bar',
    data: {
      labels: providerLabels.map((p) => providerNameMap[p] || p),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255,255,255,0.7)', padding: 16, font: { size: 12 } },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
          beginAtZero: true,
        },
      },
    },
    plugins: [
      {
        id: 'barValueLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 2;
          for (const ds of chart.data.datasets) {
            const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(ds));
            for (let i = 0; i < ds.data.length; i++) {
              const value = ds.data[i];
              if (!value) continue;
              const { x, y } = meta.data[i];
              ctx.fillText(value, x, y - 2);
            }
          }
          ctx.shadowBlur = 0;
          ctx.restore();
        },
      },
    ],
  };
}

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      x: {
        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
        grid: { color: 'rgba(255,255,255,0.06)' },
      },
      y: {
        ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } },
        grid: { color: 'rgba(255,255,255,0.06)' },
        beginAtZero: true,
      },
    },
  };
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function openReportDialog() {
  const yearRef = Ref();
  const monthRef = Ref();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const currentMonth = new Date().getMonth() + 1;

  const dialogBody = (
    <div className='report-dialog'>
      <div className='form-row'>
        <label>Year</label>
        <select ref={yearRef}>
          {years.map((y) => (
            <option value={y} selected={y === currentYear}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div className='form-row'>
        <label>Month</label>
        <select ref={monthRef}>
          {monthNames.map((m, i) => (
            <option value={i + 1} selected={i + 1 === currentMonth}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className='form-row'>
        <label>Type</label>
        <div className='radio-group'>
          <label>
            <input type='radio' name='reportType' value='sales' checked />
            Sales (Orders)
          </label>
          <label>
            <input type='radio' name='reportType' value='earnings' />
            Earnings
          </label>
        </div>
      </div>
    </div>
  );

  const $dialog = DialogBox({
    title: 'Download Report',
    body: dialogBody,
    onok: (hide, $box) => {
      const year = yearRef.el.value;
      const month = monthRef.el.value;
      const type = $box.querySelector('input[name="reportType"]:checked')?.value || 'sales';
      window.open(`api/admin/reports/${year}/${month}?type=${type}`);
      hide();
    },
    oncancel: (hide) => hide(),
  });

  document.body.append($dialog);
}

/**
 * Card component to display title and content
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.text]
 * @param {string} [props.icon]
 * @param {()=>{}} [props.onclick]
 */
function Card({ title, text, icon, onclick }) {
  return (
    <div className='card' onclick={onclick}>
      {icon ? <span className={`content icon ${icon}`} /> : <span className='content'>{text?.toLocaleString()}</span>}
      <span className='title'>{title}</span>
    </div>
  );
}

function AppSettings() {
  const priceRef = Ref();
  const thresholdRef = Ref();
  const priceStatusRef = Ref();
  const thresholdStatusRef = Ref();

  (async () => {
    try {
      const res = await fetch('/api/admin/config');
      const config = await res.json();
      if (priceRef.el) {
        priceRef.el.value = config.acode_pro_price;
      }
      if (thresholdRef.el) {
        thresholdRef.el.value = config.payment_threshold;
      }
    } catch {
      const msg = 'Failed to load config';
      if (priceStatusRef.el) priceStatusRef.el.textContent = msg;
      if (thresholdStatusRef.el) thresholdStatusRef.el.textContent = msg;
    }
  })();

  const onSave = async (key) => {
    let value;
    let numValue;

    if (key === 'acode_pro_price') {
      if (!priceRef.el) return;
      value = priceRef.el.value;
      numValue = Number(value);
      if (Number.isNaN(numValue) || numValue <= 0) {
        alert('ERROR', 'Price must be a positive number');
        return;
      }
    } else if (key === 'payment_threshold') {
      if (!thresholdRef.el) return;
      value = thresholdRef.el.value;
      numValue = Number(value);
      if (Number.isNaN(numValue) || numValue <= 0 || !Number.isInteger(numValue)) {
        alert('ERROR', 'Threshold must be a positive integer');
        return;
      }
    }

    const statusEl = key === 'acode_pro_price' ? priceStatusRef.el : thresholdStatusRef.el;
    if (!statusEl) return;

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        statusEl.textContent = 'Saved!';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 2000);
      }
    } catch {
      alert('ERROR', 'Failed to save config');
    }
  };

  return (
    <div className='app-settings'>
      <div className='setting-row'>
        <label>Acode Pro Price (INR)</label>
        <div className='setting-input'>
          <input ref={priceRef} type='number' min='1' step='1' placeholder='370' />
          <button type='button' onclick={() => onSave('acode_pro_price')}>
            Save
          </button>
          <span ref={priceStatusRef} className='status' />
        </div>
      </div>
      <div className='setting-row'>
        <label>Payment Threshold (INR)</label>
        <div className='setting-input'>
          <input ref={thresholdRef} type='number' min='1' step='1' placeholder='15000' />
          <button type='button' onclick={() => onSave('payment_threshold')}>
            Save
          </button>
          <span ref={thresholdStatusRef} className='status' />
        </div>
      </div>
    </div>
  );
}

function Users() {
  const currentPage = Reactive(0);
  const totalPages = Reactive(1);
  const limit = 10;
  const ref = Ref(goTo.bind(null, currentPage.value));
  let debounceTimer;
  let name = '';
  let email = '';

  const oninput = (e) => {
    const { value } = e.target;
    if (e.target.name === 'name') {
      name = value;
    } else {
      email = value;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => goTo(1), 500);
  };

  return (
    <div className='users'>
      <div className='table-container'>
        <table className='info'>
          <thead>
            <tr>
              <th>ID</th>
              <th>
                <Input oninput={oninput} name='name' type='search' label='Name' placeholder='Search by name' />
              </th>
              <th>
                <Input oninput={oninput} name='email' type='search' label='Email' placeholder='Search by email' />
              </th>
              <th>Joined</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody on:click={clickHandler} ref={ref} />
        </table>
      </div>
      <div className='pagination'>
        <button type='button' on:click={() => goTo(currentPage.value - 1)} title='previous page' className='icon navigate_before' /> {currentPage}/
        {totalPages} <button type='button' on:click={() => goTo(currentPage.value + 1)} title='next page' className='icon navigate_next' />
      </div>
    </div>
  );

  /**
   * Go to a specific page
   * @param {number} page
   * @returns
   */
  async function goTo(page) {
    if (page < 1) {
      page = 1;
      currentPage.value = 1;
    } else if (totalPages.value !== -1 && page > totalPages.value) {
      page = totalPages.value;
      currentPage.value = totalPages.value;
      return;
    }

    let apiUrl = `api/admin/users?page=${page}&limit=${limit}`;

    if (name) {
      apiUrl += `&name=${name}`;
    }
    if (email) {
      apiUrl += `&email=${email}`;
    }

    const res = await fetch(apiUrl);
    const { users, pages } = await res.json();
    totalPages.value = pages;
    ref.innerHTML = '';
    ref.append(
      ...users.map((user) => (
        <tr id={`user-${user.id}`}>
          <td>
            <a href={`/profile/${user.id}`}>{user.id}</a>
          </td>
          <td>{user.name}</td>
          <td>{user.email}</td>
          <td>{moment(user.created_at).format('DD-MM-YY')}</td>
          <td style={{ textAlign: 'center' }}>
            <span data-action='delete' data-user-id={user.id} className='icon delete' />
          </td>
        </tr>
      )),
    );
  }
}

/**
 * Click event handler
 * @param {MouseEvent} e
 */
async function clickHandler(e) {
  const { target } = e;
  const { action } = target.dataset;
  if (action === 'delete') {
    const { userId } = e.target.dataset;
    const confirmation = await confirm('WARNING', 'Are you sure you want to delete this user?');
    if (confirmation) {
      await deleteUser(userId);
      app.get(`#user-${userId}`)?.remove();
    }
  }
}

/**
 * Delete user
 * @param {string} id
 */
async function deleteUser(id) {
  const res = await fetch(`api/admin/user/${id}`, {
    method: 'DELETE',
  });
  const json = await res.json();
  if (json.error) {
    alert('ERROR', json.error);
  } else {
    alert('Success', 'User deleted successfully');
  }
}

function EmailUsers() {
  const recipientCount = Reactive(0);
  const sendBtn = Ref();
  let filter = 'all';
  let subject = '';
  let message = '';

  const fetchCount = async (selectedFilter) => {
    const res = await fetch(`api/admin/email-recipients-count?filter=${selectedFilter}`);
    const json = await res.json();
    recipientCount.value = json.count;
  };

  fetchCount(filter);

  const onFilterChange = (e) => {
    filter = e.target.value;
    fetchCount(filter);
  };

  const onSend = async () => {
    if (!subject.trim() || !message.trim()) {
      alert('ERROR', 'Subject and message are required');
      return;
    }
    const confirmation = await confirm('Confirm', `Send email to ${recipientCount.value} recipient(s)?`);
    if (!confirmation) return;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      const res = await fetch('api/admin/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, subject, message }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        alert('Success', `Email sent to ${json.sent} user(s)`);
      }
    } catch {
      alert('ERROR', 'Failed to send emails');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send Email';
    }
  };

  return (
    <div className='email-users'>
      <div className='email-form'>
        <div className='form-group'>
          <label>Recipients</label>
          <select onchange={onFilterChange}>
            <option value='all'>All Users</option>
            <option value='with_plugins'>Users with Plugins</option>
            <option value='with_paid_plugins'>Users with Paid Plugins</option>
            <option value='with_payment'>Users who Received Payment</option>
          </select>
          <small>{recipientCount} recipient(s) will receive this email</small>
        </div>
        <Input
          label='Subject'
          placeholder='Email subject'
          oninput={(e) => {
            subject = e.target.value;
          }}
        />
        <div className='form-group'>
          <label>Message</label>
          <textarea
            placeholder='Email message...'
            oninput={(e) => {
              message = e.target.value;
            }}
          />
        </div>
        <button ref={sendBtn} type='button' onclick={onSend} className='send-btn'>
          Send Email
        </button>
      </div>
    </div>
  );
}

function Payments() {
  const tblBody = Ref();
  const summaryRef = Ref();
  const prevBtn = Ref();
  const nextBtn = Ref();
  const currentPage = Reactive(1);
  const totalPages = Reactive(0);
  const totalCount = Reactive(0);
  const limit = 10;
  let abortController;
  let debounceTimer;
  let searchQuery = '';
  let statusFilter = 'all';

  const paymentMethod = Ref();
  const $paymentDialog = (
    <DialogBox oncancel={(hide) => hide()}>
      <table ref={paymentMethod} className='payment-method' />
    </DialogBox>
  );

  const onSearchInput = (e) => {
    searchQuery = e.target.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchPayments(1), 400);
  };

  const onStatusFilter = (e) => {
    statusFilter = e.target.value;
    fetchPayments(1);
  };

  tblBody.onref = () => fetchPayments(1);

  async function fetchPayments(page) {
    if (!tblBody.el) return;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    tblBody.el.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';

    let url = `/api/admin/payments?page=${page}&limit=${limit}`;
    if (statusFilter !== 'all') {
      url += `&status=${encodeURIComponent(statusFilter)}`;
    }
    if (searchQuery) {
      url += `&search=${encodeURIComponent(searchQuery)}`;
    }

    try {
      const res = await fetch(url, { signal: abortController.signal });

      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const { payments, pages, total } = data;

      currentPage.value = page;
      totalPages.value = pages;
      totalCount.value = total;
      updatePaginationButtons();

      if (summaryRef.el) {
        const start = total === 0 ? 0 : (page - 1) * limit + 1;
        const end = Math.min(page * limit, total);
        summaryRef.el.textContent = `Showing ${start}–${end} of ${total} payments`;
      }

      if (!total) {
        tblBody.el.innerHTML = '<tr><td colspan="6" class="empty-cell">No payments found</td></tr>';
        return;
      }

      tblBody.el.innerHTML = '';
      tblBody.el.append(
        ...payments.map((p) => (
          <tr data-id={p.id} data-pmid={p.payment_method_id} data-amount={p.amount} className={`payment-row ${p.status}`}>
            <td>{p.id}</td>
            <td>{p.user_name}</td>
            <td>{p.user_email}</td>
            <td className='amount-cell'>&#8377; {p.amount.toLocaleString()}</td>
            <td>
              <span className={`status-badge status-${p.status}`} data-action='update-status' data-id={p.id}>
                {p.status} <span className='chevron' />
              </span>
            </td>
            <td>{moment(p.created_at).format('DD-MM-YY')}</td>
          </tr>
        )),
      );
    } catch (err) {
      if (err?.name === 'AbortError') return;

      currentPage.value = 1;
      totalPages.value = 0;
      totalCount.value = 0;
      updatePaginationButtons();
      if (summaryRef.el) summaryRef.el.textContent = '';
      tblBody.el.innerHTML = '<tr><td colspan="6" class="error-cell"></td></tr>';
      tblBody.el.querySelector('.error-cell').textContent = err.message || 'Failed to load payments';
    }
  }

  function updatePaginationButtons() {
    if (prevBtn.el) prevBtn.el.disabled = currentPage.value <= 1 || totalPages.value < 1;
    if (nextBtn.el) nextBtn.el.disabled = currentPage.value >= totalPages.value || totalPages.value < 1;
  }

  const rowClickHandler = async (e) => {
    const badge = e.target.closest('.status-badge');
    if (badge) {
      e.stopPropagation();
      const { id } = badge.dataset;

      try {
        const statusValue = await select('Select Status', ['none', 'paid', 'initiated']);
        if (!statusValue) return;

        const body = new FormData();
        body.append('id', id);
        body.append('status', statusValue);

        const data = await fetch('/api/admin/payment', {
          method: 'PATCH',
          body,
        }).then((res) => res.json());

        if (data.error) {
          throw new Error(data.error);
        }

        fetchPayments(currentPage.value);
      } catch (err) {
        alert('ERROR', err.message || err);
      }
      return;
    }

    const row = e.target.closest('tr');
    if (row) {
      showPaymentMethod({
        id: row.dataset.id,
        payment_method_id: row.dataset.pmid,
        amount: row.dataset.amount,
      });
    }
  };

  async function showPaymentMethod({ id, payment_method_id: pmId, amount }) {
    try {
      const prev = tblBody.el?.querySelector('.active-row');
      prev?.classList.remove('active-row');
      const row = tblBody.el?.querySelector(`[data-id='${id}']`);
      row?.classList.add('active-row');

      const data = await fetch(`/api/admin/payment-method/${pmId}`).then((res) => res.json());

      if (data.error) throw new Error(data.error);

      paymentMethod.el.content = (
        <>
          {data.bank_account_number && (
            <tr>
              <th>Account</th>
              <td>
                <span>{data.bank_name}</span>
                <br />
                <strong>{data.bank_account_number}</strong>
                <br />
                <span>
                  {data.bank_account_type} ({data.bank_account_holder})
                </span>
                <br />
                <span>IFSC: {data.bank_ifsc_code}</span>
                <br />
                <span>SWIFT: {data.bank_swift_code}</span>
              </td>
            </tr>
          )}
          {data.paypal_email && (
            <tr>
              <th>Paypal Email</th>
              <td>{data.paypal_email}</td>
            </tr>
          )}
          {data.wallet_address && (
            <tr>
              <th>Wallet</th>
              <td>
                <span>{data.wallet_type}</span>
                <br />
                <strong>{data.wallet_address}</strong>
              </td>
            </tr>
          )}
          <tr>
            <th>User</th>
            <td>{data.user_name}</td>
          </tr>
          <tr>
            <th>Email</th>
            <td>{data.user_email}</td>
          </tr>
          <tr>
            <th>Amount</th>
            <td>&#8377; {amount}</td>
          </tr>
        </>
      );
      document.body.append($paymentDialog);
    } catch (err) {
      alert('ERROR', err.message || err);
    }
  }

  const goTo = (page) => {
    if (page < 1 || (totalPages.value > 0 && page > totalPages.value)) return;
    if (totalPages.value < 1) return;
    fetchPayments(page);
  };

  return (
    <div className='admin-payments'>
      <div className='payments-toolbar'>
        <div className='search-box'>
          <span className='icon search' />
          <input className='search-input' type='search' placeholder='Search by name or email...' oninput={onSearchInput} />
        </div>
      </div>
      <div className='table-container'>
        <table className='info payments-table'>
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Email</th>
              <th>Amount</th>
              <th>
                <select className='status-filter' onchange={onStatusFilter}>
                  <option value='all'>All Status</option>
                  <option value='paid'>Paid</option>
                  <option value='initiated'>Initiated</option>
                  <option value='none'>None</option>
                </select>
              </th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody ref={tblBody} onclick={rowClickHandler} />
        </table>
      </div>
      <small ref={summaryRef} className='summary-text'>
        Loading...
      </small>
      <div className='pagination'>
        <button ref={prevBtn} type='button' on:click={() => goTo(currentPage.value - 1)} title='Previous page' className='icon navigate_before' />
        <span>
          {currentPage}/{totalPages}
        </span>
        <button ref={nextBtn} type='button' on:click={() => goTo(currentPage.value + 1)} title='Next page' className='icon navigate_next' />
      </div>
    </div>
  );
}

function Promotions() {
  const listRef = Ref();
  const statusRef = Ref();

  const createFormRow = (promo = {}) => {
    const row = (
      <div className='promo-form-row'>
        <input type='url' placeholder='URL' value={promo.url || ''} className='promo-url' />
        <input type='text' placeholder='Label' value={promo.label || ''} className='promo-label' />
        <input type='text' placeholder='Icon' value={promo.icon || ''} className='promo-icon' />
        <input type='text' placeholder='Link Text' value={promo.link_text || ''} className='promo-link-text' />
        <button
          type='button'
          className='icon delete promo-delete'
          onclick={(e) => {
            e.target.closest('.promo-form-row').remove();
          }}
        />
      </div>
    );
    return row;
  };

  (async () => {
    try {
      const res = await fetch('/api/admin/promotions');
      if (!res.ok) {
        if (statusRef.el) statusRef.el.textContent = 'Failed to load promotions';
        return;
      }
      const json = await res.json();
      if (Array.isArray(json)) {
        for (const promo of json) {
          const row = createFormRow(promo);
          listRef.el.append(row);
        }
      }
    } catch {
      if (statusRef.el) statusRef.el.textContent = 'Failed to load promotions';
    }
  })();

  const onAdd = () => {
    const row = createFormRow();
    listRef.el.append(row);
  };

  const onSave = async () => {
    const rows = listRef.el.querySelectorAll('.promo-form-row');
    const promotions = [];
    for (const row of rows) {
      const url = row.querySelector('.promo-url').value.trim();
      const label = row.querySelector('.promo-label').value.trim();
      const icon = row.querySelector('.promo-icon').value.trim();
      const link_text = row.querySelector('.promo-link-text').value.trim();
      if (!url || !label || !icon || !link_text) {
        alert('ERROR', 'All fields (url, label, icon, link_text) are required for each promotion');
        return;
      }
      promotions.push({ url, label, icon, link_text });
    }
    try {
      const res = await fetch('/api/admin/promotions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotions }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        statusRef.el.textContent = 'Saved!';
        setTimeout(() => {
          if (statusRef.el) statusRef.el.textContent = '';
        }, 2000);
      }
    } catch {
      alert('ERROR', 'Failed to save promotions');
    }
  };

  return (
    <div className='promotions'>
      <div ref={listRef} className='promo-list' />
      <div className='promo-actions'>
        <button type='button' onclick={onAdd} className='promo-add-btn'>
          + Add Promotion
        </button>
        <button type='button' onclick={onSave} className='promo-save-btn'>
          Save All
        </button>
        <span ref={statusRef} className='status' />
      </div>
    </div>
  );
}

function Modes() {
  const listRef = Ref();
  const statusRef = Ref();

  let searchTimer;

  function attachAutocomplete(input) {
    let dropdown;
    let abortController;

    const text = (s) => document.createTextNode(s);

    const hideDropdown = () => {
      if (dropdown) {
        dropdown.remove();
        dropdown = null;
      }
    };

    const showDropdown = (items) => {
      hideDropdown();
      dropdown = document.createElement('div');
      dropdown.className = 'mode-autocomplete';
      for (const item of items) {
        const el = document.createElement('div');
        el.className = 'mode-autocomplete-item';
        el.append(text(item.id), text(' — '), text(item.name));
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const val = input.value;
          const lastComma = val.lastIndexOf(',');
          const ids = val
            .slice(0, lastComma + 1)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          ids.push(item.id);
          input.value = ids.join(', ');
          hideDropdown();
          input.focus();
        });
        dropdown.append(el);
      }
      const rect = input.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + window.scrollY}px`;
      dropdown.style.left = `${rect.left + window.scrollX}px`;
      dropdown.style.minWidth = `${rect.width}px`;
      document.body.append(dropdown);
    };

    input.addEventListener('input', () => {
      const val = input.value;
      const lastComma = val.lastIndexOf(',');
      const segment = val.slice(lastComma + 1).trim();
      if (segment.length < 2) {
        hideDropdown();
        return;
      }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        if (abortController) abortController.abort();
        abortController = new AbortController();
        try {
          const res = await fetch(`/api/admin/plugins/search?q=${encodeURIComponent(segment)}`, { signal: abortController.signal });
          const items = await res.json();
          if (items.length) showDropdown(items);
          else hideDropdown();
        } catch {
          // aborted
        }
      }, 300);
    });

    input.addEventListener('blur', () => {
      setTimeout(hideDropdown, 150);
    });

    input.addEventListener('keydown', (e) => {
      if (!dropdown) return;
      const items = dropdown.querySelectorAll('.mode-autocomplete-item');
      const active = dropdown.querySelector('.mode-autocomplete-item.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active) {
          active.classList.remove('active');
          const next = active.nextElementSibling || items[0];
          next.classList.add('active');
        } else {
          items[0]?.classList.add('active');
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) {
          active.classList.remove('active');
          const prev = active.previousElementSibling || items[items.length - 1];
          prev.classList.add('active');
        } else {
          items[items.length - 1]?.classList.add('active');
        }
      } else if (e.key === 'Enter') {
        if (active) {
          e.preventDefault();
          active.dispatchEvent(new Event('mousedown', { bubbles: true }));
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });
  }

  const createFormRow = (modeItem = {}) => {
    const inputRef = Ref();
    const row = (
      <div className='mode-form-row'>
        <input type='text' placeholder='Mode (e.g. csv, python)' value={modeItem.mode || ''} className='mode-name' />
        <input
          ref={inputRef}
          type='text'
          placeholder='Search & add plugin IDs...'
          value={Array.isArray(modeItem.pluginIds) ? modeItem.pluginIds.join(', ') : ''}
          className='mode-plugins'
        />
        <button
          type='button'
          className='icon delete mode-delete'
          onclick={(e) => {
            e.target.closest('.mode-form-row').remove();
          }}
        />
      </div>
    );
    inputRef.onref = (el) => {
      if (el) attachAutocomplete(el);
    };
    return row;
  };

  (async () => {
    try {
      const res = await fetch('/api/admin/modes');
      if (!res.ok) {
        if (statusRef.el) statusRef.el.textContent = 'Failed to load modes';
        return;
      }
      const json = await res.json();
      if (Array.isArray(json)) {
        for (const m of json) {
          const row = createFormRow(m);
          listRef.el.append(row);
        }
      }
    } catch {
      if (statusRef.el) statusRef.el.textContent = 'Failed to load modes';
    }
  })();

  const onAdd = () => {
    const row = createFormRow();
    listRef.el.append(row);
  };

  const onSave = async () => {
    const rows = listRef.el.querySelectorAll('.mode-form-row');
    const modes = [];
    for (const row of rows) {
      const mode = row.querySelector('.mode-name').value.trim();
      const pluginIdsRaw = row.querySelector('.mode-plugins').value.trim();
      if (!mode) {
        alert('ERROR', 'Mode name is required for each entry');
        return;
      }
      const pluginIds = pluginIdsRaw
        ? pluginIdsRaw
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [];
      modes.push({ mode, pluginIds });
    }
    try {
      const res = await fetch('/api/admin/modes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modes }),
      });
      const json = await res.json();
      if (json.error) {
        alert('ERROR', json.error);
      } else {
        statusRef.el.textContent = 'Saved!';
        setTimeout(() => {
          if (statusRef.el) statusRef.el.textContent = '';
        }, 2000);
      }
    } catch {
      alert('ERROR', 'Failed to save modes');
    }
  };

  return (
    <div className='modes'>
      <div ref={listRef} className='mode-list' />
      <div className='mode-actions'>
        <button type='button' onclick={onAdd} className='mode-add-btn'>
          + Add Mode
        </button>
        <button type='button' onclick={onSave} className='mode-save-btn'>
          Save All
        </button>
        <span ref={statusRef} className='status' />
      </div>
    </div>
  );
}
