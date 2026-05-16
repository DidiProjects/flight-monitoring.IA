import * as fs from 'fs';
import * as path from 'path';
import * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';
import * as common from '@grafana/grafana-foundation-sdk/common';
import * as timeseries from '@grafana/grafana-foundation-sdk/timeseries';
import * as logs from '@grafana/grafana-foundation-sdk/logs';
import * as loki from '@grafana/grafana-foundation-sdk/loki';
import * as stat from '@grafana/grafana-foundation-sdk/stat';

// ---------------------------------------------------------------------------
// Layout — 24 colunas Grafana
// Logs ocupa 70% (w=17), controles ocupam 30% (w=7)
// Direita: stat (h=6) + duas barras de h=9 para scraping (6+9+9=24)
//          stat (h=6) + uma barra de h=18 para flight.API  (6+18=24)
// ---------------------------------------------------------------------------

const LOG_W       = 17;
const LOG_H       = 24;
const CHART_W     = 7;
const STAT_H      = 6;
const BAR_H_HALF  = 9;   // dois gráficos de barra (scraping)
const BAR_H_FULL  = 18;  // um gráfico de barra    (flight.api)

const LOKI_DS: dashboard.DataSourceRef = { type: 'loki', uid: '${DS_LOKI}' };

// ---------------------------------------------------------------------------
// Helpers de query
// ---------------------------------------------------------------------------

function lokiRange(expr: string, refId: string, legendFormat = '') {
  return new loki.DataqueryBuilder()
    .expr(expr)
    .legendFormat(legendFormat)
    .range(true)
    .refId(refId);
}

function lokiInstant(expr: string, refId: string, legendFormat = '') {
  return new loki.DataqueryBuilder()
    .expr(expr)
    .legendFormat(legendFormat)
    .instant(true)
    .refId(refId);
}

// ---------------------------------------------------------------------------
// Helpers de painel
// ---------------------------------------------------------------------------

function logsPanel(title: string, expr: string, x: number, y: number, w: number, h: number) {
  return new logs.PanelBuilder()
    .title(title)
    .datasource(LOKI_DS)
    .gridPos({ x, y, w, h })
    .withTarget(lokiRange(expr, 'A'))
    .sortOrder(common.LogsSortOrder.Descending)
    .enableLogDetails(true)
    .prettifyLogMessage(true)
    .showTime(true)
    .wrapLogMessage(false)
    .dedupStrategy(common.LogsDedupStrategy.None);
}

function totalStatPanel(
  title: string,
  expr: string,
  legendFormat: string,
  x: number, y: number, w: number, h: number,
  overridesFn?: (b: stat.PanelBuilder) => stat.PanelBuilder,
) {
  let builder = new stat.PanelBuilder()
    .title(title)
    .datasource(LOKI_DS)
    .gridPos({ x, y, w, h })
    .withTarget(lokiInstant(expr, 'A', legendFormat))
    .colorMode(common.BigValueColorMode.Background)
    .graphMode(common.BigValueGraphMode.None)
    .textMode(common.BigValueTextMode.ValueAndName)
    .orientation(common.VizOrientation.Horizontal)
    .noValue('0')
    .reduceOptions(
      new common.ReduceDataOptionsBuilder().calcs(['last']).values(false),
    );

  if (overridesFn) builder = overridesFn(builder);
  return builder;
}

function barPanel(
  title: string,
  description: string,
  queries: { expr: string; refId: string; legendFormat: string }[],
  x: number,
  y: number,
  w: number,
  h: number,
  overridesFn?: (b: timeseries.PanelBuilder) => timeseries.PanelBuilder,
) {
  let builder = new timeseries.PanelBuilder()
    .title(title)
    .description(description)
    .datasource(LOKI_DS)
    .gridPos({ x, y, w, h })
    .drawStyle(common.GraphDrawStyle.Bars)
    .barAlignment(common.BarAlignment.Center)
    .lineWidth(0)
    .fillOpacity(70)
    .showPoints(common.VisibilityMode.Never)
    .spanNulls(false)
    .axisLabel('ocorrências')
    .stacking(new common.StackingConfigBuilder().mode(common.StackingMode.Normal).group('A'))
    .legend(
      new common.VizLegendOptionsBuilder()
        .displayMode(common.LegendDisplayMode.List)
        .placement(common.LegendPlacement.Bottom)
        .showLegend(true)
        .calcs(['sum']),
    )
    .tooltip(
      new common.VizTooltipOptionsBuilder()
        .mode(common.TooltipDisplayMode.Multi)
        .sort(common.SortOrder.Descending),
    );

  for (const q of queries) {
    builder = builder.withTarget(lokiRange(q.expr, q.refId, q.legendFormat));
  }

  if (overridesFn) builder = overridesFn(builder);
  return builder;
}

// ---------------------------------------------------------------------------
// Expressões LogQL
// ---------------------------------------------------------------------------

// Totais para stat panels (instant query com $__range = total do período selecionado)
const SCRAPING_TOTAL = `sum by (airline) (count_over_time({app="scraping-api", level=~"error|warning"} | json | airline != "" [$__range]))`;
const API_TOTAL      = `sum by (level) (count_over_time({app="flight-api", level=~"error|warning"} [$__range]))`;

// Série temporal para barras (range query com $__interval = granularidade do gráfico)
const SCRAPING_ERRORS = `sum by (airline) (count_over_time({app="scraping-api", level="error"} | json | airline != "" [$__interval]))`;
const SCRAPING_WARNS  = `sum by (airline) (count_over_time({app="scraping-api", level="warning"} | json [$__interval]))`;
const API_ERRORS_WARNS = `sum by (level) (count_over_time({app="flight-api", level=~"error|warning"} [$__interval]))`;

