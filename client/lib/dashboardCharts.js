function hasFinitePosition(element) {
  return Number.isFinite(element?.x) && Number.isFinite(element?.y);
}

export function drawDoughnutPercentLabels(chart, total) {
  const { ctx } = chart;
  const dataset = chart.data.datasets[0];
  const meta = chart.getDatasetMeta(0);

  ctx.save();
  try {
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const [index, arc] of meta.data.entries()) {
      const value = Number(dataset.data[index]);
      const isVisible = typeof chart.getDataVisibility !== 'function' || chart.getDataVisibility(index);
      if (!Number.isFinite(value) || value === 0 || !isVisible || arc?.hidden || typeof arc?.tooltipPosition !== 'function') continue;

      const position = arc.tooltipPosition(true);
      if (!hasFinitePosition(position)) continue;

      const percentage = Math.round((value / total) * 100);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 3;
      ctx.fillText(`${percentage}%`, position.x, position.y);
      ctx.shadowBlur = 0;
    }
  } finally {
    ctx.restore();
  }
}

export function drawBarValueLabels(chart, formatValue) {
  const { ctx } = chart;

  ctx.save();
  try {
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 2;

    for (const [datasetIndex, dataset] of chart.data.datasets.entries()) {
      const meta = chart.getDatasetMeta(datasetIndex);
      const isVisible = typeof chart.isDatasetVisible !== 'function' || chart.isDatasetVisible(datasetIndex);
      if (!isVisible || meta.hidden) continue;

      for (const [index, bar] of meta.data.entries()) {
        const value = Number(dataset.data[index]);
        if (!Number.isFinite(value) || value === 0 || bar?.hidden || !hasFinitePosition(bar)) continue;
        ctx.fillText(formatValue(value), bar.x, bar.y - 2);
      }
    }

    ctx.shadowBlur = 0;
  } finally {
    ctx.restore();
  }
}

export function createChartSafely({ createChart, previousChart, onError }) {
  try {
    previousChart?.destroy();
    return createChart();
  } catch (error) {
    onError(error);
    return null;
  }
}
