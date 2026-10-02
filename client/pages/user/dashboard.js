import Ref from 'html-tag-js/ref';
import { createChartLifecycle, createChartSafely, drawCrosshair } from 'lib/dashboardCharts';
import { formatCompactNumber, formatExactNumber } from 'lib/formatNumber';
import Router from 'lib/Router';
import moment from 'moment';

const DOWNLOADS_COLOR = '#3499fe';
const EARNINGS_COLOR = '#22c55e';
const TOP_PLUGINS_LIMIT = 6;
const STATUS_LABELS = { 0: 'Pending', 2: 'Rejected' };

/**
 * Developer dashboard tab shown on the profile page to the owner (and admins).
 * @param {object} props
 * @param {object} props.user Profile user
 * @param {boolean} props.isSelf Whether the logged in user owns the profile
 * @param {object} props.stats Response of `/api/user/dashboard`
 * @param {HTMLElement} props.paymentMethods Payment methods list element
 * @param {() => void} [props.onManagePlugins] Switch to the plugin manager
 */
export default function DeveloperDashboard({ user, isSelf, stats, paymentMethods, onManagePlugins }) {
  const hasActivity = stats.totals.plugins > 0 || stats.totals.lifetimeEarnings > 0;
  const downloadsCanvas = Ref();
  const earningsCanvas = Ref();
  const payoutBalance = Ref();

  const $root = (
    <div className='dev-dashboard'>
      {hasActivity && <StatTiles stats={stats} user={user} />}
      <div className='dash-grid'>
        {hasActivity ? (
          <>
            <Panel className='span-2' title='Downloads' meta={`${formatExactNumber(stats.totals.recentDownloads)} in the last ${stats.range} days`}>
              <div className='chart-box'>
                <canvas ref={downloadsCanvas} aria-label='Daily downloads for the last 30 days' role='img' />
              </div>
            </Panel>
            <Panel title='Earnings' meta='Last 12 months'>
              <div className='chart-box'>
                <canvas ref={earningsCanvas} aria-label='Monthly earnings for the last 12 months' role='img' />
              </div>
              <div className='chart-legend'>
                <span>
                  <i className='swatch' /> Settled
                </span>
                <span>
                  <i className='swatch swatch--estimated' /> Estimated
                </span>
              </div>
            </Panel>
            <Panel
              className='span-2'
              title='Top plugins'
              meta={
                onManagePlugins ? (
                  <a
                    href='?tab=plugins'
                    onclick={(e) => {
                      e.preventDefault();
                      onManagePlugins();
                    }}
                  >
                    Manage all
                  </a>
                ) : (
                  `Downloads · last ${stats.range} days`
                )
              }
            >
              <TopPlugins plugins={stats.plugins} />
            </Panel>
          </>
        ) : (
          <EmptyState isSelf={isSelf} />
        )}
        <Panel className='payout' title='Payouts' meta={<a href={`/earnings?user=${user.id}`}>History</a>}>
          <div ref={payoutBalance}>
            <div className='skeleton skeleton--payout' />
          </div>
          <div className='payout-methods'>
            <div className='payout-methods-label'>Payment methods</div>
            {paymentMethods}
          </div>
        </Panel>
      </div>
    </div>
  );

  loadPayout();
  if (hasActivity) {
    renderCharts(stats, downloadsCanvas.el, earningsCanvas.el, createChartLifecycle(Router));
  }

  return $root;

  async function loadPayout() {
    let unpaid = null;
    try {
      const res = await fetch(`/api/user/unpaid-earnings?user=${user.id}`);
      const json = await res.json();
      if (!json.error) unpaid = json;
    } catch {
      // handled by the empty payout state
    }
    payoutBalance.el.replaceChildren(<Payout unpaid={unpaid} />);
  }
}

function StatTiles({ stats, user }) {
  const { totals, monthly } = stats;
  const thisMonth = monthly[monthly.length - 1];
  const monthLabel = moment({ year: thisMonth.year, month: thisMonth.month }).format('MMM YYYY');

  return (
    <div className='stat-grid'>
      <StatTile
        icon='attach_money'
        label='This month'
        value={formatExactNumber(thisMonth.amount, { currency: true })}
        sub={`${thisMonth.estimated ? 'Estimated · ' : ''}${monthLabel}`}
        href={`/earnings?user=${user.id}`}
      />
      <StatTile
        icon='account_balance'
        label='Lifetime earnings'
        value={formatCompactNumber(totals.lifetimeEarnings, { currency: true })}
        title={formatExactNumber(totals.lifetimeEarnings, { currency: true })}
        sub={totals.paidPlugins ? `${totals.paidPlugins} paid plugin${totals.paidPlugins === 1 ? '' : 's'}` : 'From downloads'}
      />
      <StatTile
        icon='download'
        label={`Downloads · ${stats.range}d`}
        value={formatExactNumber(totals.recentDownloads)}
        sub={<Delta current={totals.recentDownloads} previous={totals.previousDownloads} />}
      />
      <StatTile
        icon='extension'
        label='Total downloads'
        value={formatCompactNumber(totals.downloads)}
        title={formatExactNumber(totals.downloads)}
        sub={`Across ${totals.plugins} plugin${totals.plugins === 1 ? '' : 's'}`}
      />
    </div>
  );
}