// ---------------------------------------------------------------------------
// Posições Y
// ---------------------------------------------------------------------------

const SCRAPING_Y = 1;
const CHART_X    = LOG_W;
const API_ROW_Y  = SCRAPING_Y + LOG_H + 1;
const API_Y      = API_ROW_Y + 1;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const dash = new dashboard.DashboardBuilder('Flight Monitoring — Observabilidade')
  .uid('flight-monitoring-logs')
  .tags(['flight-monitoring', 'logs', 'loki'])
  .refresh('30s')
  .time({ from: 'now-3h', to: 'now' })
  .timezone('America/Sao_Paulo')
  .weekStart('sunday')
  .fiscalYearStartMonth(0)
  .tooltip(dashboard.DashboardCursorSync.Off)
  .editable()
  .preload(false)

  // ── Variáveis ─────────────────────────────────────────────────────────────
  .withVariable(
    new dashboard.DatasourceVariableBuilder('DS_LOKI')
      .label('Fonte Loki')
      .type('loki'),
  )
  .withVariable(
    new dashboard.CustomVariableBuilder('level_scraping')
      .label('Nível — scraping.API')
      .values('.*,error,warning,info,debug')
      .current({ text: 'Todos', value: '.*', selected: true })
      .options([
        { selected: true,  text: 'Todos',   value: '.*'     },
        { selected: false, text: 'error',   value: 'error'  },
        { selected: false, text: 'warning', value: 'warning'},
        { selected: false, text: 'info',    value: 'info'   },
        { selected: false, text: 'debug',   value: 'debug'  },
      ]),
  )
  .withVariable(
    new dashboard.CustomVariableBuilder('level_api')
      .label('Nível — flight.API')
      .values('.*,error,warning,info,debug')
      .current({ text: 'Todos', value: '.*', selected: true })
      .options([
        { selected: true,  text: 'Todos',   value: '.*'     },
        { selected: false, text: 'error',   value: 'error'  },
        { selected: false, text: 'warning', value: 'warning'},
        { selected: false, text: 'info',    value: 'info'   },
        { selected: false, text: 'debug',   value: 'debug'  },
      ]),
  )
  .withVariable(
    new dashboard.TextBoxVariableBuilder('search')
      .label('Busca nos logs')
      .defaultValue(''),
  )

  // ── scraping.API ──────────────────────────────────────────────────────────
  .withRow(new dashboard.RowBuilder('scraping.API — Logs & Métricas'))

  .withPanel(
    logsPanel(
      'Logs — scraping.API',
      '{app="scraping-api", level=~"$level_scraping"} |= `$search` | json',
      0, SCRAPING_Y, LOG_W, LOG_H,
    ),
  )

  // Stat: total de erros+warnings por airline no período selecionado
  .withPanel(
    totalStatPanel(
      'Ocorrências no período — por airline',
      SCRAPING_TOTAL,
      '{{airline}}',
      CHART_X, SCRAPING_Y, CHART_W, STAT_H,
    ),
  )

  // Barras: erros por janela de tempo, empilhados por airline
  .withPanel(
    barPanel(
      'Erros por Airline',
      'Contagem de erros por janela de tempo, empilhada por airline.',
      [{ expr: SCRAPING_ERRORS, refId: 'A', legendFormat: '{{airline}}' }],
      CHART_X, SCRAPING_Y + STAT_H, CHART_W, BAR_H_HALF,
    ),
  )

  // Barras: warnings por janela de tempo, empilhados por airline
  .withPanel(
    barPanel(
      'Warnings por Airline',
      '',
      [{ expr: SCRAPING_WARNS, refId: 'A', legendFormat: '{{airline}}' }],
      CHART_X, SCRAPING_Y + STAT_H + BAR_H_HALF, CHART_W, BAR_H_HALF,
    ),
  )

  // ── flight.API ────────────────────────────────────────────────────────────
  .withRow(new dashboard.RowBuilder('flight.API — Logs & Métricas'))

  .withPanel(
    logsPanel(
      'Logs — flight.API',
      '{app="flight-api", level=~"$level_api"} |= `$search` | json',
      0, API_Y, LOG_W, LOG_H,
    ),
  )

  // Stat: total de erros e warnings no período (duas células: error e warning)
  .withPanel(
    totalStatPanel(
      'Ocorrências no período',
      API_TOTAL,
      '{{level}}',
      CHART_X, API_Y, CHART_W, STAT_H,
      (b) => b
        .overrideByName('warning', [{ id: 'color', value: { fixedColor: '#FF9900', mode: 'fixed' } }])
        .overrideByName('error',   [{ id: 'color', value: { fixedColor: '#E02F44', mode: 'fixed' } }]),
    ),
  )

  // Barras: erros e warnings por janela de tempo, duas séries coloridas
  .withPanel(
    barPanel(
      'Erros & Warnings',
      '',
      [{ expr: API_ERRORS_WARNS, refId: 'A', legendFormat: '{{level}}' }],
      CHART_X, API_Y + STAT_H, CHART_W, BAR_H_FULL,
      (b) => b
        .overrideByName('warning', [{ id: 'color', value: { fixedColor: '#FF9900', mode: 'fixed' } }])
        .overrideByName('error',   [{ id: 'color', value: { fixedColor: '#E02F44', mode: 'fixed' } }]),
    ),
  )

  .build();

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

const outputPath = path.resolve(__dirname, '../../grafana-flight-monitoring.json');
fs.writeFileSync(outputPath, JSON.stringify(dash, null, 2));
console.log(`Dashboard gerado: ${outputPath}`);
