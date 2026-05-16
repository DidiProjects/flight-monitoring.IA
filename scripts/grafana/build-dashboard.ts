import * as fs from 'fs';
import * as path from 'path';
import * as dashboard from '@grafana/grafana-foundation-sdk/dashboard';
import * as common from '@grafana/grafana-foundation-sdk/common';
import * as timeseries from '@grafana/grafana-foundation-sdk/timeseries';
import * as logs from '@grafana/grafana-foundation-sdk/logs';
import * as loki from '@grafana/grafana-foundation-sdk/loki';

// ---------------------------------------------------------------------------
// Layout — 24 colunas Grafana
// Logs ocupa 70% (w=17), gráfico ocupa 30% (w=7)
// ---------------------------------------------------------------------------

const LOG_W  = 17;
const LOG_H  = 24;
const CHART_W = 7;
const CHART_H = 12; // metade da altura → dois gráficos empilhados

const LOKI_DS: dashboard.DataSourceRef = { type: 'loki', uid: '${DS_LOKI}' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lokiQuery(expr: string, refId: string, legendFormat = '') {
  return new loki.DataqueryBuilder()
    .expr(expr)
    .legendFormat(legendFormat)
    .range(true)
    .refId(refId);
}

function logsPanel(title: string, expr: string, x: number, y: number, w: number, h: number) {
  return new logs.PanelBuilder()
    .title(title)
    .datasource(LOKI_DS)
    .gridPos({ x, y, w, h })
    .withTarget(lokiQuery(expr, 'A'))
    .sortOrder(common.LogsSortOrder.Descending)
    .enableLogDetails(true)
    .prettifyLogMessage(true)
    .showTime(true)
    .wrapLogMessage(false)
    .dedupStrategy(common.LogsDedupStrategy.None);
}

function curvePanel(
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
    .drawStyle(common.GraphDrawStyle.Line)
    .lineInterpolation(common.LineInterpolation.Smooth)
    .lineWidth(2)
    .fillOpacity(10)
    .showPoints(common.VisibilityMode.Never)
    .spanNulls(false)
    .axisLabel('acumulado')
    .stacking(new common.StackingConfigBuilder().mode(common.StackingMode.None).group('A'))
    .legend(
      new common.VizLegendOptionsBuilder()
        .displayMode(common.LegendDisplayMode.List)
        .placement(common.LegendPlacement.Bottom)
        .showLegend(true)
        .calcs(['last', 'max']),
    )
    .tooltip(
      new common.VizTooltipOptionsBuilder()
        .mode(common.TooltipDisplayMode.Multi)
        .sort(common.SortOrder.Descending),
    )
    .withTransformation({
      id: 'calculateField',
      options: {
        mode: 'cumulativeFunctions',
        cumulative: { field: '' },
        replaceFields: true,
      },
    });

  for (const q of queries) {
    builder = builder.withTarget(lokiQuery(q.expr, q.refId, q.legendFormat));
  }

  if (overridesFn) builder = overridesFn(builder);
  return builder;
}

// ---------------------------------------------------------------------------
// Expressões LogQL
// ---------------------------------------------------------------------------

// pino envia level como string no label Loki ("error","warning") via pino-loki.
// Caso o label não esteja disponível, o fallback é filtrar via JSON body pelo valor numérico.
const SCRAPING_ERRORS = `sum by (airline) (count_over_time({app="scraping-api", level="error"} | json | airline != "" [$__interval]))`;

// Warnings: sem filtro de airline — logs como "navigation attempt failed" não têm o campo.
// Séries sem airline aparecerão com label vazio (warnings internos/sem contexto de rota).
const SCRAPING_WARNS  = `sum by (airline) (count_over_time({app="scraping-api", level="warning"} | json [$__interval]))`;

const API_ERRORS_WARNS = `sum by (level) (count_over_time({app="flight-api", level=~"error|warning"} [$__interval]))`;

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// Posições Y
const SCRAPING_Y = 1;       // início da seção scraping (row em y=0)
const API_ROW_Y  = SCRAPING_Y + LOG_H + 1; // row da seção flight.API
const API_Y      = API_ROW_Y + 1;

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
        { selected: true,  text: 'Todos', value: '.*'    },
        { selected: false, text: 'error', value: 'error' },
        { selected: false, text: 'warning',  value: 'warning'  },
        { selected: false, text: 'info',  value: 'info'  },
        { selected: false, text: 'debug', value: 'debug' },
      ]),
  )
  .withVariable(
    new dashboard.CustomVariableBuilder('level_api')
      .label('Nível — flight.API')
      .values('.*,error,warning,info,debug')
      .current({ text: 'Todos', value: '.*', selected: true })
      .options([
        { selected: true,  text: 'Todos', value: '.*'    },
        { selected: false, text: 'error', value: 'error' },
        { selected: false, text: 'warning',  value: 'warning'  },
        { selected: false, text: 'info',  value: 'info'  },
        { selected: false, text: 'debug', value: 'debug' },
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

  // Erros por airline (painel superior direito)
  .withPanel(
    curvePanel(
      'Erros por Airline',
      'Uma curva por airline. Novas airlines surgem automaticamente.',
      [{ expr: SCRAPING_ERRORS, refId: 'A', legendFormat: '{{airline}}' }],
      LOG_W, SCRAPING_Y, CHART_W, CHART_H,
    ),
  )

  // Warnings por airline (painel inferior direito)
  .withPanel(
    curvePanel(
      'Warnings por Airline',
      '',
      [{ expr: SCRAPING_WARNS, refId: 'A', legendFormat: '{{airline}}' }],
      LOG_W, SCRAPING_Y + CHART_H, CHART_W, CHART_H,
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

  // Erros + Warnings em duas curvas (painel direito)
  .withPanel(
    curvePanel(
      'Erros & Warnings',
      '',
      [{ expr: API_ERRORS_WARNS, refId: 'A', legendFormat: '{{level}}' }],
      LOG_W, API_Y, CHART_W, LOG_H,
      (b) => b
        .overrideByName('warning',  [{ id: 'color', value: { fixedColor: '#FF9900', mode: 'fixed' } }])
        .overrideByName('error', [{ id: 'color', value: { fixedColor: '#E02F44', mode: 'fixed' } }]),
    ),
  )

  .build();

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

const outputPath = path.resolve(__dirname, '../../grafana-flight-monitoring.json');
fs.writeFileSync(outputPath, JSON.stringify(dash, null, 2));
console.log(`Dashboard gerado: ${outputPath}`);
