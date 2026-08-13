import { createChartSafely, drawBarValueLabels, drawDoughnutPercentLabels } from '../../client/lib/dashboardCharts';

function createContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
  };
}

function createArc(x, y, options = {}) {
  return {
    hidden: false,
    tooltipPosition: vi.fn(() => ({ x, y })),
    ...options,
  };
}

describe('dashboard chart labels', () => {
  it('draws percentage labels for complete doughnut metadata', () => {
    const ctx = createContext();
    const chart = {
      ctx,
      data: { datasets: [{ data: [25, 75] }] },
      getDatasetMeta: () => ({ data: [createArc(10, 20), createArc(30, 40)] }),
      getDataVisibility: () => true,
    };

    drawDoughnutPercentLabels(chart, 100);

    expect(ctx.fillText).toHaveBeenNthCalledWith(1, '25%', 10, 20);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, '75%', 30, 40);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('ignores missing, hidden, zero, and non-finite doughnut elements', () => {
    const ctx = createContext();
    const chart = {
      ctx,
      data: { datasets: [{ data: [20, 30, 0, Number.NaN, 50] }] },
      getDatasetMeta: () => ({
        data: [createArc(10, 20), undefined, createArc(30, 40), createArc(50, 60), createArc(70, 80, { hidden: true })],
      }),
      getDataVisibility: () => true,
    };

    expect(() => drawDoughnutPercentLabels(chart, 100)).not.toThrow();
    expect(ctx.fillText).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalledWith('20%', 10, 20);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('handles empty rendered metadata without drawing labels', () => {
    const doughnutContext = createContext();
    const barContext = createContext();

    expect(() =>
      drawDoughnutPercentLabels(
        {
          ctx: doughnutContext,
          data: { datasets: [{ data: [] }] },
          getDatasetMeta: () => ({ data: [] }),
        },
        1,
      ),
    ).not.toThrow();
    expect(() =>
      drawBarValueLabels(
        {
          ctx: barContext,
          data: { datasets: [] },
          getDatasetMeta: () => ({ data: [], hidden: false }),
        },
        String,
      ),
    ).not.toThrow();

    expect(doughnutContext.fillText).not.toHaveBeenCalled();
    expect(barContext.fillText).not.toHaveBeenCalled();
    expect(doughnutContext.restore).toHaveBeenCalledOnce();
    expect(barContext.restore).toHaveBeenCalledOnce();
  });

  it('handles empty and partially materialized bar metadata', () => {
    const ctx = createContext();
    const chart = {
      ctx,
      data: {
        datasets: [{ data: [1_000, 2_000] }, { data: [3_000] }],
      },
      getDatasetMeta: (index) => (index === 0 ? { data: [{ x: 12, y: 24 }], hidden: false } : { data: [], hidden: false }),
      isDatasetVisible: () => true,
    };

    expect(() => drawBarValueLabels(chart, (value) => `${value / 1_000}K`)).not.toThrow();
    expect(ctx.fillText).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalledWith('1K', 12, 22);
    expect(ctx.restore).toHaveBeenCalledOnce();
  });

  it('always restores canvas state when element positioning fails', () => {
    const ctx = createContext();
    const chart = {
      ctx,
      data: { datasets: [{ data: [100] }] },
      getDatasetMeta: () => ({
        data: [
          createArc(0, 0, {
            tooltipPosition: () => {
              throw new Error('position failed');
            },
          }),
        ],
      }),
      getDataVisibility: () => true,
    };

    expect(() => drawDoughnutPercentLabels(chart, 100)).toThrow('position failed');
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});

describe('dashboard chart initialization', () => {
  it('contains one chart failure so another chart can still initialize', () => {
    const onError = vi.fn();
    const error = new Error('chart failed');

    const failedChart = createChartSafely({
      createChart: () => {
        throw error;
      },
      onError,
    });
    const workingChart = { id: 'working-chart' };
    const initializedChart = createChartSafely({
      createChart: () => workingChart,
      onError,
    });

    expect(failedChart).toBeNull();
    expect(initializedChart).toBe(workingChart);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