function StatTile({ icon, label, value, title, sub, href }) {
  const content = (
    <>
      <div className='stat-label'>
        <span className={`icon ${icon}`} />
        {label}
      </div>
      <div className='stat-value' title={title || value}>
        {value}
      </div>
      <div className='stat-sub'>{sub}</div>
    </>
  );

  if (href) {
    return (
      <a className='stat-tile stat-tile--link' href={href}>
        {content}
      </a>
    );
  }

  return <div className='stat-tile'>{content}</div>;
}

function Delta({ current, previous }) {
  if (previous === null) {
    return <span className='delta delta--flat'>Not enough history to compare yet</span>;
  }

  if (!previous) {
    return <span className='delta delta--flat'>{current ? 'New activity this period' : 'No downloads yet'}</span>;
  }

  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(change));
  let direction = 'flat';
  if (change > 0.5) direction = 'up';
  else if (change < -0.5) direction = 'down';
  const arrow = { up: '▲', down: '▼', flat: '■' }[direction];

  return (
    <span className={`delta delta--${direction}`} title={`Previous period: ${formatExactNumber(previous)}`}>
      {arrow} {rounded}% <span className='delta-hint'>vs previous</span>
    </span>
  );
}

function Panel({ title, meta, className = '' }, children) {
  return (
    <div className={`panel ${className}`}>
      <div className='panel-head'>
        <h3>{title}</h3>
        {meta && <span className='panel-meta'>{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function TopPlugins({ plugins }) {
  if (!plugins.length) {
    return <p className='panel-empty'>No plugins yet.</p>;
  }

  const top = plugins.slice(0, TOP_PLUGINS_LIMIT);
  const max = Math.max(...top.map((p) => p.recent), 1);

  return (
    <ul className='rank-list'>
      {top.map((plugin) => {
        const votes = plugin.votesUp + plugin.votesDown;
        const rating = votes ? `${Math.round((plugin.votesUp / votes) * 100)}% positive` : 'Unrated';
        return (
          <li>
            <a href={`/plugin/${plugin.id}`}>
              <img src={`/plugin-icon/${plugin.id}`} alt='' loading='lazy' />
              <div className='rank-main'>
                <div className='rank-title'>
                  <strong>{plugin.name}</strong>
                  {plugin.price > 0 && <span className='pill pill--paid'>Paid</span>}
                  {STATUS_LABELS[plugin.status] && (
                    <span className={`pill pill--${STATUS_LABELS[plugin.status].toLowerCase()}`}>{STATUS_LABELS[plugin.status]}</span>
                  )}
                </div>
                <div className='rank-bar'>
                  <span style={{ width: `${(plugin.recent / max) * 100}%` }} />
                </div>
                <small className='rank-sub'>
                  {formatExactNumber(plugin.downloads)} total · {rating}
                </small>
              </div>
              <div className='rank-value'>
                <strong>{formatExactNumber(plugin.recent)}</strong>
                <small>30d</small>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Payout({ unpaid }) {
  if (!unpaid) {
    return <p className='panel-empty'>Unpaid balance unavailable.</p>;
  }

  const threshold = Number(unpaid.threshold) || 0;
  const earnings = Number(unpaid.earnings) || 0;
  const progress = threshold ? Math.min(100, (earnings / threshold) * 100) : 0;
  const from = moment(unpaid.from);
  const to = moment(unpaid.to);
  const period = from.isValid() && to.isValid() ? `${from.format('MMM YYYY')} – ${to.format('MMM YYYY')}` : '';

  return (
    <div className='payout-balance'>
      <div className='payout-amount'>{formatExactNumber(earnings, { currency: true })}</div>
      <div className='payout-caption'>Unpaid balance{period && ` · ${period}`}</div>
      <div
        className='progress'
        role='progressbar'
        aria-label='Progress to payout threshold'
        attr-aria-valuemin='0'
        attr-aria-valuemax='100'
        attr-aria-valuenow={String(Math.round(progress))}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className='payout-caption'>
        {progress >= 100
          ? 'Threshold reached, payout is on its way'
          : `${Math.round(progress)}% of ${formatExactNumber(threshold, { currency: true })} threshold`}
      </div>
    </div>
  );
}

function EmptyState({ isSelf }) {
  return (
    <div className='panel span-2 dash-empty'>
      <span className='icon extension' />
      <h3>{isSelf ? 'Publish your first plugin' : 'No published plugins'}</h3>
      <p>Earn from paid plugins and from every download of your free plugins. Stats and charts show up here once you publish.</p>
      {isSelf && (
        <div className='dash-empty-actions'>
          <a className='action action--primary' href='/publish'>
            <span className='icon publish' />
            Publish plugin
          </a>
          <a className='action' href='https://docs.acode.app' target='_blank' rel='noopener'>
            Read the docs
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} stats
 * @param {HTMLCanvasElement} downloadsCanvas
 * @param {HTMLCanvasElement} earningsCanvas
 * @param {ReturnType<typeof createChartLifecycle>} lifecycle
 */
async function renderCharts(stats, downloadsCanvas, earningsCanvas, lifecycle) {
  const showFallback = (canvas) => canvas.parentElement?.replaceChildren(<div className='chart-error'>Chart unavailable</div>);

  let Chart;
  try {
    ({ default: Chart } = await import('chart.js/auto'));
  } catch (error) {
    console.error('Failed to load charts', error);
    showFallback(downloadsCanvas);
    showFallback(earningsCanvas);
    return;
  }

  // The user may have left the profile while the chart chunk was loading.
  if (lifecycle.disposed) return;
  Chart.defaults.font.family = "'Instrument Sans', 'Montserrat', sans-serif";

  const render = (canvas, config) =>
    createChartSafely({
      createChart: () => new Chart(canvas, config),
      onError: (error) => {
        console.error('Failed to render chart', error);
        showFallback(canvas);
      },
    });

  lifecycle.track(render(downloadsCanvas, downloadsChartConfig(stats.daily)));
  lifecycle.track(render(earningsCanvas, earningsChartConfig(stats.monthly)));
}

function downloadsChartConfig(daily) {
  return {
    type: 'line',
    data: {
      labels: daily.map((d) => moment(d.date).format('D MMM')),
      datasets: [
        {
          label: 'Downloads',
          data: daily.map((d) => d.count),
          borderColor: DOWNLOADS_COLOR,
          borderWidth: 2,
          tension: 0.35,
          fill: true,
          backgroundColor: ({ chart }) => verticalGradient(chart, 'rgba(52, 153, 254, 0.28)', 'rgba(52, 153, 254, 0)'),
          pointRadius: 0,
          pointHitRadius: 12,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: DOWNLOADS_COLOR,
          pointHoverBorderColor: '#12141a',
          pointHoverBorderWidth: 2,
        },
      ],
    },
    options: baseOptions({
      tooltipTitle: (items) => moment(daily[items[0].dataIndex].date).format('ddd, D MMM YYYY'),
      tooltipLabel: (ctx) => `${formatExactNumber(ctx.raw)} downloads`,
      yTick: (value) => formatCompactNumber(value),
    }),
    plugins: [{ id: 'crosshair', afterDatasetsDraw: (chart) => drawCrosshair(chart) }],
  };
}

function earningsChartConfig(monthly) {
  return {
    type: 'bar',
    data: {
      labels: monthly.map((m) => moment({ year: m.year, month: m.month }).format('MMM')),
      datasets: [
        {
          label: 'Earnings',
          data: monthly.map((m) => m.amount),
          backgroundColor: monthly.map((m) => (m.estimated ? 'rgba(34, 197, 94, 0.35)' : EARNINGS_COLOR)),
          hoverBackgroundColor: monthly.map((m) => (m.estimated ? 'rgba(34, 197, 94, 0.5)' : '#4ade80')),
          borderRadius: 4,
          maxBarThickness: 22,
        },
      ],
    },
    options: baseOptions({
      tooltipTitle: (items) => {
        const m = monthly[items[0].dataIndex];
        return moment({ year: m.year, month: m.month }).format('MMMM YYYY');
      },
      tooltipLabel: (ctx) => {
        const m = monthly[ctx.dataIndex];
        let note = m.paid ? ' · paid' : '';
        if (m.estimated) note = ' (estimated)';
        return `${formatExactNumber(ctx.raw, { currency: true })}${note}`;
      },
      yTick: (value) => formatCompactNumber(value, { currency: true }),
      gridX: false,
    }),
  };
}

function baseOptions({ tooltipTitle, tooltipLabel, yTick, gridX = false }) {
  const tick = { color: 'rgba(241, 242, 244, 0.45)', font: { size: 11 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 100,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c1f27',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
        displayColors: false,
        titleColor: 'rgba(241, 242, 244, 0.64)',
        titleFont: { size: 11, weight: '500' },
        bodyColor: '#f1f2f4',
        bodyFont: { size: 13, weight: '600' },
        callbacks: { title: tooltipTitle, label: tooltipLabel },
      },
    },
    scales: {
      x: {
        ticks: { ...tick, maxTicksLimit: 7, autoSkip: true, maxRotation: 0 },
        grid: { display: gridX },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { ...tick, maxTicksLimit: 5, precision: 0, callback: yTick },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        border: { display: false },
      },
    },
  };
}

function verticalGradient(chart, from, to) {
  const { ctx, chartArea } = chart;
  if (!chartArea) return 'transparent';
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  return gradient;
}
