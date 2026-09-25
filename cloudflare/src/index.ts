import { calculateAnalytics, calculateRiskMetrics, calculateRebalanceOpportunities, getVersionInfo, initializeDCAConfig, calculateNextDCAExecution, shouldExecuteDCA, decideDCABuyAI, type Analytics, type RiskMetrics, type RebalanceOpportunity, type VersionInfo, type DCAConfig, type DCASchedule, type DCADecision } from './features';

export interface Env {
  CRYPTO_BOT_STATE: KVNamespace;
  ENVIRONMENT: string;
  GROQ_MODEL: string;
  RUNNER_TOKEN?: string;
  APP_CONTROL_TOKEN?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPOSITORY: string;
  GITHUB_WORKFLOW: string;
  WHATSAPP_ENABLED?: string;
  WHATSAPP_PROVIDER?: string;
  WHATSAPP_TO?: string;
  WHATSAPP_META_PHONE_NUMBER_ID?: string;
  WHATSAPP_META_TOKEN?: string;
  WHATSAPP_GATEWAY_URL?: string;
  WHATSAPP_GATEWAY_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

type LogItem = { ts?: string; event?: string; data?: Record<string, any> };
type Report = { ts: string; status: string; cycle: number | null; returncode: number | null; duration_seconds: number | null; summary: Record<string, any>; logs?: LogItem[] };
type DesiredState = 'running' | 'paused' | 'stopped';
type ExecutionMode = 'semi' | 'auto';
type Param = { key: string; value: number; min: number; max: number; step: number; label: string; description: string };
type PortfolioPoint = { ts: string; value_usd: number };
type MovementItem = {
  id: string;
  ts: string;
  symbol: string;
  side: string;
  description: string;
  amount: string;
  amount_currency: string;
  to_amount: string;
  to_currency: string;
  value_usd: string;
  status: string;
  confidence: number;
  origin: string;
  reason: string;
  pnl_usd: number;
  pnl_pct: number;
  friccion_usd?: number | null;
  pnl_known: boolean;
};
type AllocationMap = Record<string, number>;
type ConditionalOrder = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  trigger_price_usd: number;
  current_price_usd?: number;
  amount_usdc?: number;
  value_usd?: number;
  estimated_pnl_usd?: number;
  estimated_pnl_pct?: number;
  estimated_outcome?: 'gain' | 'loss' | 'neutral';
  estimated_pnl_basis?: 'avg_cost' | 'current_price';
  avg_cost_usd?: number | null;
  status: 'active' | 'paused' | 'executed' | 'cancelled';
  note?: string;
  created_at: string;
  updated_at: string;
  executed_at?: string | null;
  execution_order_id?: string | null;
};
type ForecastPlan = {
  symbol: string;
  side: 'BUY' | 'SELL';
  trigger_price_usd: number;
  current_price_usd: number;
  amount_usdc?: number;
  value_usd?: number;
  estimated_pnl_usd: number;
  estimated_pnl_pct: number;
  estimated_outcome: 'gain' | 'loss' | 'neutral';
  estimated_pnl_basis?: 'avg_cost' | 'current_price';
  avg_cost_usd?: number | null;
  confidence: number;
  reason: string;
  status: 'watching';
  executable: false;
  target_pct: number;
  current_pct: number;
  preserve_min_pct: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const DEFAULT_PARAMS: Param[] = [
  { key: 'MAX_TRADE_USDC', value: 8, min: 5, max: 25, step: 0.5, label: 'Máximo por compra', description: 'Tope en USDC por compra automática. Evita micro-operaciones que el spread se come.' },
  { key: 'MIN_TRADE_USDC', value: 5, min: 3, max: 15, step: 0.5, label: 'Mínimo por compra', description: 'Compra mínima para que spread/comisión no dominen la operación.' },
  { key: 'MAX_SELL_NATIVE_USD', value: 8, min: 5, max: 25, step: 0.5, label: 'Máximo por venta', description: 'Tope aproximado en USD por venta automática.' },
  { key: 'MIN_SELL_NATIVE_USD', value: 5, min: 3, max: 15, step: 0.5, label: 'Mínimo por venta', description: 'Venta mínima para evitar que spread/comisión se coma la ganancia.' },
  { key: 'CRYPTO_COM_MIN_SELL_NATIVE_USD', value: 5, min: 3, max: 15, step: 0.5, label: 'Mínimo venta Crypto.com', description: 'Piso específico para cotizaciones de venta en Crypto.com.' },
  { key: 'MIN_CONFIDENCE', value: 0.76, min: 0.5, max: 0.9, step: 0.01, label: 'Confianza mínima compra', description: 'Exige más evidencia antes de comprar.' },
  { key: 'MIN_SELL_CONFIDENCE', value: 0.70, min: 0.5, max: 0.9, step: 0.01, label: 'Confianza mínima venta', description: 'Exige señal bajista suficiente antes de vender.' },
  { key: 'MAX_TRADES_PER_DAY', value: 4, min: 1, max: 80, step: 1, label: 'Operaciones por día', description: 'Límite diario para evitar sobreoperar.' },
  { key: 'MAX_TRADES_PER_CYCLE', value: 1, min: 1, max: 3, step: 1, label: 'Operaciones por ciclo', description: 'Límite de órdenes en cada ciclo remoto.' },
  { key: 'BASE_RESERVE_RATIO', value: 0.45, min: 0.05, max: 0.6, step: 0.01, label: 'Reserva USDC', description: 'Porcentaje que se intenta conservar líquido.' },
  { key: 'MAX_ASSET_WEIGHT', value: 0.18, min: 0.1, max: 0.5, step: 0.01, label: 'Peso máximo activo', description: 'Evita concentrarse demasiado en un activo.' },
  { key: 'STOP_LOSS_PCT', value: 0.04, min: 0.02, max: 0.2, step: 0.01, label: 'Stop loss técnico', description: 'Pérdida porcentual que activa defensa.' },
  { key: 'MIN_PROFIT_TO_SELL_PCT', value: 0.04, min: 0.02, max: 0.2, step: 0.005, label: 'Ganancia mínima venta', description: 'Margen mínimo antes de vender con ganancia; cubre spread/comisión estimada.' },
  { key: 'ESTIMATED_ROUNDTRIP_COST_PCT', value: 0.025, min: 0.005, max: 0.08, step: 0.005, label: 'Costo ida/vuelta estimado', description: 'Estimación interna de spread/costos para evitar señales sin margen.' },
  { key: 'COOLDOWN_AFTER_TRADE_SECONDS', value: 3600, min: 60, max: 7200, step: 60, label: 'Pausa tras operar', description: 'Tiempo mínimo entre operaciones.' },
  { key: 'PER_ASSET_COOLDOWN_SECONDS', value: 14400, min: 60, max: 14400, step: 60, label: 'Pausa por activo', description: 'Evita repetir en el mismo activo demasiado rápido.' },
  { key: 'REVERSAL_COOLDOWN_SECONDS', value: 28800, min: 900, max: 21600, step: 300, label: 'Pausa por reversa', description: 'Bloquea comprar justo después de vender el mismo activo, o vender justo después de comprarlo.' },
  { key: 'SUPERVISOR_EVERY_CYCLES', value: 1, min: 1, max: 12, step: 1, label: 'Frecuencia supervisor', description: 'Cada cuántos ciclos se ejecuta el supervisor.' },
  { key: 'GROQ_TIMEOUT_SECONDS', value: 60, min: 20, max: 120, step: 5, label: 'Timeout Groq', description: 'Tiempo máximo para respuesta IA Groq.' },
  { key: 'GROQ_MAX_COMPLETION_TOKENS', value: 350, min: 150, max: 1000, step: 50, label: 'Tokens Groq', description: 'Presupuesto de respuesta para razonamiento IA.' },
  { key: 'ADAPTIVE_HALT_LOSS_USD', value: 5, min: 1, max: 20, step: 0.5, label: 'Hold por pérdida USD', description: 'Si la pérdida viva llega a este monto, pausa compras y prioriza recuperación.' },
  { key: 'ADAPTIVE_RESUME_LOSS_USD', value: 0.25, min: 0, max: 5, step: 0.25, label: 'Reanudar pérdida USD', description: 'Reanuda cuando la pérdida se reduce bajo este umbral.' },
  { key: 'SELL_FRACTION', value: 0.25, min: 0.1, max: 1, step: 0.05, label: 'Fracción de venta', description: 'Parte de la posición que puede liquidarse por señal.' },
  { key: 'DUST_SWEEP_TO_USDC', value: 0, min: 0, max: 1, step: 1, label: 'Polvo a USDC', description: '0 apagado, 1 activo. Convierte saldos mínimos a USDC cuando Crypto.com lo permite.' },
  { key: 'DUST_MAX_VALUE_USD', value: 1, min: 0.1, max: 5, step: 0.1, label: 'Máximo polvo USD', description: 'Valor máximo por activo considerado polvo para barrido.' },
  { key: 'DUST_MIN_VALUE_USD', value: 0.05, min: 0.01, max: 2, step: 0.01, label: 'Mínimo polvo USD', description: 'Ignora residuos demasiado pequeños para evitar rechazos inútiles.' },
  { key: 'DUST_SWEEP_INTERVAL_HOURS', value: 24, min: 1, max: 168, step: 1, label: 'Intervalo polvo', description: 'Horas mínimas entre intentos de barrido por activo.' },
  { key: 'RECOVERY_SELLS_DURING_HALT', value: 1, min: 0, max: 1, step: 1, label: 'Ventas en recuperación', description: '1 permite ventas defensivas/rebalanceo aun con freno por pérdida; 0 hace HOLD total.' },
];
const PARAM_MAP = new Map(DEFAULT_PARAMS.map((p) => [p.key, p]));

const CONFIG_PRESETS: Array<{key: string; label: string; description: string; values: Record<string, number>}> = [
  { key: 'proteccion', label: 'Protección', description: 'Modo recomendado para cartera pequeña: mínima frecuencia, más reserva USDC y anti-churn fuerte.', values: { MAX_TRADE_USDC: 8, MIN_TRADE_USDC: 5, MAX_SELL_NATIVE_USD: 8, MIN_SELL_NATIVE_USD: 5, CRYPTO_COM_MIN_SELL_NATIVE_USD: 5, MIN_CONFIDENCE: 0.78, MIN_SELL_CONFIDENCE: 0.70, MAX_TRADES_PER_DAY: 4, MAX_TRADES_PER_CYCLE: 1, BASE_RESERVE_RATIO: 0.45, MAX_ASSET_WEIGHT: 0.18, STOP_LOSS_PCT: 0.04, MIN_PROFIT_TO_SELL_PCT: 0.04, ESTIMATED_ROUNDTRIP_COST_PCT: 0.025, COOLDOWN_AFTER_TRADE_SECONDS: 3600, PER_ASSET_COOLDOWN_SECONDS: 14400, REVERSAL_COOLDOWN_SECONDS: 28800, ADAPTIVE_HALT_LOSS_USD: 3, ADAPTIVE_RESUME_LOSS_USD: 0.25, SELL_FRACTION: 0.25, DUST_SWEEP_TO_USDC: 0, DUST_MAX_VALUE_USD: 1, DUST_MIN_VALUE_USD: 0.05, DUST_SWEEP_INTERVAL_HOURS: 24, RECOVERY_SELLS_DURING_HALT: 1 } },
  { key: 'conservador', label: 'Conservador', description: 'Menos operaciones, más confianza, más reserva y protección de pérdida.', values: { MAX_TRADE_USDC: 8, MIN_TRADE_USDC: 5, MAX_SELL_NATIVE_USD: 8, MIN_SELL_NATIVE_USD: 5, CRYPTO_COM_MIN_SELL_NATIVE_USD: 5, MIN_CONFIDENCE: 0.76, MIN_SELL_CONFIDENCE: 0.68, MAX_TRADES_PER_DAY: 10, BASE_RESERVE_RATIO: 0.35, MAX_ASSET_WEIGHT: 0.2, STOP_LOSS_PCT: 0.045, MIN_PROFIT_TO_SELL_PCT: 0.035, ESTIMATED_ROUNDTRIP_COST_PCT: 0.025, COOLDOWN_AFTER_TRADE_SECONDS: 900, PER_ASSET_COOLDOWN_SECONDS: 7200, REVERSAL_COOLDOWN_SECONDS: 14400, ADAPTIVE_HALT_LOSS_USD: 5, ADAPTIVE_RESUME_LOSS_USD: 0.25, SELL_FRACTION: 0.35, DUST_SWEEP_TO_USDC: 0, DUST_MAX_VALUE_USD: 1, DUST_MIN_VALUE_USD: 0.05, DUST_SWEEP_INTERVAL_HOURS: 24, RECOVERY_SELLS_DURING_HALT: 1 } },
  { key: 'balanceado', label: 'Balanceado', description: 'Configuración recomendada para operar real con control moderado.', values: { MAX_TRADE_USDC: 10, MIN_TRADE_USDC: 5, MAX_SELL_NATIVE_USD: 10, MIN_SELL_NATIVE_USD: 5, CRYPTO_COM_MIN_SELL_NATIVE_USD: 5, MIN_CONFIDENCE: 0.72, MIN_SELL_CONFIDENCE: 0.62, MAX_TRADES_PER_DAY: 24, BASE_RESERVE_RATIO: 0.22, MAX_ASSET_WEIGHT: 0.25, STOP_LOSS_PCT: 0.06, MIN_PROFIT_TO_SELL_PCT: 0.03, ESTIMATED_ROUNDTRIP_COST_PCT: 0.02, COOLDOWN_AFTER_TRADE_SECONDS: 300, PER_ASSET_COOLDOWN_SECONDS: 3600, REVERSAL_COOLDOWN_SECONDS: 7200, ADAPTIVE_HALT_LOSS_USD: 5, ADAPTIVE_RESUME_LOSS_USD: 0.25, SELL_FRACTION: 0.5, DUST_SWEEP_TO_USDC: 0, DUST_MAX_VALUE_USD: 1.5, DUST_MIN_VALUE_USD: 0.05, DUST_SWEEP_INTERVAL_HOURS: 24, RECOVERY_SELLS_DURING_HALT: 1 } },
  { key: 'agresivo_controlado', label: 'Agresivo controlado', description: 'Más frecuencia y menor reserva, manteniendo límites duros de riesgo.', values: { MAX_TRADE_USDC: 12, MIN_TRADE_USDC: 5, MAX_SELL_NATIVE_USD: 12, MIN_SELL_NATIVE_USD: 5, CRYPTO_COM_MIN_SELL_NATIVE_USD: 5, MIN_CONFIDENCE: 0.68, MIN_SELL_CONFIDENCE: 0.58, MAX_TRADES_PER_DAY: 40, BASE_RESERVE_RATIO: 0.12, MAX_ASSET_WEIGHT: 0.32, STOP_LOSS_PCT: 0.08, MIN_PROFIT_TO_SELL_PCT: 0.025, ESTIMATED_ROUNDTRIP_COST_PCT: 0.02, COOLDOWN_AFTER_TRADE_SECONDS: 180, PER_ASSET_COOLDOWN_SECONDS: 1800, REVERSAL_COOLDOWN_SECONDS: 3600, ADAPTIVE_HALT_LOSS_USD: 5, ADAPTIVE_RESUME_LOSS_USD: 0.25, SELL_FRACTION: 0.65, DUST_SWEEP_TO_USDC: 0, DUST_MAX_VALUE_USD: 2, DUST_MIN_VALUE_USD: 0.05, DUST_SWEEP_INTERVAL_HOURS: 24, RECOVERY_SELLS_DURING_HALT: 1 } },
];
const CULIACAN_TZ = 'America/Mazatlan';
function tradingDayKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CULIACAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function secondsSinceTradingMidnight(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: CULIACAN_TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return n('hour') * 3600 + n('minute') * 60 + n('second');
}
// Debe coincidir con el cron de wrangler.toml: si el worker espera reportes cada
// 300s pero el cron dispara cada 600s, el runner aparece LATE de forma permanente.
const CICLO_SEGUNDOS = 600;

function dailyCycle(date = new Date(), interval = CICLO_SEGUNDOS): number { return Math.floor(secondsSinceTradingMidnight(date) / interval) + 1; }


function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function runnerAuthorized(request: Request, env: Env): boolean { const token = env.RUNNER_TOKEN || ''; return Boolean(token) && request.headers.get('Authorization') === `Bearer ${token}`; }
function appAuthorized(request: Request, env: Env): boolean {
  const token = env.APP_CONTROL_TOKEN || '';
  if (!token) return true; // Sin token = permitir
  const authHeader = request.headers.get('Authorization') || '';
  // Verificar token si existe
  return authHeader === `Bearer ${token}`;
}
function iso(value: unknown): string | null { const d = typeof value === 'string' ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; }
async function getJson<T>(env: Env, key: string, fallback: T): Promise<T> {
  const b = kvBuf(env);
  if (b && b.datos.has(key)) { const v = JSON.parse(b.datos.get(key)!); return (v as T) ?? fallback; }
  // last_report ya no tiene clave propia: viaja como evento dentro de recent_logs.
  if (key === 'last_report') {
    const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
    const ev = latest(logs, ['runner_report']);
    if (ev?.data) return ev.data as T;
  }
  const value = await env.CRYPTO_BOT_STATE.get(key, 'json');
  return (value as T) ?? fallback;
}
// Escribe solo si el valor cambio y nunca lanza: al agotarse la cuota diaria de
// KV, un throw aqui devolvia 1101 y mataba el ciclo completo del runner.
// --- Capa de escritura KV: buffer por peticion + presupuesto -----------------
// El plan gratuito permite 1.000 escrituras al dia y se agoto tres veces. Cloudflare
// cuenta OPERACIONES, no bytes: escribir la misma clave cinco veces en una peticion
// cuesta cinco. Aqui cada peticion acumula sus escrituras en memoria y al final
// escribe cada clave UNA sola vez, y solo si cambio de verdad.
type KvBuf = { datos: Map<string, string>; sucias: Set<string>; escritas: string[]; omitidas: number; fallos: number; degradadas: number };

function kvBuf(env: Env): KvBuf | null { return (env as any).__kvbuf || null; }

function conBuffer(env: Env): Env {
  const e = Object.create(env) as Env;
  (e as any).__kvbuf = { datos: new Map(), sucias: new Set(), escritas: [], omitidas: 0, fallos: 0, degradadas: 0 } as KvBuf;
  return e;
}

const KV_LIMITE_DIA = 1000;
const KV_UMBRAL = 0.7;
// Estas claves son prescindibles: si el dia va demasiado rapido se dejan de
// escribir para que las criticas (logs con el reporte, ordenes, config) sobrevivan.
const KV_OPCIONALES = new Set(['portfolio_history', 'flow_last_snapshot', 'push_seen_plans', 'last_push_aviso', 'kv_probe']);

type KvDia = { dia: string; reportes: number; escrituras: number; alertado?: boolean };

// La cuota de Cloudflare se reinicia a las 00:00 UTC, NO a medianoche de Culiacan:
// usar tradingDayKey desalineaba el contador siete horas con la ventana real.
function diaKvUtc(d = new Date()): string { return d.toISOString().slice(0, 10); }
function fraccionDiaUtc(d = new Date()): number {
  return (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 86400;
}

async function leerKvDia(env: Env): Promise<KvDia> {
  const hoy = diaKvUtc();
  const rep = await getJson<any>(env, 'last_report', null);
  const k = rep?.summary?.kv_dia;
  if (k && k.dia === hoy) return { dia: hoy, reportes: Number(k.reportes || 0), escrituras: Number(k.escrituras || 0), alertado: Boolean(k.alertado) };
  return { dia: hoy, reportes: 0, escrituras: 0, alertado: false };
}

// Proyeccion al ritmo REAL: escrituras hechas / fraccion del dia UTC transcurrida.
// Con menos de una hora de datos no se proyecta: una sola muestra (p. ej. el
// primer reporte, que inicializa varias claves) disparaba falsas alarmas.
function kvProyeccion(k: KvDia): number | null {
  const frac = fraccionDiaUtc();
  if (frac < 1 / 24 || k.reportes < 6) return null;
  return Math.round(k.escrituras / frac);
}

async function putJson(env: Env, key: string, value: unknown): Promise<boolean> {
  const next = JSON.stringify(value);
  const b = kvBuf(env);
  if (b) { b.datos.set(key, next); b.sucias.add(key); return true; }
  // Sin buffer (camino de respaldo): escritura directa, solo si cambio.
  try {
    if (await env.CRYPTO_BOT_STATE.get(key) === next) return true;
    await env.CRYPTO_BOT_STATE.put(key, next);
    return true;
  } catch (e: any) {
    console.error(`[KV] put fallo key=${key}: ${e?.message || e}`);
    return false;
  }
}

async function flushKv(env: Env, degradar = false): Promise<KvBuf | null> {
  const b = kvBuf(env);
  if (!b || !b.sucias.size) return b;
  for (const key of Array.from(b.sucias)) {
    const next = b.datos.get(key)!;
    if (degradar && KV_OPCIONALES.has(key)) { b.degradadas++; continue; }
    try {
      if (await env.CRYPTO_BOT_STATE.get(key) === next) { b.omitidas++; continue; }
      await env.CRYPTO_BOT_STATE.put(key, next);
      b.escritas.push(key);
    } catch (e: any) {
      b.fallos++;
      console.error(`[KV] put fallo key=${key}: ${e?.message || e}`);
    }
  }
  b.sucias.clear();
  return b;
}

function clampParam(key: string, raw: unknown): number | null { const p = PARAM_MAP.get(key); if (!p) return null; const n = Number(raw); if (!Number.isFinite(n)) return null; return Math.min(p.max, Math.max(p.min, n)); }
async function configValues(env: Env): Promise<Record<string, number>> {
  const stored = await getJson<Record<string, number>>(env, 'config_values', {});
  const out: Record<string, number> = {};
  for (const p of DEFAULT_PARAMS) out[p.key] = clampParam(p.key, stored[p.key] ?? p.value) ?? p.value;
  return out;
}

// Registra un evento de ESTADO solo si difiere del ultimo del mismo tipo. Una
// condicion persistente (p. ej. "grid sin capital") registrada cada ciclo es una
// escritura KV por ciclo sin informacion nueva: se omite si no cambio nada.
async function appendLogSiCambia(env: Env, evento: string, data: Record<string, any>, campos: string[]): Promise<void> {
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const previo = latest(logs, [evento]);
  const firma = (d: any) => JSON.stringify(campos.map((c) => d?.[c]));
  if (previo && firma(previo.data) === firma(data)) return;
  await appendLogs(env, [{ ts: new Date().toISOString(), event: evento, data }]);
}

async function appendLogs(env: Env, newLogs: LogItem[], max = 300): Promise<LogItem[]> {
  const oldLogs = await getJson<LogItem[]>(env, 'recent_logs', []);
  if (!newLogs.length) return oldLogs;
  const merged = oldLogs.concat(newLogs).slice(-max);
  await putJson(env, 'recent_logs', merged);
  return merged;
}

function truthy(value: unknown): boolean { return ['1','YES','TRUE','ON'].includes(String(value || '').trim().toUpperCase()); }
async function notificationAllowed(env: Env, key: string, minSeconds = 0): Promise<boolean> {
  if (!key) return true;
  const storageKey = `notify:${key}`;
  const previous = Number(await env.CRYPTO_BOT_STATE.get(storageKey) || 0);
  const now = Math.floor(Date.now() / 1000);
  if (minSeconds > 0 && previous && now - previous < minSeconds) return false;
  await env.CRYPTO_BOT_STATE.put(storageKey, String(now), { expirationTtl: Math.max(3600, minSeconds + 3600) });
  return true;
}
async function notifyWhatsApp(env: Env, event: string, title: string, body: string, dedupeKey = '', minSeconds = 0): Promise<void> {
  if (!truthy(env.WHATSAPP_ENABLED)) return;
  const to = String(env.WHATSAPP_TO || '').trim();
  if (!to) {
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'whatsapp_notification_skipped', data: { reason: 'missing_to', source_event: event } }]);
    return;
  }
  if (dedupeKey && !(await notificationAllowed(env, `${event}:${dedupeKey}`, minSeconds))) return;
  const provider = String(env.WHATSAPP_PROVIDER || 'meta_cloud').trim().toLowerCase();
  const message = `🤖 CryptoBot\n${title}\n\n${body}`.slice(0, 3500);
  try {
    let res: Response;
    if (provider === 'gateway' || provider === 'baileys_gateway' || provider === 'whatsapp_web') {
      const url = String(env.WHATSAPP_GATEWAY_URL || '').trim();
      if (!url) throw new Error('missing_gateway_url');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (env.WHATSAPP_GATEWAY_TOKEN) headers.Authorization = `Bearer ${env.WHATSAPP_GATEWAY_TOKEN}`;
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ to, message, event, title }) });
    } else {
      const phoneId = String(env.WHATSAPP_META_PHONE_NUMBER_ID || '').trim();
      const token = String(env.WHATSAPP_META_TOKEN || '').trim();
      if (!phoneId || !token) throw new Error('missing_meta_credentials');
      res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: message } }),
      });
    }
    const ok = res.ok;
    const detail = ok ? '' : (await res.text()).slice(0, 500);
    await appendLogs(env, [{ ts: new Date().toISOString(), event: ok ? 'whatsapp_notification_sent' : 'whatsapp_notification_error', data: { source_event: event, provider, status: res.status, detail } }]);
  } catch (exc: any) {
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'whatsapp_notification_error', data: { source_event: event, provider, error: String(exc?.message || exc) } }]);
  }
}
function orderLine(order: ConditionalOrder): string {
  const notional = order.side === 'BUY' ? `${roundUsd(Number(order.amount_usdc || 0))} USDC` : `USD ${roundUsd(Number(order.value_usd || 0))}`;
  const pnl = order.estimated_pnl_usd != null ? `\nP/L est: ${order.estimated_pnl_usd >= 0 ? '+' : ''}USD ${order.estimated_pnl_usd} (${order.estimated_pnl_pct || 0}%)` : '';
  return `${order.side} ${order.symbol}\nTrigger: USD ${order.trigger_price_usd}\nMonto: ${notional}${pnl}`;
}
async function notifyRunnerEvents(env: Env, logs: LogItem[], report: Report): Promise<void> {
  for (const item of logs) {
    const data = item.data || {};
    if (item.event === 'trade_executed') {
      const s = data.signal || {}; const r = data.result || {};
      await notifyWhatsApp(env, 'trade_executed', 'Orden ejecutada', `${s.action || 'TRADE'} ${data.symbol || s.source || ''}\nMonto: ${data.amount || '—'}\nOrigen: ${s.origin || s.strategy || 'motor'}\nOrden: ${r.id || '—'}\nRazón: ${s.reason || '—'}`, String(r.id || item.ts || Math.random()), 0);
    }
    if (item.event === 'conditional_order_executed') {
      const s = data.signal || {}; const r = data.result || {};
      await notifyWhatsApp(env, 'conditional_order_executed', 'Orden condicionada ejecutada', `${s.action || 'TRADE'} ${data.symbol || ''}\nID: ${data.conditional_order_id}\nOrden Crypto.com: ${r.id || '—'}`, String(data.conditional_order_id || item.ts), 0);
    }
    if (item.event === 'conditional_order_block') {
      await notifyWhatsApp(env, 'conditional_order_block', 'Orden condicionada bloqueada', `${data.side || ''} ${data.symbol || ''}\nID: ${data.conditional_order_id || '—'}\nMotivo: ${data.reason || '—'}`, String(`${data.conditional_order_id}:${data.reason}`), 1800);
    }
    if (item.event === 'ai_response') {
      const ai = data.ai || {}; const ops = Array.isArray(ai.opportunities) ? ai.opportunities : [];
      const summary = ops.slice(0, 4).map((op: any) => `${op.action || 'HOLD'} ${op.symbol || ''} ${Math.round(Number(op.confidence || 0) * 100)}%`).join(' · ');
      if (summary) await notifyWhatsApp(env, 'ai_proposal', 'Nueva propuesta IA', `${summary}\nModelo: ${ai.provider_used || 'groq'} ${ai.model_used || ''}\nCiclo: ${report.cycle ?? '—'}`, summary, 1800);
    }
  }
}

async function appendPortfolioHistory(env: Env, logs: LogItem[]): Promise<void> {
  const points: PortfolioPoint[] = [];
  for (const item of logs) {
    if (item.event !== 'portfolio_snapshot') continue;
    const ts = iso(item.ts);
    const value = Number(item.data?.total_usd || 0);
    if (ts && Number.isFinite(value) && value > 0) points.push({ ts, value_usd: value });
  }
  if (!points.length) return;
  // Un punto cada 15 min basta para la grafica y recorta 2/3 de las escrituras.
  const previos = await getJson<PortfolioPoint[]>(env, 'portfolio_history', []);
  const ultimo = previos[previos.length - 1];
  // 30 min basta para la grafica; cada punto es una escritura KV.
  const MIN_MS = 30 * 60 * 1000;
  if (ultimo && points.every((p) => Date.parse(p.ts) - Date.parse(ultimo.ts) < MIN_MS)) return;
  const old = await getJson<PortfolioPoint[]>(env, 'portfolio_history', []);
  const byTs = new Map<string, PortfolioPoint>();
  for (const p of old.concat(points)) byTs.set(p.ts, p);
  const merged = [...byTs.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).slice(-9000);
  await putJson(env, 'portfolio_history', merged);
}
// Coste real de cambiar una stablecoin por otra. La comision viene exenta en
// esta cuenta, pero el spread NO: 11.82 USDT -> 11.59 USDC es un 1.94% que se
// perdia sin quedar registrado, porque profit_state no aplica a stablecoins y
// el P/L se guardaba como 0. Doce rotaciones asi costaron 2.75 USD invisibles.
//
// Se mide con la tasa efectiva (to_amount / amount). NUNCA con native_amount:
// ese campo venia inflado y fue exactamente lo que escondio el coste.
function friccionDeConversion(trade: any): number | null {
  const de = cleanSymbol(trade?.amount?.currency);
  const a = cleanSymbol(trade?.to_amount?.currency);
  if (!de || !a || !STABLES.has(de) || !STABLES.has(a)) return null;
  const salen = Math.abs(Number(trade?.amount?.amount));
  const entran = Number(trade?.to_amount?.amount);
  if (!Number.isFinite(salen) || !Number.isFinite(entran) || salen <= 0) return null;
  // Entre stablecoins la tasa justa es 1:1, asi que la diferencia es el coste.
  return Math.round((entran - salen) * 100) / 100;
}

// Coste porcentual real de las rotaciones ya hechas, para no repetir a ciegas
// una operacion que resulto cara. Devuelve null si no hay historial que medir.
// Coste de un movimiento que cambio una stablecoin por otra, deducido de las
// monedas y no del campo friccion_usd: los movimientos guardados antes de
// medirlo no lo llevan, y son justo los que hay que poder mirar.
function friccionDeMovimiento(m: MovementItem): number | null {
  const de = cleanSymbol(m.amount_currency), a = cleanSymbol(m.to_currency);
  if (!de || !a || !STABLES.has(de) || !STABLES.has(a)) return null;
  const sale = Math.abs(Number(m.amount)), entra = Number(m.to_amount);
  if (!Number.isFinite(sale) || !Number.isFinite(entra) || sale <= 0) return null;
  // Entre stablecoins la tasa justa es 1:1, asi que la diferencia es el coste.
  return Math.round((entra - sale) * 100) / 100;
}

const ROTACION_COSTE_MAX_PCT = 0.5;
function costeRotacionMedido(movs: MovementItem[]): { pct: number; n: number } | null {
  let salen = 0, entran = 0, n = 0;
  for (const m of movs) {
    // Se deduce de las monedas, no del campo friccion_usd: los movimientos
    // guardados antes de medirlo no lo tienen, y son justo los que hay que mirar.
    if (friccionDeMovimiento(m) === null) continue;
    salen += Math.abs(Number(m.amount)); entran += Number(m.to_amount); n++;
  }
  if (salen <= 0 || !n) return null;
  return { pct: Math.round(((salen - entran) / salen) * 10000) / 100, n };
}

function movementFromTradeLog(item: LogItem): MovementItem | null {
  if (item.event !== 'trade_executed') return null;
  const data = item.data || {};
  const trade = data.result || {};
  const signal = data.signal || {};
  const ts = iso(trade.created_at || item.ts) || new Date().toISOString();
  const id = String(trade.id || `${ts}:${data.symbol || signal.source || ''}:${signal.action || 'TRADE'}`);
  const symbol = cleanSymbol(data.symbol || signal.source || trade.amount?.currency || trade.to_amount?.currency);
  if (!id || !symbol) return null;
  // El motor ya calcula profit_state en cada venta; antes se descartaba y por eso
  // las analiticas daban siempre cero. Aqui se conserva para poder medir resultados.
  const profitState = signal.profit_state || {};
  const pnlPct = Number(profitState.profit_pct);
  const valorUsd = Number(trade.native_amount?.amount ?? trade.to_amount?.amount ?? 0);
  const pnlKnown = Boolean(profitState.known) && Number.isFinite(pnlPct);
  return {
    id,
    ts,
    symbol,
    pnl_pct: pnlKnown ? Math.round(pnlPct * 10000) / 100 : 0,
    pnl_usd: pnlKnown ? Math.round(valorUsd * pnlPct * 100) / 100 : 0,
    pnl_known: pnlKnown,
    friccion_usd: friccionDeConversion(trade),
    side: String(signal.action || 'TRADE').toUpperCase(),
    description: String(trade.description || 'Orden ejecutada'),
    amount: String(trade.amount?.amount ?? ''),
    amount_currency: String(trade.amount?.currency || ''),
    to_amount: String(trade.to_amount?.amount ?? ''),
    to_currency: String(trade.to_amount?.currency || ''),
    value_usd: String(trade.native_amount?.amount ?? data.amount ?? ''),
    status: String(trade.status || 'done'),
    confidence: Number(signal.confidence || 0),
    origin: String(signal.origin || signal.strategy || 'unknown'),
    reason: String(signal.reason || ''),
  };
}
async function appendMovementHistory(env: Env, logs: LogItem[]): Promise<MovementItem[]> {
  const fresh = logs.map(movementFromTradeLog).filter(Boolean) as MovementItem[];
  if (!fresh.length) return await getJson<MovementItem[]>(env, 'movement_history', []);
  const old = await getJson<MovementItem[]>(env, 'movement_history', []);
  const byId = new Map<string, MovementItem>();
  for (const item of old.concat(fresh)) byId.set(item.id, item);
  const merged = [...byId.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 500);
  await putJson(env, 'movement_history', merged);
  return merged;
}
function rangeMs(range: string): number {
  if (range === '1d') return 24 * 3600 * 1000;
  if (range === '1w') return 7 * 24 * 3600 * 1000;
  if (range === '1m') return 31 * 24 * 3600 * 1000;
  return 3 * 3600 * 1000;
}
function compactSeries(points: PortfolioPoint[], maxPoints = 180): PortfolioPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: PortfolioPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points.at(-1);
  if (last && out.at(-1)?.ts !== last.ts) out.push(last);
  return out;
}
function portfolioChange(points: PortfolioPoint[], ms: number): { start: number; current: number; change_usd: number; change_pct: number } | null {
  const clean = points.filter((p) => p.ts && Number.isFinite(p.value_usd) && p.value_usd > 0).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (clean.length < 2) return null;
  const cutoff = Date.now() - ms;
  const window = clean.filter((p) => Date.parse(p.ts) >= cutoff);
  const start = (window[0] || clean[0]).value_usd;
  const current = clean.at(-1)!.value_usd;
  if (start <= 0 || current <= 0) return null;
  const change = current - start;
  return { start: roundUsd(start), current: roundUsd(current), change_usd: roundUsd(change), change_pct: roundPct((change / start) * 100) };
}
async function desiredState(env: Env): Promise<DesiredState> { const s = await env.CRYPTO_BOT_STATE.get('desired_state'); return s === 'paused' || s === 'stopped' ? s : 'running'; }
async function setDesiredState(env: Env, state: DesiredState): Promise<void> { await env.CRYPTO_BOT_STATE.put('desired_state', state); }
async function executionMode(env: Env): Promise<ExecutionMode> { const s = await env.CRYPTO_BOT_STATE.get('execution_mode'); return s === 'auto' ? 'auto' : 'semi'; }
async function setExecutionMode(env: Env, mode: ExecutionMode): Promise<void> { await env.CRYPTO_BOT_STATE.put('execution_mode', mode); }

async function dispatchRunner(env: Env, reason: string): Promise<Record<string, unknown>> {
  const token = env.GITHUB_DISPATCH_TOKEN || '';
  if (!token) return { ok: false, detail: 'github_token_missing' };
  const repository = env.GITHUB_REPOSITORY || 'tradiabot/crypto-bot-runner';
  const workflow = env.GITHUB_WORKFLOW || 'cloudflare-runner.yml';
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'crypto-bot-cloudflare' };
  const workflowRes = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'master' }) });
  if (workflowRes.status === 204) return { ok: true, status: 204, method: 'workflow_dispatch', reason };
  const repoRes = await fetch(`https://api.github.com/repos/${repository}/dispatches`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'crypto-bot-cycle', client_payload: { reason } }) });
  return { ok: repoRes.status === 204, status: workflowRes.status, fallback_status: repoRes.status, method: repoRes.status === 204 ? 'repository_dispatch' : 'failed', reason };
}

// Se elige por timestamp real, no por posicion: recent_logs recibe lotes del runner
// y puede quedar desordenado, lo que hacia reportar eventos viejos como actuales.
function latest(logs: LogItem[], events: string[]): LogItem | null {
  let best: LogItem | null = null;
  let bestAt = -Infinity;
  for (const item of logs) {
    if (!item.event || !events.includes(item.event)) continue;
    const at = item.ts ? Date.parse(item.ts) : NaN;
    const score = Number.isFinite(at) ? at : -Infinity;
    if (best === null || score >= bestAt) { bestAt = score; best = item; }
  }
  return best;
}
// El runner emite 'ai_response' / 'ai_execution_block', no 'decision'. Se normaliza
// a la forma que espera la UI para que el panel deje de salir vacio.
function normalizeAiDecision(item: LogItem | null): LogItem | null {
  if (!item) return null;
  const data = item.data || {};
  const opps: any[] = data.ai?.opportunities || data.opportunities || [];
  const best = opps.slice().sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0))[0] || {};
  const blocked = item.event === 'ai_execution_block';
  return {
    ts: item.ts,
    event: item.event,
    data: {
      symbol: best.symbol || '',
      reason: blocked ? String(data.reason || '') : (best.reason || ''),
      signal: { action: best.action || 'HOLD', confidence: Number(best.confidence || 0), reason: best.reason || '' },
    },
  };
}
// Un exit code 0 no significa que la IA respondiera: el runner sale limpio aunque
// Groq falle y todo quede en HOLD. Se mira el motivo real del bloqueo.
function aiFailureReason(logs: LogItem[]): string | null {
  const block = latest(logs, ['ai_execution_block']);
  if (!block) return null;
  // Si despues del ultimo bloqueo ya hubo una decision exitosa, la IA se recupero:
  // el bloqueo sigue en el buffer de logs pero ya no es el estado actual.
  const recovered = latest(logs, ['decision', 'decision_hold', 'trade_executed']);
  if (recovered && Date.parse(recovered.ts || '') >= Date.parse(block.ts || '')) return null;
  const reason = block.data?.reason ? String(block.data.reason) : '';
  return /reporto error|no disponible|HTTP \d{3}|timeout|unauthorized|quota/i.test(reason) ? reason : null;
}
function publicTradeData(data: Record<string, any>): Record<string, unknown> {
  const signal = data.signal || {}; const result = data.result || {};
  return { symbol: data.symbol || signal.source || '', amount: data.amount ?? null, runner_cycle: data.runner_cycle ?? null, signal: { action: signal.action || 'TRADE', confidence: Number(signal.confidence || 0), strategy: signal.strategy || '', reason: signal.reason || '', origin: signal.origin || null }, result: { id: result.id ?? null, description: result.description || 'Orden ejecutada', amount: result.amount || null, to_amount: result.to_amount || null, native_amount: result.native_amount || null, status: result.status || 'done', created_at: iso(result.created_at) || null } };
}
function aiExecutionBlockReason(data: Record<string, any>): string {
  if (data.reason || data.error) return String(data.reason || data.error);
  const ai = data.ai || {};
  if (ai.error) return `IA reporto error: ${ai.error}`;
  if (ai.partial_errors) return 'IA con errores parciales; ejecucion bloqueada por REQUIRE_AI_FOR_EXECUTION';
  const provider = String(data.provider_used || ai.provider_used || '').trim();
  const requested = String(data.requested_provider || 'groq').trim();
  const model = String(data.model_used || ai.model_used || '').trim();
  if (provider && provider !== requested) return `Proveedor IA invalido: recibido '${provider}', requerido '${requested}'`;
  if (!provider) return `Proveedor IA ausente; requerido '${requested}'`;
  if (!model || model === 'technical') return 'Modelo IA ausente o fallback tecnico; ejecucion bloqueada';
  return 'IA no validada para ejecucion real';
}
function compactDecision(item: LogItem): Record<string, unknown> | null {
  const event = item.event || ''; const data = item.data || {}; const ts = iso(item.ts) || new Date().toISOString();
  if (event === 'decision' || event === 'decision_hold') { const s = data.signal || {}; const gate = data.risk_gate || {}; const approved = gate.approved !== false && event !== 'decision_hold'; return { ts, kind: 'decision', title: `${s.action || 'HOLD'} ${data.symbol || s.source || ''}`.trim(), badge: approved ? 'RIESGO OK' : 'SIN OPERAR', confidence: Number(s.confidence || 0), amount: data.amount ?? null, reason: s.reason || data.reason || '', detail: approved ? `${s.origin || 'motor'} · ciclo ${data.runner_cycle || '—'}` : ((gate.errors || []).join(', ') || data.reason || 'hold') }; }
  if (event === 'trade_executed') { const s = data.signal || {}; const r = data.result || {}; const isDust = s.strategy === 'DUST_SWEEP'; return { ts, kind: 'trade', title: isDust ? `${data.symbol || s.source || ''} → USDC` : (r.description || `${s.action || 'TRADE'} ${data.symbol || ''}`.trim()), badge: isDust ? 'POLVO A USDC' : 'EJECUTADA', confidence: Number(s.confidence || 0), amount: r.native_amount?.amount || data.amount || null, reason: s.reason || '', detail: `orden ${r.id || '—'}` }; }
  if (event === 'dust_sweep_block' || event === 'dust_sweep_error') return { ts, kind: 'block', title: event === 'dust_sweep_error' ? 'Polvo no convertido' : 'Polvo omitido', badge: 'DUST', confidence: null, amount: data.value_usd || null, reason: data.reason || data.error || '', detail: data.symbol || 'USDC' };
  if (event === 'portfolio_snapshot') return null;
  if (event === 'ai_response') { const ai = data.ai || {}; const ops = Array.isArray(ai.opportunities) ? ai.opportunities : []; return { ts, kind: 'ai', title: `IA ${ai.provider_used || 'groq'} · ${ai.model_used || ''}`, badge: `${ops.length} señales`, confidence: null, amount: null, reason: ops.slice(0, 4).map((op: any) => `${op.action || 'HOLD'} ${op.symbol || ''} ${Math.round(Number(op.confidence || 0) * 100)}%`).join(' · ') || 'Sin señales', detail: `ciclo ${data.runner_cycle || '—'}` }; }
  if (event === 'codex_supervisor' || event === 'config_updated_by_supervisor') return { ts, kind: 'supervisor', title: 'Supervisor', badge: event === 'config_updated_by_supervisor' ? 'AJUSTÓ CONFIG' : 'REVISÓ', confidence: null, amount: null, reason: JSON.stringify(data.param_changes || data.applied || data.report?.param_changes || {}).slice(0, 160), detail: `ciclo ${data.runner_cycle || '—'}` };
  if (event === 'ai_execution_block') return { ts, kind: 'block', title: 'IA no ejecutada', badge: 'BLOQUEO IA', confidence: null, amount: null, reason: aiExecutionBlockReason(data), detail: `ciclo ${data.runner_cycle || '—'}` };
  if (event.includes('block') || event === 'execution_skipped') return { ts, kind: 'block', title: event, badge: 'BLOQUEO', confidence: null, amount: data.amount || null, reason: data.reason || data.error || '', detail: data.symbol || `ciclo ${data.runner_cycle || '—'}` };
  return null;
}


function cleanSymbol(symbol: unknown): string | null {
  const value = String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return value.length >= 2 && value.length <= 12 ? value : null;
}
function roundPct(n: number): number { return Math.round(n * 100) / 100; }
function orderId(): string { return `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function forceSellId(): string { return `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function estimateOrderPnl(side: 'BUY' | 'SELL', current: number, trigger: number, notional: number): { estimated_pnl_usd: number; estimated_pnl_pct: number; estimated_outcome: 'gain' | 'loss' | 'neutral' } {
  if (!Number.isFinite(current) || !Number.isFinite(trigger) || !Number.isFinite(notional) || current <= 0 || trigger <= 0 || notional <= 0) {
    return { estimated_pnl_usd: 0, estimated_pnl_pct: 0, estimated_outcome: 'neutral' };
  }
  const pct = side === 'BUY' ? (current - trigger) / current : (trigger - current) / current;
  const usd = notional * pct;
  return { estimated_pnl_usd: roundUsd(usd), estimated_pnl_pct: roundPct(pct * 100), estimated_outcome: usd > 0.005 ? 'gain' : usd < -0.005 ? 'loss' : 'neutral' };
}
function basisAvgCost(basis: Record<string, unknown>, symbol: string): number | null {
  const positions = (basis as any)?.positions;
  const pos = positions && typeof positions === 'object' ? positions[symbol] : null;
  const amount = Number(pos?.amount || 0);
  const cost = Number(pos?.cost_usd || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(cost) || amount <= 0 || cost <= 0) return null;
  return cost / amount;
}
function estimateOrderPnlWithBasis(side: 'BUY' | 'SELL', current: number, trigger: number, notional: number, avgCost: number | null) {
  if (side === 'SELL' && avgCost && avgCost > 0 && trigger > 0 && notional > 0) {
    const pct = (trigger - avgCost) / avgCost;
    const usd = notional * ((trigger - avgCost) / trigger);
    return {
      estimated_pnl_usd: roundUsd(usd),
      estimated_pnl_pct: roundPct(pct * 100),
      estimated_outcome: usd > 0.005 ? 'gain' as const : usd < -0.005 ? 'loss' as const : 'neutral' as const,
      estimated_pnl_basis: 'avg_cost' as const,
      avg_cost_usd: roundPrice(avgCost),
    };
  }
  return { ...estimateOrderPnl(side, current, trigger, notional), estimated_pnl_basis: 'current_price' as const, avg_cost_usd: avgCost ? roundPrice(avgCost) : null };
}
function activeConditionalOrders(orders: ConditionalOrder[]): ConditionalOrder[] {
  // A proposal popup may be rendered more than once while the dashboard is
  // refreshing.  One active intent per side/symbol is enough and prevents a
  // repeated tap from becoming several real orders at the same trigger.
  const valid = orders
    .filter((o) => o.status === 'active' && o.trigger_price_usd > 0 && (o.side === 'BUY' ? Number(o.amount_usdc || 0) > 0 : Number(o.value_usd || 0) > 0))
    .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
  const seen = new Set<string>();
  return valid.filter((o) => {
    const key = `${o.side}:${o.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function latestPortfolioSnapshot(logs: LogItem[]): { total_usd: number; assets: Record<string, any> } | null {
  const snap = logs.filter((x) => x.event === 'portfolio_snapshot').at(-1);
  const assets = snap?.data?.assets;
  if (!assets || typeof assets !== 'object') return null;
  return { total_usd: Number(snap?.data?.total_usd || 0), assets: assets as Record<string, any> };
}
function latestFreeUsdc(logs: LogItem[], snapshot: { total_usd: number; assets: Record<string, any> } | null): number {
  const cap = logs.filter((x) => x.event === 'capital_status').at(-1)?.data || {};
  const free = Number(cap.free);
  if (Number.isFinite(free) && free >= 0) return free;
  const usdc = snapshot?.assets?.USDC || snapshot?.assets?.USD || {};
  const fallback = Number(usdc.native_usd ?? usdc.amount ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}
function assetHeldUsd(snapshot: { total_usd: number; assets: Record<string, any> } | null, symbol: string): number {
  const value = Number(snapshot?.assets?.[symbol]?.native_usd || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
async function executableConditionalOrders(env: Env, opts: { persist?: boolean } = {}): Promise<ConditionalOrder[]> {
  const orders = activeConditionalOrders(await conditionalOrders(env));
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snapshot = latestPortfolioSnapshot(logs);
  const allocation = await allocationValues(env);
  const freeUsdc = latestFreeUsdc(logs, snapshot);
  let reservedBuy = 0;
  const reservedSell = new Map<string, number>();
  const accepted: ConditionalOrder[] = [];
  const filtered: Array<{ id: string; symbol: string; side: string; reason: string }> = [];
  const newestBySymbol = new Map<string, ConditionalOrder>();
  for (const order of orders) {
    const prev = newestBySymbol.get(order.symbol);
    if (!prev || Date.parse(order.updated_at || order.created_at) > Date.parse(prev.updated_at || prev.created_at)) newestBySymbol.set(order.symbol, order);
  }
  for (const order of orders) {
    const symbol = order.symbol;
    const side = order.side;
    if (newestBySymbol.get(symbol)?.id !== order.id) {
      filtered.push({ id: order.id, symbol, side, reason: 'symbol_conflict_newer_order_exists' });
      continue;
    }
    const targetPct = Number(allocation[symbol] || 0);
    const weightPct = Number(snapshot?.assets?.[symbol]?.weight || 0) * 100;
    if (side === 'BUY' && targetPct > 0 && weightPct > targetPct + 0.75) {
      filtered.push({ id: order.id, symbol, side, reason: `buy_blocked_asset_above_target_${roundPct(weightPct)}>${roundPct(targetPct)}` });
      continue;
    }
    if (side === 'SELL' && targetPct > 0 && weightPct < Math.max(0.1, targetPct * 0.5)) {
      filtered.push({ id: order.id, symbol, side, reason: `sell_blocked_asset_below_minimum_${roundPct(weightPct)}<${roundPct(targetPct * 0.5)}` });
      continue;
    }
    if (side === 'BUY') {
      const amount = Number(order.amount_usdc || 0);
      if (reservedBuy + amount > freeUsdc + 0.000001) {
        filtered.push({ id: order.id, symbol, side, reason: `buy_budget_exceeded_reserved_${roundUsd(reservedBuy + amount)}_free_${roundUsd(freeUsdc)}` });
        continue;
      }
      reservedBuy += amount;
    } else {
      const value = Number(order.value_usd || 0);
      const held = assetHeldUsd(snapshot, symbol);
      const reserved = reservedSell.get(symbol) || 0;
      if (held > 0 && reserved + value > held + 0.000001) {
        filtered.push({ id: order.id, symbol, side, reason: `sell_balance_exceeded_reserved_${roundUsd(reserved + value)}_held_${roundUsd(held)}` });
        continue;
      }
      if (held <= 0) {
        filtered.push({ id: order.id, symbol, side, reason: 'sell_blocked_no_position' });
        continue;
      }
      reservedSell.set(symbol, reserved + value);
    }
    accepted.push(order);
  }
  if (filtered.length) {
    if (opts.persist) {
      await appendLogs(env, [{ ts: new Date().toISOString(), event: 'conditional_order_filtered', data: { filtered, accepted: accepted.map((o) => o.id), free_usdc: roundUsd(freeUsdc) } }]);
      const all = await conditionalOrders(env);
      const now = new Date().toISOString();
      const reasons = new Map(filtered.map((x) => [x.id, x.reason]));
      await putJson(env, 'conditional_orders', all.map((o) => reasons.has(o.id) && o.status === 'active' ? { ...o, status: 'paused' as const, updated_at: now, note: `${o.note ? `${o.note} · ` : ''}Pausada: ${reasons.get(o.id)}`.slice(0, 180) } : o));
    }
  }
  return accepted;
}
async function conditionalOrders(env: Env): Promise<ConditionalOrder[]> {
  const orders = await getJson<ConditionalOrder[]>(env, 'conditional_orders', []);
  return Array.isArray(orders) ? orders : [];
}
async function costBasisState(env: Env): Promise<Record<string, unknown>> {
  const state = await getJson<Record<string, unknown>>(env, 'cost_basis_state', {});
  return state && typeof state === 'object' ? state : {};
}
async function reconcileCostBasisState(env: Env, logs: LogItem[]): Promise<void> {
  // GitHub runners are ephemeral. Persist only the compact accounting state,
  // never credentials or raw API payloads, so the next cycle can retain the
  // average cost that was reconstructed from Crypto.com history.
  const event = logs.slice().reverse().find((item) => item.event === 'cost_basis_synced');
  const state = event?.data?.state;
  if (!state || typeof state !== 'object') return;
  const positions = (state as any).positions;
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) return;
  const compact: Record<string, unknown> = { positions: {}, updated_at: Number((state as any).updated_at || Date.now() / 1000), source: 'crypto_com_history_sync' };
  for (const [symbol, raw] of Object.entries(positions as Record<string, any>).slice(0, 80)) {
    const clean = cleanSymbol(symbol);
    const amount = Number(raw?.amount || 0); const cost = Number(raw?.cost_usd || 0);
    if (!clean || !Number.isFinite(amount) || !Number.isFinite(cost) || amount <= 0 || cost <= 0) continue;
    (compact.positions as Record<string, unknown>)[clean] = {
      amount, cost_usd: cost, realized_pnl_usd: Number(raw?.realized_pnl_usd || 0),
      estimated: Boolean(raw?.estimated), source: String(raw?.source || 'history_sync').slice(0, 60),
    };
  }
  // El runner envia un updated_at nuevo en cada ciclo aunque las posiciones sean
  // identicas; comparar el estado completo forzaba una escritura por ciclo.
  // Las cantidades solo cambian al operar; el costo ESTIMADO (balance_seed) el
  // runner lo recalcula con el precio de mercado y deriva milesimas cada ciclo.
  // Comparar exacto forzaba una escritura por ciclo (+144/dia). Se reescribe si
  // cambia alguna cantidad, o si un costo se mueve mas de un 2% (una correccion
  // real, p. ej. de estimado a costo verdadero, supera con holgura ese umbral).
  const previo = await getJson<any>(env, 'cost_basis_state', null);
  const antes = (previo?.positions || {}) as Record<string, any>;
  const ahora = compact.positions as Record<string, any>;
  const claves = new Set([...Object.keys(antes), ...Object.keys(ahora)]);
  let relevante = !previo;
  for (const k of claves) {
    const a0 = antes[k], a1 = ahora[k];
    if (!a0 || !a1) { relevante = true; break; }
    if (Math.abs(Number(a0.amount) - Number(a1.amount)) > 1e-9) { relevante = true; break; }
    const c0 = Number(a0.cost_usd) || 0, c1 = Number(a1.cost_usd) || 0;
    if (Math.abs(c1 - c0) / (Math.abs(c0) || 1) > 0.02) { relevante = true; break; }
  }
  if (!relevante) return;
  await putJson(env, 'cost_basis_state', compact);
}
async function ordersResponse(env: Env): Promise<Response> {
  const orders = await conditionalOrders(env);
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const market = latestMarket(logs);
  const basis = await costBasisState(env);
  return json({ orders: orders.map((o) => {
    const current = Number(market.get(o.symbol)?.price_usd || o.current_price_usd || 0);
    const notional = o.side === 'BUY' ? Number(o.amount_usdc || 0) : Number(o.value_usd || 0);
    const avgCost = basisAvgCost(basis, o.symbol);
    const est = estimateOrderPnlWithBasis(o.side, current, o.trigger_price_usd, notional, avgCost);
    return { ...o, current_price_usd: roundPrice(current), ...est };
  }).sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at)) });
}
async function forceSellOnceState(env: Env): Promise<Record<string, unknown> | null> {
  const state = await getJson<Record<string, unknown> | null>(env, 'force_sell_once', null);
  if (!state || typeof state !== 'object') return null;
  const expiresAt = Date.parse(String(state.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await env.CRYPTO_BOT_STATE.delete('force_sell_once');
    return null;
  }
  return state;
}
async function forceSellOnce(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const symbol = cleanSymbol(body.symbol);
  const valueUsd = Number(body.value_usd);
  if (!symbol || symbol === 'USDC' || symbol === 'USDT') return json({ detail: 'invalid_symbol' }, 400);
  const values = await configValues(env);
  if (!Number.isFinite(valueUsd) || valueUsd < values.MIN_SELL_NATIVE_USD || valueUsd > values.MAX_SELL_NATIVE_USD) {
    return json({ detail: `value_usd_must_be_${values.MIN_SELL_NATIVE_USD}_${values.MAX_SELL_NATIVE_USD}` }, 400);
  }
  const now = new Date();
  const state = {
    id: forceSellId(),
    symbol,
    value_usd: roundUsd(valueUsd),
    reason: String(body.reason || 'venta forzada autorizada por usuario').slice(0, 180),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
  };
  await putJson(env, 'force_sell_once', state);
  await appendLogs(env, [{ ts: now.toISOString(), event: 'force_sell_once_authorized', data: state }]);
  const dispatch = await dispatchRunner(env, 'force_sell_once');
  return json({ ok: true, force_sell_once: state, dispatch });
}
async function updateOrder(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  await markUserResponse(env, 'orden_creada');
  const symbol = cleanSymbol(body.symbol || body.order?.symbol);
  const side = String(body.side || body.order?.side || '').toUpperCase();
  const trigger = Number(body.trigger_price_usd ?? body.order?.trigger_price_usd);
  if (!symbol || !['BUY','SELL'].includes(side) || !Number.isFinite(trigger) || trigger <= 0) return json({ detail: 'invalid_order' }, 400);
  const values = await configValues(env);
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const market = latestMarket(logs);
  const now = new Date().toISOString();
  const orders = await conditionalOrders(env);
  const requestedId = String(body.id || body.order?.id || '');
  // Saving a fresh plan for the same BUY/SELL pair replaces its active plan.
  // This is deliberate: the UI exposes a single current proposal per pair.
  const samePair = !requestedId ? activeConditionalOrders(orders).find((o) => o.symbol === symbol && o.side === side) : undefined;
  const id = requestedId || samePair?.id || orderId();
  const existing = orders.find((o) => o.id === id);
  const currentPrice = Number(body.current_price_usd ?? body.order?.current_price_usd ?? market.get(symbol)?.price_usd ?? existing?.current_price_usd ?? 0);
  const status = ['active','paused','cancelled'].includes(String(body.status || body.order?.status || existing?.status || 'active')) ? String(body.status || body.order?.status || existing?.status || 'active') as ConditionalOrder['status'] : 'active';
  const amountUsdc = Number(body.amount_usdc ?? body.order?.amount_usdc ?? existing?.amount_usdc ?? 0);
  const valueUsd = Number(body.value_usd ?? body.order?.value_usd ?? existing?.value_usd ?? 0);
  if (side === 'BUY' && (!Number.isFinite(amountUsdc) || amountUsdc < values.MIN_TRADE_USDC || amountUsdc > values.MAX_TRADE_USDC)) return json({ detail: `amount_usdc_must_be_${values.MIN_TRADE_USDC}_${values.MAX_TRADE_USDC}` }, 400);
  if (side === 'SELL' && (!Number.isFinite(valueUsd) || valueUsd < values.MIN_SELL_NATIVE_USD || valueUsd > values.MAX_SELL_NATIVE_USD)) return json({ detail: `value_usd_must_be_${values.MIN_SELL_NATIVE_USD}_${values.MAX_SELL_NATIVE_USD}` }, 400);
  // Conditional plans in this product are take-profit / buy-the-dip plans.
  // Refuse inverted manual triggers rather than silently creating a losing
  // order. Defensive exits stay under the risk engine, not this UI.
  // BUY normalmente tiene trigger < precio actual. Pero en un SHORT (cierre), trigger puede ser > precio actual.
  const isShortClose = String(id).startsWith('short-BTC');
  if (currentPrice > 0 && side === 'BUY' && trigger >= currentPrice && !isShortClose) return json({ detail: 'buy_trigger_must_be_below_current_price' }, 400);
  if (currentPrice > 0 && side === 'SELL' && trigger <= currentPrice) return json({ detail: 'sell_trigger_must_be_above_current_price' }, 400);
  if (status === 'active') {
    const snapshot = latestPortfolioSnapshot(logs);
    const freeUsdc = latestFreeUsdc(logs, snapshot);
    const nextActiveBase = activeConditionalOrders(orders).filter((o) => o.id !== id && o.symbol !== symbol);
    if (side === 'BUY') {
      const reserved = nextActiveBase.filter((o) => o.side === 'BUY').reduce((sum, o) => sum + Number(o.amount_usdc || 0), 0);
      if (reserved + amountUsdc > freeUsdc + 0.000001) return json({ detail: `buy_orders_exceed_free_usdc_${roundUsd(reserved + amountUsdc)}_available_${roundUsd(freeUsdc)}` }, 400);
    } else {
      const held = assetHeldUsd(snapshot, symbol);
      const reserved = nextActiveBase.filter((o) => o.side === 'SELL' && o.symbol === symbol).reduce((sum, o) => sum + Number(o.value_usd || 0), 0);
      if (held <= 0) return json({ detail: 'sell_order_requires_existing_position' }, 400);
      if (reserved + valueUsd > held + 0.000001) return json({ detail: `sell_orders_exceed_position_${roundUsd(reserved + valueUsd)}_held_${roundUsd(held)}` }, 400);
    }
  }
  const order: ConditionalOrder = {
    id,
    symbol,
    side: side as 'BUY' | 'SELL',
    trigger_price_usd: roundPrice(trigger),
    current_price_usd: roundPrice(currentPrice),
    amount_usdc: side === 'BUY' ? roundUsd(amountUsdc) : undefined,
    value_usd: side === 'SELL' ? roundUsd(valueUsd) : undefined,
    ...estimateOrderPnl(side as 'BUY' | 'SELL', currentPrice, trigger, side === 'BUY' ? amountUsdc : valueUsd),
    status,
    note: String(body.note ?? body.order?.note ?? existing?.note ?? '').slice(0, 180),
    created_at: existing?.created_at || now,
    updated_at: now,
    executed_at: existing?.executed_at || null,
    execution_order_id: existing?.execution_order_id || null,
  };
  // Guardar un plan reemplaza al plan activo del mismo par: es deliberado,
  // la app expone una sola propuesta por par. Pero antes borraba TODA orden
  // activa del simbolo sin mirar el lado ni si era un escalon, asi que guardar
  // una compra de BTC hacia desaparecer el DCA, el MACD y la venta programada.
  // Los escalones (grid/dca/rsi/macd) son una escalera: ni desplazan ni son
  // desplazados, y el limite de capital lo sigue poniendo el guardian.
  const esEscalon = (o: { id: string }) => ESCALONADAS.some((pre) => String(o.id).startsWith(pre));
  const desplaza = (o: ConditionalOrder) =>
    o.status === 'active' && o.symbol === symbol && o.side === side && !esEscalon(o) && !esEscalon(order);
  const next = orders.filter((o) => o.id !== id && !desplaza(o)).concat(order).slice(-80);
  await saveOrdersGuarded(env, next, 'orden_manual');
  await appendLogs(env, [{ ts: now, event: 'conditional_order_saved', data: { order, source: 'app' } }]);
  await notifyWhatsApp(env, 'conditional_order_saved', 'Orden condicionada guardada', orderLine(order), order.id, 0);
  return json({ ok: true, order, orders: next });
}
async function cancelOrder(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  await markUserResponse(env, 'orden_cancelada');
  const id = String(body.id || '');
  const orders = await conditionalOrders(env);
  const now = new Date().toISOString();
  let found = false;
  const next = orders.map((o) => {
    if (o.id !== id) return o;
    found = true;
    return { ...o, status: 'cancelled' as const, updated_at: now };
  });
  if (!found) return json({ detail: 'order_not_found' }, 404);
  await saveOrdersGuarded(env, next, 'cancelacion');
  await appendLogs(env, [{ ts: now, event: 'conditional_order_cancelled', data: { id, source: 'app' } }]);
  await notifyWhatsApp(env, 'conditional_order_cancelled', 'Orden condicionada cancelada', `ID: ${id}`, id, 0);
  return json({ ok: true, id });
}
async function reconcileConditionalOrders(env: Env, logs: LogItem[]): Promise<void> {
  const executed = logs.filter((x) => x.event === 'conditional_order_executed');
  const sellTrades = logs.filter((x) => x.event === 'trade_executed' && String(x.data?.signal?.action || '').toUpperCase() === 'SELL');
  if (!executed.length && !sellTrades.length) return;
  const orders = await conditionalOrders(env);
  let changed = false;
  for (const item of executed) {
    const id = String(item.data?.conditional_order_id || '');
    if (!id) continue;
    const order = orders.find((o) => o.id === id);
    if (!order || order.status === 'executed') continue;
    order.status = 'executed';
    order.updated_at = new Date().toISOString();
    order.executed_at = iso(item.ts) || order.updated_at;
    order.execution_order_id = String(item.data?.result?.id || item.data?.order_id || '');
    await notifyWhatsApp(env, 'conditional_order_executed', 'Orden condicionada ejecutada', `${orderLine(order)}\nOrden Crypto.com: ${order.execution_order_id || '—'}`, id, 0);
    changed = true;
  }
  for (const item of sellTrades) {
    const symbol = cleanSymbol(item.data?.symbol || item.data?.signal?.source);
    if (!symbol) continue;
    for (const order of orders) {
      if (order.status !== 'active' || order.symbol !== symbol || order.side !== 'SELL') continue;
      order.status = 'cancelled';
      order.updated_at = new Date().toISOString();
      order.note = `${order.note ? `${order.note} · ` : ''}Cancelada: venta ${symbol} ejecutada fuera de esta orden`.slice(0, 180);
      changed = true;
    }
  }
  if (changed) await saveOrdersGuarded(env, orders, 'reconciliacion');
}
async function latestAssets(env: Env): Promise<Array<{symbol: string; value_usd: number; weight: number}>> {
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snap = logs.filter((x) => x.event === 'portfolio_snapshot').at(-1);
  const raw = snap?.data?.assets || {};
  return Object.entries(raw).map(([symbol, value]: [string, any]) => ({ symbol, value_usd: Number(value.native_usd || 0), weight: Number(value.weight || 0) })).filter((x) => x.value_usd > 0).sort((a, b) => b.value_usd - a.value_usd);
}
// Nucleo fijo de la cartera: el supervisor puede rotar, agregar o quitar otros
// activos, pero estos seis nunca se eliminan de la asignacion objetivo.
const BASE_ASSETS = ['USDC', 'BTC', 'ETH', 'CRO', 'SOL', 'XRP'];
const BASE_MIN_PCT = 1;

function ensureBaseAssets(alloc: AllocationMap): AllocationMap {
  const out: AllocationMap = { ...alloc };
  let missing = false;
  for (const symbol of BASE_ASSETS) {
    if (!(Number(out[symbol]) > 0)) { out[symbol] = BASE_MIN_PCT; missing = true; }
  }
  if (!missing) return out;
  // Al reponer un faltante hay que renormalizar para que siga sumando 100%.
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total <= 0) return out;
  const scaled: AllocationMap = {};
  for (const [symbol, pct] of Object.entries(out)) scaled[symbol] = roundPct(pct * 100 / total);
  return scaled;
}

async function allocationValues(env: Env): Promise<AllocationMap> {
  const stored = await getJson<AllocationMap>(env, 'target_allocation', {});
  const out: AllocationMap = {};
  for (const [key, value] of Object.entries(stored || {})) {
    const symbol = cleanSymbol(key); const pct = Number(value);
    if (symbol && Number.isFinite(pct) && pct > 0) out[symbol] = roundPct(pct);
  }
  if (Object.keys(out).length) return normalizeAllocation(ensureBaseAssets(out));
  const assets = await latestAssets(env);
  if (!assets.length) return { USDC: 100 };
  for (const a of assets) out[a.symbol] = roundPct(a.weight * 100);
  return normalizeAllocation(ensureBaseAssets(out));
}
// Ajusta el redondeo sobre el activo mayor para que la suma quede exacta en 100%.
function normalizeAllocation(alloc: AllocationMap): AllocationMap {
  const out: AllocationMap = { ...alloc };
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total > 0 && Math.abs(total - 100) > 0.01) {
    const largest = Object.keys(out).sort((a, b) => out[b] - out[a])[0];
    if (largest) out[largest] = roundPct(out[largest] + (100 - total));
  }
  return out;
}
function allocationToRunnerConfig(allocation: AllocationMap): Record<string, number | string> {
  const cfg: Record<string, number | string> = {};
  const symbols = Object.keys(allocation).filter((symbol) => !['USDC','USDT','USD'].includes(symbol));
  for (const [symbol, pct] of Object.entries(allocation)) {
    const weight = Math.max(0, pct) / 100;
    cfg[`${symbol}_TARGET_WEIGHT`] = Number(weight.toFixed(4));
    cfg[`${symbol}_MAX_WEIGHT`] = Number(Math.min(0.95, weight + 0.03).toFixed(4));
    if (symbol === 'USDC' || symbol === 'USDT') cfg[`${symbol}_MIN_WEIGHT`] = Number(weight.toFixed(4));
    else if (weight > 0) {
      const preserve = weight >= 0.03 ? Math.max(0.005, weight - 0.02) : Math.max(0.001, weight * 0.5);
      cfg[`${symbol}_MIN_WEIGHT`] = Number(Math.min(weight, preserve).toFixed(4));
    }
  }
  cfg.TARGET_ALLOCATION_JSON = JSON.stringify(allocation);
  cfg.TRADE_INCLUDE = Array.from(new Set(['BTC','ETH', ...symbols])).join(',');
  return cfg;
}
function allocationSuggestionFromAssets(assets: Array<{symbol: string; value_usd: number; weight: number}>): AllocationMap {
  if (!assets.length) return { USDC: 100 };
  const out: AllocationMap = {};
  const total = assets.reduce((a, x) => a + x.value_usd, 0) || 1;
  for (const a of assets) out[a.symbol] = roundPct((a.value_usd / total) * 100);
  if (!out.USDC) out.USDC = 0;
  out.USDC = Math.max(out.USDC, 45);
  const nonStable = Object.keys(out).filter((s) => !['USDC','USDT'].includes(s));
  const nonStableTotal = nonStable.reduce((a, s) => a + out[s], 0);
  const remaining = 100 - out.USDC;
  if (nonStable.length && nonStableTotal > 0) {
    for (const s of nonStable) out[s] = roundPct((out[s] / nonStableTotal) * remaining);
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  const largest = Object.keys(out).sort((a, b) => out[b] - out[a])[0] || 'USDC';
  out[largest] = roundPct((out[largest] || 0) + (100 - sum));
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v > 0.001));
}
async function allocationResponse(env: Env): Promise<Response> {
  const assets = await latestAssets(env);
  const allocation = await allocationValues(env);
  const symbols = Array.from(new Set([...Object.keys(allocation), ...assets.map((a) => a.symbol), 'USDC']));
  return json({ allocation, suggested: allocationSuggestionFromAssets(assets), assets: symbols.map((symbol) => { const a = assets.find((x) => x.symbol === symbol); return { symbol, target_pct: allocation[symbol] || 0, current_pct: a ? roundPct(a.weight * 100) : 0, value_usd: a?.value_usd || 0, held: Boolean(a) }; }).sort((a, b) => (b.value_usd - a.value_usd) || a.symbol.localeCompare(b.symbol)) });
}
async function updateAllocation(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const input = body.allocation || {};
  const out: AllocationMap = {};
  for (const [key, value] of Object.entries(input)) {
    const symbol = cleanSymbol(key); const pct = Number(value);
    if (!symbol || !Number.isFinite(pct)) continue;
    if (pct > 0) out[symbol] = roundPct(pct);
  }
  const sum = roundPct(Object.values(out).reduce((a, b) => a + b, 0));
  if (Math.abs(sum - 100) > 0.01) return json({ detail: `allocation_must_sum_100:${sum}` }, 400);
  const dropped = BASE_ASSETS.filter((symbol) => !(Number(out[symbol]) > 0));
  if (dropped.length) return json({ detail: `base_assets_required:${dropped.join(',')}`, base_assets: BASE_ASSETS }, 400);
  await putJson(env, 'target_allocation', out);
  await appendLogs(env, [{ ts: new Date().toISOString(), event: 'allocation_updated', data: { allocation: out, source: 'app' } }]);
  return json({ ok: true, allocation: out, sum });
}

async function applySupervisorChanges(env: Env, report: Report, logs: LogItem[]): Promise<Record<string, number>> {
  const current = await configValues(env);
  const applied: Record<string, number> = {};
  const candidates: Record<string, any>[] = [];
  for (const item of logs.slice(-60)) {
    if (item.event === 'codex_supervisor') {
      const data = item.data || {};
      candidates.push(data.param_changes || data.report?.param_changes || data.report?.parameters || {});
    }
  }
  candidates.push(report.summary?.supervisor?.param_changes || report.summary?.param_changes || {});
  const safetyDirection: Record<string, 'higher' | 'lower'> = {
    MIN_CONFIDENCE: 'higher',
    MIN_SELL_CONFIDENCE: 'higher',
    BASE_RESERVE_RATIO: 'higher',
    MIN_PROFIT_TO_SELL_PCT: 'higher',
    COOLDOWN_AFTER_TRADE_SECONDS: 'higher',
    PER_ASSET_COOLDOWN_SECONDS: 'higher',
    REVERSAL_COOLDOWN_SECONDS: 'higher',
    GROQ_TIMEOUT_SECONDS: 'higher',
    GROQ_MAX_COMPLETION_TOKENS: 'higher',
    ADAPTIVE_HALT_LOSS_USD: 'lower',
    MAX_TRADE_USDC: 'lower',
    MAX_SELL_NATIVE_USD: 'lower',
    MAX_TRADES_PER_DAY: 'lower',
    SELL_FRACTION: 'lower',
  };
  for (const changes of candidates) {
    for (const [key, value] of Object.entries(changes || {})) {
      const clamped = clampParam(key, value);
      if (clamped == null || current[key] === clamped) continue;
      const direction = safetyDirection[key];
      if (direction === 'higher' && clamped < current[key]) continue;
      if (direction === 'lower' && clamped > current[key]) continue;
      current[key] = clamped;
      applied[key] = clamped;
    }
  }
  if (!Object.keys(applied).length) return applied;
  const cfgStrat = await strategyConfig(env);
  if (cfgStrat.supervisor.auto_apply) {
    await putJson(env, 'config_values', current);
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'config_updated_by_supervisor', data: { applied, runner_cycle: report.cycle, guardrails: 'bounded' } }]);
    return applied;
  }
  // Sin auto_apply el cambio NO se aplica: queda pendiente de tu aprobacion.
  const previos: Record<string, number> = {};
  const base = await configValues(env);
  for (const k of Object.keys(applied)) previos[k] = base[k];
  await putJson(env, 'supervisor_pending', { ts: new Date().toISOString(), runner_cycle: report.cycle, cambios: applied, previos });
  await appendLogs(env, [{ ts: new Date().toISOString(), event: 'supervisor_change_pending', data: { cambios: applied, previos } }]);
  const resumen = Object.entries(applied).map(([k, v]) => `${k}: ${previos[k]} -> ${v}`).join(', ');
  await sendPush(env, 'supervisor', { kind: 'supervisor', title: 'El supervisor propone ajustes', body: resumen.slice(0, 160) }).catch(() => {});
  return {};
}




// --- Web Push ---------------------------------------------------------------
// Se envia push SIN payload: el service worker despierta y consulta la API.
// Asi solo hace falta firmar el JWT de VAPID (ES256) y no cifrar aes128gcm.
type PushSub = { endpoint: string; keys?: { p256dh?: string; auth?: string }; added_at?: string };

function b64uToBytes(v: string): Uint8Array {
  const pad = v.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidKey(env: Env): Promise<CryptoKey | null> {
  const pub = env.VAPID_PUBLIC_KEY || '';
  const priv = env.VAPID_PRIVATE_KEY || '';
  if (!pub || !priv) return null;
  const raw = b64uToBytes(pub);
  if (raw.length !== 65) return null;
  const jwk = { kty: 'EC', crv: 'P-256', d: priv, x: bytesToB64u(raw.slice(1, 33)), y: bytesToB64u(raw.slice(33, 65)), ext: true };
  return crypto.subtle.importKey('jwk', jwk as any, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidHeader(env: Env, endpoint: string): Promise<string | null> {
  const key = await vapidKey(env);
  if (!key) return null;
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com' })));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data));
  return `vapid t=${data}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

type PushAviso = { kind: string; title: string; body: string; ts: string };

async function sendPush(env: Env, reason: string, aviso?: Omit<PushAviso, 'ts'>): Promise<number> {
  const subs = await getJson<PushSub[]>(env, 'push_subs', []);
  if (!subs.length) return 0;
  // El push viaja sin payload; se deja aqui lo que el service worker debe mostrar.
  if (aviso) await putJson(env, 'last_push_aviso', { ...aviso, ts: new Date().toISOString() });
  let sent = 0;
  const alive: PushSub[] = [];
  for (const sub of subs) {
    try {
      const auth = await vapidHeader(env, sub.endpoint);
      if (!auth) break;
      const res = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: auth, TTL: '120', 'Content-Length': '0' } });
      // 404/410 = suscripcion muerta: se descarta para no reintentar siempre.
      if (res.status === 404 || res.status === 410) continue;
      alive.push(sub);
      if (res.ok) sent++;
    } catch { alive.push(sub); }
  }
  if (alive.length !== subs.length) await putJson(env, 'push_subs', alive);
  if (sent) await appendLogs(env, [{ ts: new Date().toISOString(), event: 'push_sent', data: { sent, reason } }]);
  return sent;
}

async function pushSubscribe(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  const endpoint = String(body?.subscription?.endpoint || body?.endpoint || '');
  if (!endpoint.startsWith('https://')) return json({ detail: 'invalid_subscription' }, 400);
  const subs = await getJson<PushSub[]>(env, 'push_subs', []);
  if (!subs.some((x) => x.endpoint === endpoint)) {
    subs.push({ endpoint, keys: body?.subscription?.keys || body?.keys, added_at: new Date().toISOString() });
    await putJson(env, 'push_subs', subs.slice(-20));
  }
  return json({ ok: true, subscribed: true, total: subs.length });
}




// --- Escalada de SEMI a AUTO por inactividad --------------------------------
// El reloj vive en el servidor para que no se reinicie al recargar la pagina ni
// se desincronice entre dispositivos. La pagina solo muestra el aviso y el
// minuto de gracia; quien decide si ya se cumplio el plazo es esta funcion.
const SEMI_IDLE_LIMIT_SECONDS = 1800;

async function markUserResponse(env: Env, motivo: string): Promise<void> {
  await putJson(env, 'last_user_response', { ts: new Date().toISOString(), motivo });
}

async function semiIdleSeconds(env: Env): Promise<number | null> {
  const stored = await getJson<{ ts?: string }>(env, 'last_user_response', {});
  if (!stored?.ts) return null;
  const at = Date.parse(stored.ts);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((Date.now() - at) / 1000));
}

// En modo AUTO las propuestas del bot se convierten solas en ordenes condicionadas.
// En SEMI no se toca nada: quedan esperando aceptacion manual desde el panel.
// Se respetan los mismos limites de capital que la ruta manual; lo que no cabe se
// omite en silencio en vez de fallar, porque esto corre en cada ciclo del cron.
async function autoAcceptProposals(env: Env): Promise<void> {
  if (await executionMode(env) !== 'auto') return;
  const res = await forecast(env);
  const data = await res.json() as any;
  const plans: any[] = data?.plans || [];
  if (!plans.length) return;

  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snapshot = latestPortfolioSnapshot(logs);
  const values = await configValues(env);
  const orders = await conditionalOrders(env);
  const activos = activeConditionalOrders(orders);
  const now = new Date().toISOString();

  let libre = latestFreeUsdc(logs, snapshot) - activos.filter((o) => o.side === 'BUY').reduce((t, o) => t + Number(o.amount_usdc || 0), 0);
  const aceptados: ConditionalOrder[] = [];

  for (const plan of plans) {
    const symbol = cleanSymbol(plan.symbol) || '';
    const side = String(plan.side || '').toUpperCase();
    if (!symbol || !['BUY', 'SELL'].includes(side)) continue;
    // Si ya hay una orden activa para ese par, no se duplica.
    if (activos.some((o) => o.symbol === symbol && o.side === side)) continue;
    const trigger = Number(plan.trigger_price_usd);
    const price = Number(plan.current_price_usd);
    if (!(trigger > 0) || !(price > 0)) continue;
    if (side === 'BUY' && trigger >= price) continue;
    if (side === 'SELL' && trigger <= price) continue;

    if (side === 'BUY') {
      const amt = roundUsd(Number(plan.amount_usdc || 0));
      if (amt < values.MIN_TRADE_USDC || amt > values.MAX_TRADE_USDC) continue;
      if (amt > libre) continue;
      libre -= amt;
      aceptados.push({ id: `auto-BUY-${symbol}`, symbol, side: 'BUY', trigger_price_usd: roundPrice(trigger), current_price_usd: roundPrice(price), amount_usdc: amt, status: 'active', note: 'Aceptada automaticamente (modo AUTO)', created_at: now, updated_at: now } as ConditionalOrder);
    } else {
      const val = roundUsd(Number(plan.value_usd || 0));
      if (val < values.MIN_SELL_NATIVE_USD || val > values.MAX_SELL_NATIVE_USD) continue;
      const enCartera = assetHeldUsd(snapshot, symbol);
      const yaVendiendo = activos.filter((o) => o.side === 'SELL' && o.symbol === symbol).reduce((t, o) => t + Number(o.value_usd || 0), 0);
      if (yaVendiendo + val > enCartera) continue;
      aceptados.push({ id: `auto-SELL-${symbol}`, symbol, side: 'SELL', trigger_price_usd: roundPrice(trigger), current_price_usd: roundPrice(price), value_usd: val, status: 'active', note: 'Aceptada automaticamente (modo AUTO)', created_at: now, updated_at: now } as ConditionalOrder);
    }
  }

  if (!aceptados.length) return;
  const conservar = orders.filter((o) => !aceptados.some((a) => a.id === o.id));
  await saveOrdersGuarded(env, conservar.concat(aceptados), 'auto_aceptacion');
  await appendLogs(env, [{ ts: now, event: 'proposals_auto_accepted', data: { count: aceptados.length, orders: aceptados.map((o) => `${o.side} ${o.symbol}`), free_usdc_restante: roundUsd(libre) } }]);
}


// Avisa por push cada vez que el runner reporta una operacion ejecutada.
const EVENTOS_OPERACION = ['trade_executed', 'trade', 'conditional_order_executed', 'forced_loss_sell_executed', 'trade_confirmation_uncertain'];

async function pushOnTrades(env: Env, incoming: LogItem[]): Promise<void> {
  const trades = incoming.filter((x) => x.event && EVENTOS_OPERACION.includes(x.event));
  if (!trades.length) return;
  const ultimo = trades[trades.length - 1];
  const last: any = ultimo?.data || {};
  const signal = last.signal || {};
  const result = last.result || {};
  const side = String(last.side || signal.action || 'OPERACION').toUpperCase();
  const symbol = String(last.symbol || signal.source || '').toUpperCase();
  const monto = Number(last.amount ?? last.amount_usdc ?? last.value_usd ?? result.amount ?? 0);
  const extra = trades.length > 1 ? ` (+${trades.length - 1} mas)` : '';
  let titulo = `${side} ${symbol} ejecutada${extra}`.trim();
  if (ultimo.event === 'conditional_order_executed') titulo = `Orden condicionada disparada: ${side} ${symbol}${extra}`;
  if (ultimo.event === 'forced_loss_sell_executed') titulo = `VENTA DE EMERGENCIA: ${symbol}${extra}`;
  if (ultimo.event === 'trade_confirmation_uncertain') titulo = `Revisar: ${side} ${symbol} sin confirmar`;
  await sendPush(env, `${ultimo.event}:${trades.length}`, {
    kind: 'operacion',
    title: titulo,
    body: `${monto ? `Monto ${roundUsd(monto)} - ` : ''}${String(result.description || signal.reason || last.reason || 'Movimiento registrado').slice(0, 120)}`,
  });
}

// Avisa por push solo cuando aparece una propuesta que no se habia notificado.
async function pushOnNewProposals(env: Env): Promise<void> {
  const subs = await getJson<PushSub[]>(env, 'push_subs', []);
  if (!subs.length) return;
  const res = await forecast(env);
  const data = await res.json() as any;
  // Antes la clave incluia el trigger exacto, que cambia con el precio en cada
  // ciclo: toda propuesta parecia nueva y llegaba un push por ciclo.
  const keys = (data?.plans || []).map((p: any) => `${p.side}:${p.symbol}`).sort();
  if (!keys.length) return;
  const seen = await getJson<string[]>(env, 'push_seen_plans', []);
  const nuevos = keys.filter((k: string) => !seen.includes(k));
  if (!nuevos.length) return;
  await putJson(env, 'push_seen_plans', keys.slice(-20));
  const p0 = (data?.plans || [])[0] || {};
  const conf = Math.round((Number(p0.confidence) || 0) * 100);
  await sendPush(env, `propuestas:${nuevos.length}`, {
    kind: 'propuesta',
    title: `${p0.side || ''} ${p0.symbol || ''} - propuesta del bot`.trim(),
    body: `Trigger ${roundPrice(Number(p0.trigger_price_usd) || 0)} (actual ${roundPrice(Number(p0.current_price_usd) || 0)}) - confianza ${conf}%`,
  });
}

// --- Velas e indicadores tecnicos -------------------------------------------
// La API publica de Crypto.com no requiere auth. Con el historial de cierres ya
// se pueden calcular RSI y MACD, que antes eran imposibles por falta de OHLC.
async function fetchCandles(symbol: string, timeframe = '1h', count = 120): Promise<number[]> {
  const url = `https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=${encodeURIComponent(symbol)}_USD&timeframe=${timeframe}&count=${count}`;
  const res = await fetch(url, { cf: { cacheTtl: 120, cacheEverything: true } as any });
  if (!res.ok) throw new Error(`candles_http_${res.status}`);
  const body = await res.json() as any;
  const rows = body?.result?.data || [];
  return rows.map((r: any) => Number(r.c)).filter((n: number) => Number.isFinite(n) && n > 0);
}

// --- Riesgo dimensionado por volatilidad ---------------------------------
// Un stop fijo igual para todos los activos se dispara dentro del ruido de un
// solo dia: el rango diario medio de BTC ronda 3.5% y el de POL 6.7%, asi que
// un stop del 3% vendia POL por fluctuacion normal. Estas funciones miden el
// rango real de cada moneda para que el stop quede por fuera del ruido.
const RIESGO_STOP_K = 1.2;       // stop = 1.2 x rango diario
const RIESGO_OBJETIVO_K = 2.0;   // objetivo = 2.0 x rango diario
const RIESGO_STOP_MIN = 0.03, RIESGO_STOP_MAX = 0.12;
const RIESGO_OBJ_MIN = 0.04, RIESGO_OBJ_MAX = 0.20;
const RIESGO_MAX_SIMBOLOS = 8;

type Vela = { h: number; l: number; c: number };

async function fetchOHLC(symbol: string, timeframe = '1h', count = 168): Promise<Vela[]> {
  const url = `https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=${encodeURIComponent(symbol)}_USD&timeframe=${timeframe}&count=${count}`;
  // 6 h de cache de borde: la volatilidad cambia despacio y asi no se gasta
  // ni una escritura de KV ni una peticion por ciclo.
  const res = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } as any });
  if (!res.ok) throw new Error(`candles_http_${res.status}`);
  const rows = ((await res.json()) as any)?.result?.data || [];
  return rows
    .map((r: any) => ({ h: Number(r.h), l: Number(r.l), c: Number(r.c) }))
    .filter((v: Vela) => Number.isFinite(v.h) && Number.isFinite(v.l) && Number.isFinite(v.c) && v.c > 0);
}

// Rango diario medio en fraccion (0.0347 = 3.47%), sobre los ultimos 7 dias.
function rangoDiarioDeVelas(velas: Vela[]): number | null {
  if (velas.length < 48) return null;
  const rangos: number[] = [];
  for (let i = 0; i + 24 <= velas.length; i += 24) {
    const dia = velas.slice(i, i + 24);
    const alto = Math.max(...dia.map((v) => v.h));
    const bajo = Math.min(...dia.map((v) => v.l));
    const medio = dia.reduce((a, v) => a + v.c, 0) / dia.length;
    if (medio > 0 && alto > bajo) rangos.push((alto - bajo) / medio);
  }
  if (!rangos.length) return null;
  return rangos.reduce((a, b) => a + b, 0) / rangos.length;
}

// Percentil 75 de las subidas diarias del activo, en porcentaje. Es el umbral
// a partir del cual una subida de 24h deja de ser un dia normal y pasa a ser un
// pico. Un limite unico (2.5%) bloqueaba el 20-25% de los dias verdes en
// BTC/ETH pero el 47-60% en SOL, CRO, POL y LINK.
function umbralSubidaDeVelas(cierres: number[]): number | null {
  if (cierres.length < 10) return null;
  const subidas: number[] = [];
  for (let i = 1; i < cierres.length; i++) {
    const ch = ((cierres[i] - cierres[i - 1]) / cierres[i - 1]) * 100;
    if (ch > 0) subidas.push(ch);
  }
  if (subidas.length < 5) return null;
  subidas.sort((a, b) => a - b);
  return subidas[Math.min(subidas.length - 1, Math.floor(subidas.length * 0.75))];
}

function recorta(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// Devuelve los mapas 'BTC:0.042,ETH:0.054' que consume risk_levels_for() del
// runner. Un simbolo que falle se omite: el runner cae a su valor global.
async function mapasDeRiesgo(simbolos: string[]): Promise<{ stop: string; objetivo: string; persecucion: string; detalle: Record<string, any> }> {
  const unicos = Array.from(new Set(simbolos.map((x) => String(x || '').trim().toUpperCase())))
    .filter((x) => x && !STABLES.has(x))
    .slice(0, RIESGO_MAX_SIMBOLOS);
  const stop: string[] = [], objetivo: string[] = [], persec: string[] = [], detalle: Record<string, any> = {};
  const medidos = await Promise.all(unicos.map(async (sym) => {
    try {
      const [velas, diarias] = await Promise.all([fetchOHLC(sym), fetchOHLC(sym, '1D', 31)]);
      return { sym, rango: rangoDiarioDeVelas(velas), subida: umbralSubidaDeVelas(diarias.map((v) => v.c)) };
    } catch { return { sym, rango: null as number | null, subida: null as number | null }; }
  }));
  for (const { sym, rango, subida } of medidos) {
    if (subida !== null) persec.push(`${sym}:${recorta(subida, 1, 12).toFixed(2)}`);
    if (rango === null) { detalle[sym] = { rango_diario_pct: null, motivo: 'sin_datos' }; continue; }
    const s = recorta(rango * RIESGO_STOP_K, RIESGO_STOP_MIN, RIESGO_STOP_MAX);
    const o = recorta(rango * RIESGO_OBJETIVO_K, RIESGO_OBJ_MIN, RIESGO_OBJ_MAX);
    stop.push(`${sym}:${s.toFixed(4)}`);
    objetivo.push(`${sym}:${o.toFixed(4)}`);
    detalle[sym] = {
      rango_diario_pct: Math.round(rango * 10000) / 100,
      stop_pct: Math.round(s * 10000) / 100,
      objetivo_pct: Math.round(o * 10000) / 100,
      max_subida_24h_pct: subida === null ? null : Math.round(recorta(subida, 1, 12) * 100) / 100,
    };
  }
  return { stop: stop.join(','), objetivo: objetivo.join(','), persecucion: persec.join(','), detalle };
}

// RSI con suavizado de Wilder.
function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = [prev];
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}

// Devuelve linea MACD, señal e histograma (actual y previo, para detectar cruce).
function computeMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal + 1) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((v, i) => emaFast[i + offset] - v);
  const signalLine = emaSeries(macdLine, signal);
  if (!signalLine.length) return null;
  const off2 = macdLine.length - signalLine.length;
  const hist = signalLine.map((v, i) => macdLine[i + off2] - v);
  const n = hist.length;
  return {
    macd: Math.round(macdLine[macdLine.length - 1] * 1e6) / 1e6,
    signal: Math.round(signalLine[signalLine.length - 1] * 1e6) / 1e6,
    hist: Math.round(hist[n - 1] * 1e6) / 1e6,
    prev_hist: n > 1 ? Math.round(hist[n - 2] * 1e6) / 1e6 : 0,
  };
}


// Serie completa de RSI (no solo el ultimo valor) para poder graficarlo.
function computeRSISeries(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  const valor = () => avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
  out[period] = valor();
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    out[i] = valor();
  }
  return out;
}

// Series MACD alineadas al indice de cierres, para dibujarlas sobre el mismo eje X.
function computeMACDSeries(closes: number[], fast = 12, slow = 26, signal = 9) {
  const vacio = { macd: [] as Array<number | null>, signal: [] as Array<number | null>, hist: [] as Array<number | null> };
  if (closes.length < slow + signal) return vacio;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((v, i) => emaFast[i + offset] - v);
  const signalLine = emaSeries(macdLine, signal);
  if (!signalLine.length) return vacio;
  const off2 = macdLine.length - signalLine.length;
  const hist = signalLine.map((v, i) => macdLine[i + off2] - v);
  const n = closes.length;
  const pad = <T,>(arr: T[], largo: number): Array<T | null> => new Array(largo - arr.length).fill(null).concat(arr);
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return { macd: pad(macdLine.map(r), n), signal: pad(signalLine.map(r), n), hist: pad(hist.map(r), n) };
}

async function indicatorsFor(symbol: string, timeframe = '1h', conSeries = false) {
  const closes = await fetchCandles(symbol, timeframe);
  const base = { symbol, timeframe, candles: closes.length, price: closes[closes.length - 1] ?? null, rsi: computeRSI(closes), macd: computeMACD(closes) };
  if (!conSeries) return base;
  return { ...base, series: { close: closes, rsi: computeRSISeries(closes), ...computeMACDSeries(closes) } };
}

async function indicatorsResponse(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const symbol = cleanSymbol(url.searchParams.get('symbol') || 'BTC') || 'BTC';
  const timeframe = url.searchParams.get('timeframe') || '1h';
  try {
    const conSeries = url.searchParams.get('series') === '1';
    return json(await indicatorsFor(symbol, timeframe, conSeries));
  } catch (e: any) {
    return json({ symbol, error: String(e?.message || e) }, 502);
  }
}



async function supervisorPendingResponse(env: Env): Promise<Response> {
  return json(await getJson<any>(env, 'supervisor_pending', null) || { pendiente: null });
}

async function resolveSupervisor(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const pend = await getJson<any>(env, 'supervisor_pending', null);
  if (!pend?.cambios) return json({ detail: 'sin_cambios_pendientes' }, 404);
  const aceptar = body.accion === 'aceptar';
  if (aceptar) {
    const actual = await configValues(env);
    const aplicados: Record<string, number> = {};
    for (const [k, v] of Object.entries(pend.cambios as Record<string, number>)) {
      const limitado = clampParam(k, v);
      if (limitado == null) continue;
      actual[k] = limitado;
      aplicados[k] = limitado;
    }
    await putJson(env, 'config_values', actual);
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'supervisor_change_accepted', data: { aplicados } }]);
  } else {
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'supervisor_change_rejected', data: { cambios: pend.cambios } }]);
  }
  await env.CRYPTO_BOT_STATE.delete('supervisor_pending');
  await markUserResponse(env, aceptar ? 'supervisor_aceptado' : 'supervisor_rechazado');
  return json({ ok: true, accion: aceptar ? 'aceptado' : 'rechazado' });
}


// --- Guardian unico de capital ----------------------------------------------
// Antes cada camino (auto-aceptacion, grid, dca, rsi, macd, manual) comprobaba
// el capital por su cuenta y entre ellos se pisaban: acabaron 3 ordenes de $5
// comprometiendo $15 contra $10.26 libres, y dos BUY POL duplicadas.
// Aqui se concentra el invariante y se aplica SIEMPRE antes de guardar:
//   1. una sola orden activa por par simbolo+lado (gana la mas reciente)
//   2. la suma de compras activas nunca supera el USDC libre
//   3. la suma de ventas por activo nunca supera lo que se tiene
// Lo que no cabe no se borra: se pausa, para que quede rastro de por que.
// Estrategias que colocan VARIOS disparos del mismo par a precios distintos.
// Sus ordenes son peldanos de una escalera, no duplicados, y por eso quedan
// fuera de la regla de "una orden activa por par".
const ESCALONADAS = ['grid-', 'dca-', 'rsi-', 'macd-', 'short-'];

function enforceCapitalLimits(
  orders: ConditionalOrder[],
  freeUsdc: number,
  snapshot: { total_usd: number; assets: Record<string, any> } | null,
  nucleo: Set<string> = new Set(['BTC', 'ETH']),
): { orders: ConditionalOrder[]; pausadas: Array<{ id: string; symbol: string; side: string; motivo: string }> } {
  const pausadas: Array<{ id: string; symbol: string; side: string; motivo: string }> = [];
  const ahora = new Date().toISOString();
  const marcaPausa = (o: ConditionalOrder, motivo: string): ConditionalOrder => {
    pausadas.push({ id: o.id, symbol: o.symbol, side: o.side, motivo });
    return { ...o, status: 'paused', updated_at: ahora, note: `${motivo}`.slice(0, 180) };
  };

  const activas = orders.filter((o) => o.status === 'active');
  const resto = orders.filter((o) => o.status !== 'active');
  const fecha = (o: ConditionalOrder) => Date.parse(o.updated_at || (o as any).created_at || '') || 0;
  // Con capital escaso el orden decide quien se queda. Antes solo contaba la
  // antiguedad y un grid de POL podia desplazar a una compra de BTC, justo lo
  // contrario del objetivo de acumular BTC. Prioridad: nucleo primero, y dentro
  // de cada grupo las decisiones explicitas (manuales/aceptadas) antes que las
  // generadas por estrategia; a igualdad, la mas reciente.
  const generada = (o: ConditionalOrder) => ESCALONADAS.some((p) => String(o.id).startsWith(p));
  const prioridad = (o: ConditionalOrder) => (nucleo.has(o.symbol) ? 2 : 0) + (generada(o) ? 0 : 1);
  const ordenadas = activas.slice().sort((a, b) => (prioridad(b) - prioridad(a)) || (fecha(b) - fecha(a)));

  const vistoPar = new Set<string>();
  const sobrevivientes: ConditionalOrder[] = [];
  const pausas: ConditionalOrder[] = [];
  let presupuesto = Math.max(0, freeUsdc);
  const vendidoPorSimbolo = new Map<string, number>();

  for (const o of ordenadas) {
    // Un grid son VARIOS niveles del mismo par a precios distintos, a proposito.
    // La regla "una orden activa por par" existe para evitar duplicados
    // accidentales; aplicada al grid pausaba todos sus niveles menos uno, el
    // generador los regeneraba y se entraba en un bucle de escrituras.
    //
    // DCA, RSI y MACD son igual de escalonadas y nadie las eximio: con
    // auto-BUY-BTC activa quedaban pausadas dca-BTC, macd-BTC y una compra
    // aceptada, las tres con el motivo "Duplicada". Es decir, la escalera de
    // acumulacion de BTC -el objetivo principal- se quedaba en un solo peldano.
    // No son duplicados: son disparos a precios distintos. El limite real lo
    // pone el presupuesto de mas abajo, que si suma todas las compras activas.
    const escalonada = ESCALONADAS.some((pre) => String(o.id).startsWith(pre));
    const par = escalonada ? `escalon:${o.id}` : `${o.symbol}:${o.side}`;
    if (vistoPar.has(par)) {
      pausas.push(marcaPausa(o, `Duplicada: ya hay una orden ${o.side} activa para ${o.symbol}`));
      continue;
    }
    if (o.side === 'BUY') {
      const monto = Number(o.amount_usdc || 0);
      if (monto > presupuesto + 1e-9) {
        pausas.push(marcaPausa(o, `Sin capital: requiere ${roundUsd(monto)} y quedan ${roundUsd(presupuesto)} USDC libres`));
        continue;
      }
      presupuesto -= monto;
    } else {
      const monto = Number(o.value_usd || 0);
      const enCartera = assetHeldUsd(snapshot, o.symbol);
      const yaComprometido = vendidoPorSimbolo.get(o.symbol) || 0;
      if (yaComprometido + monto > enCartera + 1e-9) {
        pausas.push(marcaPausa(o, `Sin saldo de ${o.symbol}: requiere ${roundUsd(monto)} y hay ${roundUsd(Math.max(0, enCartera - yaComprometido))}`));
        continue;
      }
      vendidoPorSimbolo.set(o.symbol, yaComprometido + monto);
    }
    vistoPar.add(par);
    sobrevivientes.push(o);
  }

  return { orders: resto.concat(sobrevivientes, pausas), pausadas };
}

// Punto unico de escritura: ninguna ruta guarda ordenes sin pasar por aqui.
async function saveOrdersGuarded(env: Env, orders: ConditionalOrder[], origen: string): Promise<void> {
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snapshot = latestPortfolioSnapshot(logs);
  const libre = latestFreeUsdc(logs, snapshot);
  const cfg = await strategyConfig(env);
  const nucleo = new Set(String(cfg.universo?.nucleo || 'BTC,ETH').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
  const { orders: finales, pausadas } = enforceCapitalLimits(orders, libre, snapshot, nucleo);
  await putJson(env, 'conditional_orders', finales);
  if (pausadas.length) {
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'ordenes_pausadas_por_capital', data: { origen, usdc_libre: roundUsd(libre), pausadas } }]);
  }
}


// El invariante se revalida cada ciclo, no solo al crear ordenes: si el USDC libre
// baja (por una compra ejecutada o un retiro), lo que ya no cabe se pausa solo.
async function enforceNow(env: Env, origen: string): Promise<Response> {
  const antes = await conditionalOrders(env);
  await saveOrdersGuarded(env, antes, origen);
  const despues = await conditionalOrders(env);
  const activas = despues.filter((o) => o.status === 'active');
  return json({
    ok: true,
    activas: activas.length,
    pausadas: despues.filter((o) => o.status === 'paused').length,
    compras_comprometidas: roundUsd(activas.filter((o) => o.side === 'BUY').reduce((t, o) => t + Number(o.amount_usdc || 0), 0)),
    ordenes: activas.map((o) => `${o.side} ${o.symbol} ${roundUsd(Number(o.amount_usdc || o.value_usd || 0))}`),
  });
}


// Sonda de escritura: putJson absorbe los fallos para no matar el ciclo, pero eso
// los volvia invisibles y el runner solo aparecia como "late" sin motivo. Esto
// permite distinguir "el runner no corre" de "corre pero no puede guardar".
async function kvHealthResponse(env: Env): Promise<Response> {
  const marca = new Date().toISOString();
  let escribe = false;
  let detalle = '';
  try {
    await env.CRYPTO_BOT_STATE.put('kv_probe', marca);
    const leido = await env.CRYPTO_BOT_STATE.get('kv_probe');
    escribe = leido === marca;
    if (!escribe) detalle = 'la escritura no se reflejo al leer';
  } catch (e: any) {
    detalle = String(e?.message || e);
  }
  return json({
    escribe_ok: escribe,
    detalle,
    diagnostico: escribe
      ? 'KV acepta escrituras: si el runner sigue atrasado, el problema esta en GitHub Actions.'
      : 'KV NO acepta escrituras (cuota diaria agotada). El runner ejecuta pero su estado no se guarda; se restablece a las 00:00 UTC.',
    reinicio_utc: '00:00',
  });
}

// --- Libro de flujos: distingue operaciones de ingresos/egresos --------------
// Un cambio en la cantidad de un activo que NO viene de una compra/venta solo
// puede ser un deposito o un retiro. Separarlo es imprescindible: sin esto, meter
// dinero parece "ganancia" y sacarlo parece "perdida".
type Flujo = { ts: string; symbol: string; amount: number; value_usd: number; kind: 'deposito' | 'retiro' | 'conversion' | 'operacion' };

// Un cambio de USDT a USDC dentro del exchange mueve dos saldos a la vez y sin
// esto se registraria como un retiro falso mas un deposito falso. Se detectan
// los pares opuestos de valor equivalente en el mismo instante y se marcan como
// conversion, para que no ensucien el total de ingresos y egresos.
const STABLES = new Set(['USDC', 'USDT', 'USD', 'DAI', 'BUSD']);

function marcarConversiones(flujos: Flujo[]): Flujo[] {
  // Regla: la gente ingresa y retira DINERO (stablecoins), no altcoins. Por eso:
  //  1. Todo movimiento de un criptoactivo sin operacion registrada es una
  //     OPERACION no registrada (p. ej. una compra perdida en un apagon de KV),
  //     nunca un deposito. Antes la compra del grid aparecia como "retiro USDC +
  //     deposito POL" y falseaba el resultado.
  //  2. El stablecoin del mismo instante con signo opuesto es la otra pata de esa
  //     operacion.
  //  3. Dos stablecoins opuestos en el mismo instante son una CONVERSION. Se
  //     admite hasta 5% de diferencia: un swap USDT->USDC real costo 3.1%.
  //  4. Lo que queda en stablecoins si es dinero que entro o salio.
  const out = flujos.map((f) => ({ ...f }));
  const esStable = (f: Flujo) => STABLES.has(f.symbol);
  for (const f of out) if (!esStable(f)) (f as any).kind = 'operacion';
  for (const c of out) {
    if ((c as any).kind !== 'operacion' || esStable(c)) continue;
    for (const st of out) {
      if (!esStable(st) || (st as any).kind === 'operacion' || (st as any).kind === 'conversion') continue;
      if (st.ts !== c.ts || (st.amount > 0) === (c.amount > 0)) continue;
      (st as any).kind = 'operacion';
      break;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[i] as any;
    if (!esStable(out[i]) || a.kind === 'operacion' || a.kind === 'conversion') continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j] as any;
      if (!esStable(out[j]) || b.kind === 'operacion' || b.kind === 'conversion') continue;
      if (out[i].ts !== out[j].ts || (out[i].amount > 0) === (out[j].amount > 0)) continue;
      const mayor = Math.max(out[i].value_usd, out[j].value_usd) || 1;
      if (Math.abs(out[i].value_usd - out[j].value_usd) / mayor > 0.05) continue;
      a.kind = 'conversion'; b.kind = 'conversion';
      break;
    }
  }
  return out;
}

// Solo cantidades: guardar tambien el precio hacia que el estado cambiara cada
// ciclo (el precio siempre se mueve) y disparaba una escritura KV inutil.
function amountsFromSnapshot(item: LogItem | null): Record<string, { amount: number; price: number }> {
  const out: Record<string, { amount: number; price: number }> = {};
  const assets = (item?.data as any)?.assets || {};
  for (const [sym, v] of Object.entries(assets) as Array<[string, any]>) {
    const clean = cleanSymbol(sym);
    if (!clean) continue;
    const amount = Number(v.amount || 0);
    const usd = Number(v.native_usd || 0);
    out[clean] = { amount, price: amount > 0 ? usd / amount : 0 };
  }
  return out;
}

async function reconcileCashFlows(env: Env, incoming: LogItem[]): Promise<void> {
  const snaps = incoming.filter((x) => x.event === 'portfolio_snapshot' && x.ts).sort((a, b) => Date.parse(a.ts!) - Date.parse(b.ts!));
  if (snaps.length < 1) return;
  const prevStored = await getJson<{ ts?: string; amounts?: Record<string, { amount: number; price: number }>; cantidades?: Record<string, number> }>(env, 'flow_last_snapshot', {});
  if (!prevStored.amounts && prevStored.cantidades) {
    prevStored.amounts = {};
    for (const [k, q] of Object.entries(prevStored.cantidades)) prevStored.amounts[k] = { amount: q, price: 0 };
  }
  const mercado = latestMarket(incoming);
  const nuevos: Flujo[] = [];
  let anterior = prevStored?.amounts || null;
  let anteriorTs: string | null = null;

  for (const snap of snaps) {
    const actual = amountsFromSnapshot(snap);
    if (anterior) {
      // Cantidades movidas por operaciones reales entre ambos snapshots.
      const movidas: Record<string, number> = {};
      for (const log of incoming) {
        if (log.event !== 'trade_executed' || !log.ts) continue;
        const t = Date.parse(log.ts);
        // 'incoming' ya son solo los logs nuevos de este reporte, asi que no hace
        // falta un limite inferior persistido: basta acotar por arriba. Eso permite
        // guardar el estado sin timestamp y ahorrar una escritura KV por ciclo.
        if (anteriorTs && !(t > Date.parse(anteriorTs))) continue;
        if (!(t <= Date.parse(snap.ts!))) continue;
        // Se usa lo que reporto el exchange: result.amount y result.to_amount traen
        // AMBAS patas de la operacion, con signo y cada una en su moneda (una venta
        // es p. ej. -52.36 POL y +5.56 USDC). Antes se usaba el parametro 'amount',
        // que no tiene signo y en las compras va en dolares: una venta se sumaba en
        // vez de restarse (duplicaba el error en lugar de cancelarlo) y la pata en
        // stablecoin ni se descontaba, asi que aparecia como deposito falso.
        const r: any = (log.data as any)?.result || {};
        for (const pata of [r.amount, r.to_amount]) {
          const moneda = cleanSymbol(pata?.currency);
          const q = Number(pata?.amount);
          if (moneda && Number.isFinite(q)) movidas[moneda] = (movidas[moneda] || 0) + q;
        }
      }
      for (const sym of new Set([...Object.keys(anterior), ...Object.keys(actual)])) {
        const antes = anterior[sym]?.amount || 0;
        const ahora = actual[sym]?.amount || 0;
        const porTrades = movidas[sym] || 0;
        const residuo = ahora - antes - porTrades;
        // Al dejar de guardar precios para ahorrar una escritura KV, un activo
        // que se vacia por completo quedaba sin precio y su retiro se perdia:
        // por eso una conversion USDT->USDC se veia solo como deposito.
        const precio = actual[sym]?.price || anterior[sym]?.price
          || mercado.get(sym)?.price_usd || (STABLES.has(sym) ? 1 : 0);
        const valor = Math.abs(residuo) * precio;
        // Umbral para no registrar polvo ni redondeos del exchange.
        if (valor < 0.5) continue;
        nuevos.push({ ts: snap.ts!, symbol: sym, amount: Math.round(residuo * 1e8) / 1e8, value_usd: roundUsd(valor), kind: residuo > 0 ? 'deposito' : 'retiro' });
      }
    }
    anterior = actual;
    anteriorTs = snap.ts!;
  }

  // Solo cantidades: guardar 'anterior' incluia el precio, que cambia cada ciclo
  // y forzaba una escritura KV aunque no se hubiera movido nada.
  const soloCantidades: Record<string, number> = {};
  for (const [k, v] of Object.entries(anterior || {})) soloCantidades[k] = v.amount;
  await putJson(env, 'flow_last_snapshot', { cantidades: soloCantidades });
  if (!nuevos.length) return;
  const libro = await getJson<Flujo[]>(env, 'cash_flows', []);
  await putJson(env, 'cash_flows', marcarConversiones(libro.concat(nuevos)).slice(-200));
  await appendLogs(env, nuevos.map((f) => ({ ts: f.ts, event: 'flujo_externo', data: f as any })));
}

async function ledgerResponse(env: Env): Promise<Response> {
  const libro = marcarConversiones(await getJson<Flujo[]>(env, 'cash_flows', []));
  const depositos = libro.filter((f) => f.kind === 'deposito').reduce((t, f) => t + f.value_usd, 0);
  const retiros = libro.filter((f) => f.kind === 'retiro').reduce((t, f) => t + f.value_usd, 0);
  const history = await getJson<PortfolioPoint[]>(env, 'portfolio_history', []);
  const actual = history[history.length - 1]?.value_usd || 0;

  // El valor inicial debe ser el del momento en que EMPEZO a registrarse el libro,
  // no el punto mas antiguo del historial: restar depositos del dia 21 en adelante
  // contra un valor del dia 14 mezcla dos periodos y finge una perdida enorme.
  // El ancla es el ultimo punto ESTRICTAMENTE ANTERIOR al primer flujo: si se toma
  // uno posterior, ese primer deposito ya esta dentro del valor inicial y ademas se
  // resta como deposito, contandolo dos veces.
  const primerFlujo = libro.map((f) => f.ts).sort()[0] || null;
  const previos = primerFlujo ? history.filter((p) => p.ts < primerFlujo) : [];
  const anclaje = previos.length
    ? previos[previos.length - 1]
    : (primerFlujo ? history.find((p) => p.ts >= primerFlujo) : history[0]) || history[0];
  const inicio = anclaje?.value_usd || 0;
  const resultado = actual - inicio - depositos + retiros;

  // Medida independiente y sin supuestos: la suma del P/L de las operaciones ya
  // cerradas. No depende de depositos, retiros ni del anclaje del historial.
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const durables = await getJson<MovementItem[]>(env, 'movement_history', []);
  const desdeLogs = logs.map(movementFromTradeLog).filter(Boolean) as MovementItem[];
  const vistos = new Set<string>();
  let realizado = 0; let cerradas = 0;
  // La friccion se contabiliza aparte del P/L: cambiar stablecoins no es una
  // tesis que gane o pierda, pero cuesta dinero real y tiene que verse.
  let friccion = 0; let conversiones = 0;
  for (const m of durables.concat(desdeLogs)) {
    if (vistos.has(m.id)) continue;
    vistos.add(m.id);
    const f = friccionDeMovimiento(m);
    if (f !== null) { friccion += f; conversiones++; }
    if (!m.pnl_known) continue;
    realizado += Number(m.pnl_usd) || 0; cerradas++;
  }
  return json({
    flows: libro.slice(-50).reverse(),
    resumen: {
      depositos_usd: roundUsd(depositos),
      retiros_usd: roundUsd(retiros),
      valor_inicial_usd: roundUsd(inicio),
      valor_actual_usd: roundUsd(actual),
      resultado_trading_usd: roundUsd(resultado),
      resultado_realizado_usd: roundUsd(realizado),
      operaciones_cerradas: cerradas,
      costo_friccion_usd: roundUsd(friccion),
      conversiones: conversiones,
      desde: anclaje?.ts || null,
    },
  });
}

// --- Modalidades de trading -------------------------------------------------
// Grid y DCA se implementan generando ordenes condicionadas desde el worker:
// el motor ya sabe ejecutarlas, asi que no hace falta tocar el Python de trading.
// Rebalancer / dip-buyer / momentum son banderas que el motor YA respeta; aqui
// solo dejan de estar hardcodeadas para poder ajustarlas desde el panel.
type StrategyCfg = {
  grid: { enabled: boolean; symbol: string; levels: number; step_pct: number; amount_usdc: number };
  dca: { enabled: boolean; symbol: string; interval_hours: number; amount_usdc: number; dip_pct: number };
  rebalancer: { enabled: boolean; sells_without_profit: boolean };
  proteccion: { strong_ai_sells_without_profit: boolean; defensive_stop_sells: boolean; sell_with_unknown_cost: boolean; strong_ai_confidence: number };
  supervisor: { auto_apply: boolean };
  usdt: { operable: boolean };
  universo: { nucleo: string; max_extra: number; excluir: string };
  cro: { compras_habilitadas: boolean };
  dip_buyer: { enabled: boolean; max_chase_pct: number };
  momentum: { enabled: boolean; breakout_min_confidence: number; prefilter: number };
  rsi: { enabled: boolean; symbol: string; timeframe: string; period: number; oversold: number; overbought: number; amount_usdc: number };
  macd: { enabled: boolean; symbol: string; timeframe: string; amount_usdc: number };
  short: { enabled: boolean; profit_pct: number; stop_pct: number; min_confidence_pct: number };
  long: { enabled: boolean; profit_pct: number; stop_pct: number; min_confidence_pct: number };
};

// Las tres ultimas reflejan el comportamiento ACTUAL del motor: se dejan como
// estan para que activar el panel no altere por si solo como opera el bot.
const GRID_MIN_NIVELES = 2;

const STRATEGY_DEFAULTS: StrategyCfg = {
  grid: { enabled: false, symbol: 'BTC', levels: 3, step_pct: 1.5, amount_usdc: 5 },
  dca: { enabled: false, symbol: 'BTC', interval_hours: 12, amount_usdc: 5, dip_pct: 0.5 },
  rebalancer: { enabled: true, sells_without_profit: false },
  proteccion: { strong_ai_sells_without_profit: false, defensive_stop_sells: true, sell_with_unknown_cost: false, strong_ai_confidence: 0.88 },
  supervisor: { auto_apply: false },
  usdt: { operable: false },
  universo: { nucleo: 'BTC,ETH', max_extra: 4, excluir: '' },
  // Refleja el valor que el motor aplicaba en silencio (CRO_BUY_DISABLED=YES).
  cro: { compras_habilitadas: false },
  dip_buyer: { enabled: true, max_chase_pct: 2.5 },
  momentum: { enabled: true, breakout_min_confidence: 0.82, prefilter: 6 },
  rsi: { enabled: false, symbol: 'BTC', timeframe: '1h', period: 14, oversold: 30, overbought: 70, amount_usdc: 5 },
  macd: { enabled: false, symbol: 'BTC', timeframe: '1h', amount_usdc: 5 },
  short: { enabled: false, profit_pct: -3.0, stop_pct: 3.5, min_confidence_pct: 70 },
  long: { enabled: false, profit_pct: 3.0, stop_pct: -3.5, min_confidence_pct: 70 },
};

function mergeStrategy(stored: any): StrategyCfg {
  const out: any = JSON.parse(JSON.stringify(STRATEGY_DEFAULTS));
  for (const key of Object.keys(out)) {
    const src = stored?.[key];
    if (!src || typeof src !== 'object') continue;
    for (const field of Object.keys(out[key])) {
      const v = src[field];
      if (v === undefined || v === null) continue;
      if (typeof out[key][field] === 'boolean') out[key][field] = Boolean(v);
      else if (typeof out[key][field] === 'number') { const n = Number(v); if (Number.isFinite(n)) out[key][field] = n; }
      else out[key][field] = String(v);
    }
  }
  return out as StrategyCfg;
}

async function strategyConfig(env: Env): Promise<StrategyCfg> {
  return mergeStrategy(await getJson<any>(env, 'strategies_config', null));
}

async function strategiesResponse(env: Env): Promise<Response> {
  const cfg = await strategyConfig(env);
  // Diagnostico de capital para que el panel explique por que un grid no corre.
  const logsDiag = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snapDiag = latestPortfolioSnapshot(logsDiag);
  const libreDiag = latestFreeUsdc(logsDiag, snapDiag);
  const nivelDiag = roundUsd(cfg.grid.amount_usdc);
  const posiblesDiag = nivelDiag > 0 ? Math.floor(libreDiag / nivelDiag) : 0;
  const gridDiag = {
    usdc_libre: roundUsd(libreDiag),
    usd_por_nivel: nivelDiag,
    niveles_pedidos: cfg.grid.levels,
    niveles_financiables: posiblesDiag,
    minimo_requerido: GRID_MIN_NIVELES,
    usdc_necesario: roundUsd(nivelDiag * GRID_MIN_NIVELES),
    puede_operar: posiblesDiag >= GRID_MIN_NIVELES,
  };
  return json({ strategies: cfg, defaults: STRATEGY_DEFAULTS, grid_diagnostico: gridDiag, engine_notes: {
    grid: 'Genera escalera de ordenes condicionadas desde el worker.',
    dca: 'Compra programada como orden condicionada; requiere USDC libre.',
    rebalancer: 'Implementado en el motor (estrategia REBALANCE).',
    dip_buyer: 'Implementado en el motor (buy_low_policy).',
    momentum: 'Score de ranking del motor (7d y 24h) + prefiltro IA.',
    rsi: 'Velas de Crypto.com + RSI de Wilder; compra en sobreventa, vende en sobrecompra.',
    macd: 'Velas de Crypto.com + cruce de histograma MACD.',
    short: 'Venta defensiva en BTC con toma de ganancias al -3% y nivel de defensa al +3.5%; requiere confianza mínima.',
    long: 'Compra agresiva en BTC con toma de ganancias al +3% y nivel de defensa al -3.5%; requiere confianza mínima.',
    cro: 'El motor traia las compras de CRO desactivadas por defecto: solo lo reduce vendiendo si excede su objetivo.',
    universo: 'Nucleo protegido de la rotacion + tope de activos extra para no fragmentar el capital.',
    usdt: 'Libera el saldo en USDT para poder venderlo contra USDT_USD y convertirlo en capital operable.',
  } });
}

async function updateStrategies(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const next = mergeStrategy({ ...(await strategyConfig(env)), ...(body.strategies || {}) });
  const values = await configValues(env);
  const maxBuy = Number(values.MAX_TRADE_USDC || 12);
  const minBuy = Number(values.MIN_TRADE_USDC || 5);
  for (const k of ['grid', 'dca'] as const) {
    const amt = Number((next as any)[k].amount_usdc);
    if (next[k].enabled && (amt < minBuy || amt > maxBuy)) return json({ detail: `${k}_amount_must_be_${minBuy}_${maxBuy}` }, 400);
  }
  if (next.grid.enabled && (next.grid.levels < 1 || next.grid.levels > 8)) return json({ detail: 'grid_levels_must_be_1_8' }, 400);
  // Diff explicito + origen: un cambio silencioso de estas banderas deja el bot
  // operando distinto sin que nadie sepa quien lo hizo, y la ventana de logs es
  // corta. Registrar solo lo que cambio hace el rastro barato y legible.
  const antes = await strategyConfig(env);
  const cambios: Record<string, { de: unknown; a: unknown }> = {};
  for (const grupo of Object.keys(next) as Array<keyof typeof next>) {
    for (const campo of Object.keys((next as any)[grupo] || {})) {
      const viejo = (antes as any)[grupo]?.[campo];
      const nuevo = (next as any)[grupo][campo];
      if (viejo !== nuevo) cambios[`${String(grupo)}.${campo}`] = { de: viejo, a: nuevo };
    }
  }
  await putJson(env, 'strategies_config', next);
  if (Object.keys(cambios).length) {
    await appendLogs(env, [{ ts: new Date().toISOString(), event: 'strategies_diff', data: {
      cambios,
      agente: (request.headers.get('User-Agent') || '').slice(0, 80),
      origen: request.headers.get('Origin') || request.headers.get('Referer') || 'desconocido',
    } }]);
  }
  await appendLogs(env, [{ ts: new Date().toISOString(), event: 'strategies_updated', data: { strategies: next, source: 'panel' } }]);
  return json({ ok: true, strategies: next });
}


// Genera las ordenes de Grid/DCA. Usa ids deterministas (grid-SYM-b1, dca-SYM)
// para regenerar en vez de acumular, y nunca compromete mas USDC del libre.
async function generateStrategyOrders(env: Env): Promise<void> {
  const strat = await strategyConfig(env);
  if (!strat.grid.enabled && !strat.dca.enabled && !strat.rsi.enabled && !strat.macd.enabled && !strat.usdt.operable) return;
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const market = latestMarket(logs);
  const snapshot = latestPortfolioSnapshot(logs);
  const freeUsdc = latestFreeUsdc(logs, snapshot);
  const orders = await conditionalOrders(env);
  const now = new Date().toISOString();
  const genPrefix = ['grid-', 'dca-', 'rsi-', 'macd-', 'rot-'];
  const values = await configValues(env);
  const kept = orders.filter((o) => !genPrefix.some((pre) => String(o.id).startsWith(pre)));
  const generated: ConditionalOrder[] = [];
  // Mismo presupuesto que usa el guardian: si el generador ignora las compras
  // activas que ya existen, crea ordenes que el guardian pausa al instante, y
  // cada ciclo se repite -> escritura KV y push en bucle.
  const comprometido = kept.filter((o) => o.status === 'active' && o.side === 'BUY').reduce((t, o) => t + Number(o.amount_usdc || 0), 0);
  let budget = Math.max(0, freeUsdc - comprometido);

  // Rotacion de stablecoin ociosa. Si el operador libero el USDT y queda por
  // encima de su peso maximo, se mantiene UNA orden condicionada de venta que
  // lo pasa a USDC por tramos. Es el unico camino viable: las ventas por IA
  // excluyen stablecoins a proposito, y Convert cobra 2-4% mientras que una
  // orden de mercado no paga comision en esta cuenta.
  if (strat.usdt.operable) {
    const usdt = (snapshot as any)?.assets?.USDT;
    const valor = assetHeldUsd(snapshot as any, 'USDT');
    const peso = Number(usdt?.weight || 0);
    const maxPeso = Number(usdt?.max_weight || 0);
    const unidades = Number(usdt?.amount || 0);
    const precio = Number(market.get('USDT')?.price_usd || 0) || (unidades > 0 ? valor / unidades : 0);
    const maxVenta = Number(values.MAX_SELL_NATIVE_USD || 12);
    const minVenta = Number(values.MIN_SELL_NATIVE_USD || 5);
    if (valor > 0 && precio > 0 && maxPeso > 0 && peso > maxPeso) {
      const excedente = valor * ((peso - maxPeso) / peso);
      // A dolares enteros: si el tramo cambiara por centavos cada ciclo, la orden
      // se reescribiria en KV cada 10 min y se comeria la cuota gratuita.
      const tramo = Math.floor(Math.min(maxVenta, excedente));
      // Comision exenta no significa coste cero: el spread medido entre USDT y
      // USDC fue 1.94%. Si rotar salio caro la ultima vez, no se repite.
      const coste = costeRotacionMedido(await getJson<MovementItem[]>(env, 'movement_history', []));
      if (coste && coste.pct > ROTACION_COSTE_MAX_PCT) {
        await appendLogSiCambia(env, 'rotacion_descartada_por_coste', {
          symbol: 'USDT', coste_pct: coste.pct, limite_pct: ROTACION_COSTE_MAX_PCT, rotaciones_medidas: coste.n,
          motivo: `Rotar USDT costo ${coste.pct}% de spread en ${coste.n} operaciones, por encima del limite de ${ROTACION_COSTE_MAX_PCT}%. No se genera otra.`,
        }, ['symbol', 'coste_pct', 'limite_pct']);
      } else if (tramo >= minVenta) {
        // El disparo va por debajo del precio actual para que se cumpla en el
        // ciclo siguiente: no se busca precio, se busca mover capital parado.
        generated.push({ id: 'rot-USDT', symbol: 'USDT', side: 'SELL', trigger_price_usd: roundPrice(precio * 0.98), current_price_usd: roundPrice(precio), value_usd: tramo, status: 'active', note: `Rotar USDT ocioso a USDC (sobrepeso ${(peso * 100).toFixed(1)}% > ${(maxPeso * 100).toFixed(1)}%, excedente ${roundUsd(excedente)} USD)`, created_at: now, updated_at: now } as ConditionalOrder);
      }
    }
  }

  if (strat.grid.enabled) {
    const sym = cleanSymbol(strat.grid.symbol) || '';
    const price = sym ? Number(market.get(sym)?.price_usd || 0) : 0;
    // Un grid de un solo nivel es una orden condicionada con otro nombre: si el
    // capital no financia al menos 2 peldanos, no se activa y se explica por que.
    const nivelUsd = roundUsd(strat.grid.amount_usdc);
    const nivelesCompra = nivelUsd > 0 ? Math.floor(budget / nivelUsd) : 0;
    const nivelesVenta = nivelUsd > 0 ? Math.floor(assetHeldUsd(snapshot, sym) / nivelUsd) : 0;
    const nivelesPosibles = Math.max(nivelesCompra, nivelesVenta);
    if (sym && price > 0 && nivelesPosibles < GRID_MIN_NIVELES) {
      await appendLogSiCambia(env, 'grid_sin_capital', {
        symbol: sym, niveles_pedidos: strat.grid.levels, niveles_posibles: nivelesPosibles,
        usd_por_nivel: nivelUsd, usdc_libre: roundUsd(budget),
        requerido: roundUsd(nivelUsd * GRID_MIN_NIVELES),
        motivo: `Un grid necesita al menos ${GRID_MIN_NIVELES} niveles financiados; con ${roundUsd(budget)} USDC libres solo alcanza para ${nivelesCompra}.`,
      }, ['symbol', 'niveles_pedidos', 'niveles_posibles', 'usd_por_nivel', 'usdc_libre']);
    } else if (sym && price > 0) {
      const step = Math.max(0.1, Number(strat.grid.step_pct) || 1.5);
      for (let i = 1; i <= strat.grid.levels; i++) {
        const amt = roundUsd(strat.grid.amount_usdc);
        if (budget < amt) break;
        generated.push({ id: `grid-${sym}-b${i}`, symbol: sym, side: 'BUY', trigger_price_usd: roundPrice(price * (1 - (step / 100) * i)), current_price_usd: roundPrice(price), amount_usdc: amt, status: 'active', note: `Grid compra nivel ${i} (-${(step * i).toFixed(2)}%)`, created_at: now, updated_at: now } as ConditionalOrder);
        budget -= amt;
      }
      let sellBudget = assetHeldUsd(snapshot, sym);
      for (let i = 1; i <= strat.grid.levels; i++) {
        const val = roundUsd(strat.grid.amount_usdc);
        if (sellBudget < val) break;
        generated.push({ id: `grid-${sym}-s${i}`, symbol: sym, side: 'SELL', trigger_price_usd: roundPrice(price * (1 + (step / 100) * i)), current_price_usd: roundPrice(price), value_usd: val, status: 'active', note: `Grid venta nivel ${i} (+${(step * i).toFixed(2)}%)`, created_at: now, updated_at: now } as ConditionalOrder);
        sellBudget -= val;
      }
    }
  }

  if (strat.dca.enabled) {
    const sym = cleanSymbol(strat.dca.symbol) || '';
    const price = sym ? Number(market.get(sym)?.price_usd || 0) : 0;
    const state = await getJson<{ last?: string }>(env, 'dca_last_run', {});
    const dueMs = Math.max(1, Number(strat.dca.interval_hours) || 12) * 3600 * 1000;
    const last = state.last ? Date.parse(state.last) : 0;
    const amt = roundUsd(strat.dca.amount_usdc);
    if (sym && price > 0 && Date.now() - last >= dueMs && budget >= amt) {
      generated.push({ id: `dca-${sym}`, symbol: sym, side: 'BUY', trigger_price_usd: roundPrice(price * (1 - Math.max(0, Number(strat.dca.dip_pct) || 0) / 100)), current_price_usd: roundPrice(price), amount_usdc: amt, status: 'active', note: `DCA cada ${strat.dca.interval_hours}h`, created_at: now, updated_at: now } as ConditionalOrder);
      budget -= amt;
      await putJson(env, 'dca_last_run', { last: now });
    }
  }


  // SHORT: cuando la IA dice SELL BTC con confianza alta, ir corto vendiendo el BTC actual
  if ((strat.short?.enabled ?? false)) {
    const sym = 'BTC';
    const btcAsset = (snapshot as any)?.assets?.BTC || { amount: 0, native_usd: 0 };
    const btcAmount = Number(btcAsset.amount) || 0;
    const btcValueUsd = Number(btcAsset.native_usd) || 0;
    const shortMinConf = ((strat.short?.min_confidence_pct ?? 70) / 100);
    const shortProfit = (strat.short?.profit_pct ?? -3.0);
    const shortStop = (strat.short?.stop_pct ?? 3.5);
    const hasShortOpen = orders.some((o) => String(o.id).startsWith('short-'));

    if (btcAmount > 0 && !hasShortOpen) {
      // Buscar si hay SELL signal de BTC
      const btcPrice = Number(market.get(sym)?.price_usd || 0);
      if (btcPrice > 0) {
        generated.push({
          id: `short-BTC`,
          symbol: sym,
          side: 'SELL',
          trigger_price_usd: roundPrice(btcPrice),
          current_price_usd: roundPrice(btcPrice),
          value_usd: roundUsd(btcValueUsd),
          status: 'active',
          note: `Short BTC: vender ${btcAmount.toFixed(6)} por $${btcValueUsd.toFixed(2)}`,
          created_at: now,
          updated_at: now,
        } as ConditionalOrder);
        // Orden de take profit: compra a -3% (BTC baja)
        generated.push({
          id: `short-BTC-tp`,
          symbol: sym,
          side: 'BUY',
          trigger_price_usd: roundPrice(btcPrice * (1 + shortProfit / 100)),
          current_price_usd: roundPrice(btcPrice),
          value_usd: roundUsd(btcValueUsd),
          status: 'active',
          note: `Short TP: compra si cae a ${(shortProfit).toFixed(1)}%`,
          created_at: now,
          updated_at: now,
        } as ConditionalOrder);
        // Orden de stop loss: compra a +3.5% (BTC sube, limita pérdida)
        // SL se agrega manualmente si es necesario: permite limitar pérdida inicial
        // sin bloquear la escalera. El usuario puede monitorear y cancelar si BTC sube.
        budget -= btcValueUsd;
      }
    }
  }

    // RSI y MACD: se consultan velas y se traduce la señal a orden condicionada.
  for (const modo of ['rsi', 'macd'] as const) {
    const cfg: any = (strat as any)[modo];
    if (!cfg?.enabled) continue;
    const sym = cleanSymbol(cfg.symbol) || '';
    if (!sym) continue;
    try {
      const ind = await indicatorsFor(sym, cfg.timeframe || '1h');
      const price = Number(ind.price || market.get(sym)?.price_usd || 0);
      if (!(price > 0)) continue;
      let side: 'BUY' | 'SELL' | null = null;
      let why = '';
      if (modo === 'rsi' && ind.rsi != null) {
        if (ind.rsi <= Number(cfg.oversold)) { side = 'BUY'; why = `RSI ${ind.rsi} en sobreventa (<= ${cfg.oversold})`; }
        else if (ind.rsi >= Number(cfg.overbought)) { side = 'SELL'; why = `RSI ${ind.rsi} en sobrecompra (>= ${cfg.overbought})`; }
      } else if (modo === 'macd' && ind.macd) {
        const { hist, prev_hist } = ind.macd;
        if (prev_hist <= 0 && hist > 0) { side = 'BUY'; why = `MACD cruce alcista (hist ${hist})`; }
        else if (prev_hist >= 0 && hist < 0) { side = 'SELL'; why = `MACD cruce bajista (hist ${hist})`; }
      }
      if (!side) continue;
      const amt = roundUsd(cfg.amount_usdc);
      if (side === 'BUY') {
        if (budget < amt) continue;
        generated.push({ id: `${modo}-${sym}`, symbol: sym, side: 'BUY', trigger_price_usd: roundPrice(price * 0.999), current_price_usd: roundPrice(price), amount_usdc: amt, status: 'active', note: why, created_at: now, updated_at: now } as ConditionalOrder);
        budget -= amt;
      } else {
        if (assetHeldUsd(snapshot, sym) < amt) continue;
        generated.push({ id: `${modo}-${sym}`, symbol: sym, side: 'SELL', trigger_price_usd: roundPrice(price * 1.001), current_price_usd: roundPrice(price), value_usd: amt, status: 'active', note: why, created_at: now, updated_at: now } as ConditionalOrder);
      }
    } catch (e: any) {
      console.error(`[${modo}] ${sym}: ${e?.message || e}`);
    }
  }

  if (!generated.length) return; // nada nuevo: las ordenes existentes quedan como estan
  // El trigger se recalcula con el precio de cada ciclo y deriva unas decimas;
  // si la orden previa sigue a menos de 0.5% se conserva intacta (con sus
  // timestamps), para que el estado sea identico y no se reescriba en KV.
  const previas = new Map(orders.filter((o) => genPrefix.some((pre) => String(o.id).startsWith(pre))).map((o) => [o.id, o]));
  const estables = generated.map((g) => {
    const prev = previas.get(g.id);
    if (!prev || prev.status !== 'active') return g;
    const mismoMonto = Number(prev.amount_usdc || prev.value_usd || 0) === Number(g.amount_usdc || g.value_usd || 0);
    const deriva = Math.abs(Number(prev.trigger_price_usd) - Number(g.trigger_price_usd)) / (Number(g.trigger_price_usd) || 1);
    return (mismoMonto && deriva < 0.005) ? prev : g;
  });
  // Antes se descartaban TODAS las ordenes generadas y solo se anadian las de este
  // tick: el DCA (que genera cada 12 h) vivia un unico tick y nunca llegaba a
  // ejecutarse. Ahora solo se sustituye lo que se regenera; el resto se conserva.
  const nuevosIds = new Set(estables.map((o) => o.id));
  const simbolosGrid = new Set(estables.filter((o) => String(o.id).startsWith('grid-')).map((o) => o.symbol));
  const conservadas = orders.filter((o) => {
    if (nuevosIds.has(o.id)) return false;
    if (String(o.id).startsWith('grid-') && simbolosGrid.has(o.symbol)) return false; // niveles viejos del grid
    return true;
  });
  await saveOrdersGuarded(env, conservadas.concat(estables), 'estrategias');
  // Registrar solo si algo cambio de verdad: el grid se regenera cada tick y, aun
  // reutilizando las ordenes previas, este log forzaba una escritura de recent_logs
  // por tick (144/dia) sin aportar informacion nueva.
  const cambiadas = estables.filter((o) => previas.get(o.id) !== o);
  if (cambiadas.length) {
    await appendLogs(env, [{ ts: now, event: 'strategy_orders_generated', data: { count: cambiadas.length, ids: cambiadas.map((o) => o.id), free_usdc: roundUsd(freeUsdc) } }]);
  }
}

async function status(env: Env): Promise<Response> {
  const report = await getJson<Report | null>(env, 'last_report', null);
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const desired = await desiredState(env);
  const mode = await executionMode(env);
  const lastDecision = latest(logs, ['decision', 'decision_hold']) || normalizeAiDecision(latest(logs, ['ai_execution_block', 'ai_response']));
  const lastTrade = latest(logs, ['trade_executed', 'trade']);
  const aiError = aiFailureReason(logs);
  const snap = latestPortfolioSnapshot(logs);
  const freeUsdcNow = latestFreeUsdc(logs, snap);
  const idleSecs = await semiIdleSeconds(env);
  const now = Date.now(); const anchor = report?.ts ? Date.parse(report.ts) : 0; const elapsed = anchor ? Math.max(0, Math.floor((now - anchor) / 1000)) : null;
  const interval = CICLO_SEGUNDOS; const secondsToNext = desired === 'running' && elapsed != null ? Math.max(0, interval - elapsed) : null; const overdue = elapsed == null ? 0 : Math.max(0, elapsed - interval);
  const health = desired !== 'running' ? desired : (elapsed == null ? 'waiting' : overdue > 180 ? 'late' : 'alive');
  // Do not advertise a healthy engine/AI before a recent runner report exists.
  // A stale report means the cloud control plane is reachable, but execution is not live.
  const reportFresh = Boolean(anchor && elapsed != null && elapsed <= interval + 180);
  // 'error' solo si el reporte dice que fallo. Si el ultimo reporte fue ok pero
  // ya vencio, el problema es el runner atrasado, no la IA: eso es 'stale'.
  const aiHealth = !report ? 'waiting' : report.status !== 'ok' ? 'error' : aiError ? 'error' : reportFresh ? 'healthy' : 'stale';
  const displayCycle = dailyCycle();
  return json({ state: 'cloud_ready', cycle: displayCycle, raw_cycle: report?.cycle ?? null, trading_day: tradingDayKey(), last_heartbeat: anchor ? Math.floor(anchor / 1000) : null, engine_available: reportFresh, trading_controls: 'enabled', execution_mode: mode, autopilot_enabled: mode === 'auto', trading_mode: desired === 'running' ? (mode === 'auto' ? 'REMOTE_AUTO' : 'REMOTE_SEMI') : desired.toUpperCase(), real_trading: desired === 'running' && reportFresh, ai_active: aiHealth === 'healthy', ai_model: env.GROQ_MODEL || 'openai/gpt-oss-20b', ai_provider: 'groq', ai_health: aiHealth, ai_error: aiError, free_usdc: roundUsd(freeUsdcNow), kv_por_ciclo: (report?.summary as any)?.kv || null, kv_dia: (report?.summary as any)?.kv_dia || null, kv_proyeccion: (report?.summary as any)?.kv_proyeccion ?? null, kv_degradado: Boolean((report?.summary as any)?.kv_degradado), semi_idle_seconds: idleSecs, semi_idle_limit: SEMI_IDLE_LIMIT_SECONDS, ai_last_seen: report?.ts || null, runner: { health, desired_state: desired, interval_seconds: interval, elapsed_seconds: elapsed, seconds_to_next: secondsToNext, overdue_seconds: overdue, progress: elapsed == null ? 0 : Math.min(1, elapsed / interval), last_seen: report ? { ts: report.ts, cycle: displayCycle, raw_cycle: report.cycle, trading_day: tradingDayKey() } : null, last_report: report, latest_decision: lastDecision ? { ts: iso(lastDecision.ts), data: lastDecision.data || {} } : null, latest_trade: lastTrade ? { ts: iso(lastTrade.ts), data: publicTradeData(lastTrade.data || {}) } : null } });
}
async function dashboard(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || 'live';
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const snapshots = logs.filter((x) => x.event === 'portfolio_snapshot').slice(-12);
  const latestSnap = snapshots.at(-1);
  if (!latestSnap) return json({ as_of: null, total_usd: 0, assets: [], series: [], market: [] });
  const data = latestSnap.data || {}; const rawAssets = data.assets || {};
  const allocation = await allocationValues(env);
  const assets = Object.entries(rawAssets)
    .map(([symbol, value]: [string, any]) => ({ symbol, amount: Number(value.amount || 0), value_usd: Number(value.native_usd || 0), weight: Number(value.weight || 0), target_pct: allocation[symbol] || 0 }))
    .filter((asset) => Math.abs(asset.amount) > 0.00000001 || asset.value_usd > 0.005)
    .sort((a, b) => b.value_usd - a.value_usd);
  const history = await getJson<PortfolioPoint[]>(env, 'portfolio_history', []);
  const recentSeries = snapshots.map((x) => ({ ts: iso(x.ts) || new Date().toISOString(), value_usd: Number(x.data?.total_usd || 0) })).filter((x) => x.value_usd > 0);
  const mergedHistory = history.concat(recentSeries);
  const byTs = new Map<string, PortfolioPoint>();
  for (const p of mergedHistory) if (p.ts && Number.isFinite(p.value_usd) && p.value_usd > 0) byTs.set(p.ts, p);
  const cutoff = Date.now() - rangeMs(range);
  const series = compactSeries([...byTs.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).filter((p) => Date.parse(p.ts) >= cutoff));
  const aiLog = latest(logs, ['ai_response']);
  const universeRows = ((aiLog?.data?.universe || []) as Array<Record<string, unknown>>).map((x) => ({ symbol: String(x.symbol || '').toUpperCase(), price_usd: Number(x.price_usd || 0), change_24h: Number(x.change_24h || 0) })).filter((x) => x.symbol);
  const bySymbol = new Map(universeRows.map((x) => [x.symbol, x]));
  const wantedSymbols = Array.from(new Set(['BTC','ETH', ...assets.map((a) => a.symbol), ...Object.keys(allocation).filter((symbol) => (allocation[symbol] || 0) > 0)])).filter((symbol) => !['USDC','USDT','USD'].includes(symbol));
  const market = wantedSymbols.map((symbol) => bySymbol.get(symbol) || { symbol, price_usd: 0, change_24h: 0, pending: true }).sort((a: any, b: any) => {
    const av = assets.find((x) => x.symbol === a.symbol)?.value_usd || 0;
    const bv = assets.find((x) => x.symbol === b.symbol)?.value_usd || 0;
    return (bv - av) || a.symbol.localeCompare(b.symbol);
  });
  return json({ as_of: iso(latestSnap.ts), total_usd: Number(data.total_usd || 0), assets, series, market, range, performance_1d: portfolioChange([...byTs.values()], 24 * 3600 * 1000), decision_reference: '1D' });
}
function roundUsd(value: number): number { return Math.round(value * 100) / 100; }
function roundPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1000) return Math.round(value * 100) / 100;
  if (value >= 1) return Math.round(value * 10000) / 10000;
  return Math.round(value * 1000000) / 1000000;
}
function latestMarket(logs: LogItem[]): Map<string, Record<string, any>> {
  const aiLog = latest(logs, ['ai_response']);
  const rows = Array.isArray(aiLog?.data?.universe) ? aiLog?.data?.universe as Array<Record<string, any>> : [];
  const out = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const symbol = cleanSymbol(row.symbol);
    if (symbol) out.set(symbol, row);
  }
  return out;
}
function latestAiSignals(logs: LogItem[]): Map<string, Record<string, any>> {
  const out = new Map<string, Record<string, any>>();
  for (const item of logs.filter((x) => x.event === 'ai_response').slice(-4)) {
    const ops = Array.isArray(item.data?.ai?.opportunities) ? item.data?.ai?.opportunities as Array<Record<string, any>> : [];
    for (const op of ops) {
      const symbol = cleanSymbol(op.symbol);
      const confidence = Number(op.confidence || 0);
      if (!symbol || !Number.isFinite(confidence)) continue;
      const prev = out.get(symbol);
      if (!prev || confidence >= Number(prev.confidence || 0)) out.set(symbol, op);
    }
  }
  return out;
}
async function forecast(env: Env): Promise<Response> {
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const latestSnap = logs.filter((x) => x.event === 'portfolio_snapshot').at(-1);
  if (!latestSnap) return json({ as_of: null, mode: 'conditional_plans', summary: 'Sin snapshot de cartera todavía.', plans: [], note: 'Planes predictivos; no son órdenes colocadas en Crypto.com.' });
  const data = latestSnap.data || {};
  const total = Number(data.total_usd || 0);
  const rawAssets = data.assets || {};
  const allocation = await allocationValues(env);
  const config = await configValues(env);
  const market = latestMarket(logs);
  const aiSignals = latestAiSignals(logs);
  const basis = await costBasisState(env);
  const assets = new Map<string, { value_usd: number; amount: number; weight: number }>();
  for (const [symbol, value] of Object.entries(rawAssets) as Array<[string, any]>) {
    const clean = cleanSymbol(symbol);
    if (!clean) continue;
    assets.set(clean, { value_usd: Number(value.native_usd || 0), amount: Number(value.amount || 0), weight: Number(value.weight || 0) });
  }
  const maxBuy = Number(config.MAX_TRADE_USDC || 8);
  const minBuy = Number(config.MIN_TRADE_USDC || 5);
  const maxSell = Number(config.MAX_SELL_NATIVE_USD || 8);
  const minSell = Number(config.MIN_SELL_NATIVE_USD || 5);
  const cost = Number(config.ESTIMATED_ROUNDTRIP_COST_PCT || 0.025);
  const minProfit = Number(config.MIN_PROFIT_TO_SELL_PCT || 0.04);
  const sellFraction = Number(config.SELL_FRACTION || 0.25);
  const history = await getJson<PortfolioPoint[]>(env, 'portfolio_history', []);
  const recentPoints = logs.filter((x) => x.event === 'portfolio_snapshot').map((x) => ({ ts: iso(x.ts) || new Date().toISOString(), value_usd: Number(x.data?.total_usd || 0) })).filter((x) => x.value_usd > 0);
  const perf1d = portfolioChange(history.concat(recentPoints), 24 * 3600 * 1000);
  const dayPositive = (perf1d?.change_usd || 0) > 0;
  const dayNegative = (perf1d?.change_usd || 0) < -Math.max(0.5, total * 0.005);
  const symbols = Array.from(new Set(['BTC', 'ETH', ...Object.keys(allocation), ...assets.keys()])).filter((symbol) => !['USDC','USDT','USD'].includes(symbol));
  const plans: ForecastPlan[] = [];
  let reservedUsdcForPlans = 0;
  const usdc = assets.get('USDC') || { value_usd: 0, amount: 0, weight: 0 };
  const usdc_available = Math.max(0, usdc.value_usd * 0.95);
  for (const symbol of symbols) {
    const row = market.get(symbol);
    const price = Number(row?.price_usd || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const asset = assets.get(symbol) || { value_usd: 0, amount: 0, weight: 0 };
    const currentPct = asset.weight * 100;
    const targetPct = Number(allocation[symbol] || 0);
    const preserveMinPct = targetPct > 0 ? (targetPct >= 3 ? Math.max(0.5, targetPct - 2) : Math.max(0.1, targetPct * 0.5)) : 0;
    const deltaPct = targetPct - currentPct;
    const change24 = Number(row?.change_24h ?? row?.percent_change_24h_native ?? 0);
    const signal = aiSignals.get(symbol);
    const action = String(signal?.action || '').toUpperCase();
    const aiConfidence = Number(signal?.confidence || 0);
    const confidence = Math.max(0.52, Math.min(0.92, aiConfidence || (Math.abs(change24) >= 1 ? 0.64 : 0.56)));
    const dipPct = Math.min(0.035, Math.max(0.006, Math.abs(change24 || 1) / 100 * 0.45));
    const change1w = Number(row?.change_1w ?? row?.percent_change_7d_native ?? 0);
    const breakoutBuy = action === 'BUY' && aiConfidence >= 0.82 && change24 > 0 && change1w > 0;
    if (targetPct > 0 && deltaPct > 0.75) {
      const needed = Math.max(0, total * deltaPct / 100);
      const riskMultiplier = dayNegative ? 0.5 : 1;
      let amount = roundUsd(Math.min(maxBuy * riskMultiplier, Math.max(minBuy, needed * 0.35 * riskMultiplier)));
      const usdcRemaining = usdc_available - reservedUsdcForPlans;
      if (amount > usdcRemaining) amount = 0;
      if (amount >= Math.min(minBuy, maxBuy) && reservedUsdcForPlans + amount <= usdc_available) {
        reservedUsdcForPlans += amount;
        const trigger = breakoutBuy ? price * (1 + Math.min(0.008, cost / 2)) : price * (1 - Math.max(dipPct, cost / 2));
        const est = estimateOrderPnlWithBasis('BUY', price, trigger, amount, basisAvgCost(basis, symbol));
        plans.push({ symbol, side: 'BUY', trigger_price_usd: roundPrice(trigger), current_price_usd: roundPrice(price), amount_usdc: amount, ...est, confidence: roundPct(dayNegative ? confidence - 0.08 : confidence), reason: `${symbol} bajo objetivo ${targetPct.toFixed(1)}%; referencia 1D ${perf1d ? `${perf1d.change_usd >= 0 ? '+' : ''}$${perf1d.change_usd}` : 'sin dato'}. ${dayNegative ? 'Compra reducida por 1D negativo y esperando precio más bajo.' : breakoutBuy ? 'Excepción breakout: IA fuerte y tendencia 24h/1w positiva.' : 'Comprar bajo: esperar precio mejor que el actual.'}`, status: 'watching', executable: false, target_pct: roundPct(targetPct), current_pct: roundPct(currentPct), preserve_min_pct: roundPct(preserveMinPct) });
      }
    }
    if (asset.value_usd >= minSell && currentPct > Math.max(targetPct + 0.75, preserveMinPct + 0.75)) {
      const excessUsd = Math.max(0, total * (currentPct - Math.max(targetPct, preserveMinPct)) / 100);
      const value = roundUsd(Math.min(maxSell, Math.max(minSell, excessUsd, asset.value_usd * sellFraction)));
      if (value >= minSell) {
        const profitTriggerPct = Math.max(cost, minProfit, 0.018);
        const trigger = price * (1 + profitTriggerPct);
        const est = estimateOrderPnlWithBasis('SELL', price, trigger, value, basisAvgCost(basis, symbol));
        plans.push({ symbol, side: 'SELL', trigger_price_usd: roundPrice(trigger), current_price_usd: roundPrice(price), value_usd: value, ...est, confidence: roundPct(dayPositive ? Math.min(0.95, confidence + 0.04) : confidence), reason: `${symbol} sobre objetivo/peso mínimo; venta parcial solo si sube al trigger de ganancia (+${roundPct(profitTriggerPct * 100)}% aprox), sin vaciar posición. Referencia 1D ${perf1d ? `${perf1d.change_usd >= 0 ? '+' : ''}$${perf1d.change_usd}` : 'sin dato'}. ${dayPositive ? '1D positivo favorece asegurar margen.' : action === 'SELL' ? 'IA ve presión, pero el plan programado espera mejor precio.' : 'Esperar recuperación antes de vender.'}`, status: 'watching', executable: false, target_pct: roundPct(targetPct), current_pct: roundPct(currentPct), preserve_min_pct: roundPct(preserveMinPct) });
      }
    }
  }
  plans.sort((a, b) => {
    const core = (s: string) => s === 'BTC' ? 3 : s === 'ETH' ? 2 : 0;
    return (core(b.symbol) - core(a.symbol)) || (b.confidence - a.confidence) || Math.abs(b.current_pct - b.target_pct) - Math.abs(a.current_pct - a.target_pct);
  });
  return json({
    as_of: iso(latestSnap.ts),
    mode: 'conditional_plans',
    decision_reference: '1D',
    performance_1d: perf1d,
    orders: (await executableConditionalOrders(env)).map((o) => {
      const current = Number(market.get(o.symbol)?.price_usd || o.current_price_usd || 0);
      const notional = o.side === 'BUY' ? Number(o.amount_usdc || 0) : Number(o.value_usd || 0);
      return { ...o, current_price_usd: roundPrice(current), ...estimateOrderPnlWithBasis(o.side, current, o.trigger_price_usd, notional, basisAvgCost(basis, o.symbol)) };
    }),
    summary: plans.length ? `${plans.length} planes predictivos listos; referencia de decisión 1D; ventas programadas por arriba del precio actual para buscar ganancia.` : 'Sin plan elegible: cartera cerca de objetivos o falta precio de mercado.',
    plans: plans.slice(0, 2),
    note: 'Plan predictivo/condicionado. SELL programado busca precio superior al actual; ventas bajo mercado quedan reservadas para defensa/riesgo, no como toma de ganancia.',
  });
}
async function movements(env: Env, request: Request): Promise<Response> {
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || 25), 1), 100);
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []);
  const durable = await getJson<MovementItem[]>(env, 'movement_history', []);
  const fromLogs = logs.map(movementFromTradeLog).filter(Boolean) as MovementItem[];
  // Los registros guardados antes de medir P&L no traen el resultado; si el log
  // todavia conserva esa operacion, se completa con su profit_state real.
  const pnlPorId = new Map(fromLogs.filter((x) => x.pnl_known).map((x) => [x.id, x]));
  const seen = new Set<string>();
  const movements: MovementItem[] = [];
  for (const item of durable.concat(fromLogs).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const rico = !item.pnl_known ? pnlPorId.get(item.id) : null;
    movements.push(rico ? { ...item, pnl_usd: rico.pnl_usd, pnl_pct: rico.pnl_pct, pnl_known: true } : item);
    if (movements.length >= limit) break;
  }
  return json({ movements });
}
async function decisions(env: Env, request: Request): Promise<Response> {
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || 30), 1), 80);
  const logs = await getJson<LogItem[]>(env, 'recent_logs', []); const items = logs.slice().reverse().map(compactDecision).filter(Boolean).slice(0, limit);
  return json({ decisions: items.length ? items : [{ ts: new Date().toISOString(), kind: 'hold', title: 'Esperando ciclo', badge: 'KV', confidence: null, amount: null, reason: 'Runner conectado; esperando reporte', detail: 'sin D1' }] });
}
async function logs(env: Env, request: Request): Promise<Response> {
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') || 80), 1), 300);
  const recent = await getJson<LogItem[]>(env, 'recent_logs', []);
  return json({ logs: recent.slice(-limit).reverse().map((x) => ({ ts: iso(x.ts) || new Date().toISOString(), event: x.event || 'unknown', data: x.data || {} })) });
}
async function configResponse(env: Env): Promise<Response> {
  const values = await configValues(env);
  return json({ parameters: DEFAULT_PARAMS.map((p) => ({ ...p, value: values[p.key] })), presets: CONFIG_PRESETS });
}
async function updateConfig(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const current = await configValues(env); const changed: Record<string, number> = {};
  const preset = typeof body.preset === 'string' ? CONFIG_PRESETS.find((p) => p.key === body.preset) : null;
  const input = preset?.values || body.parameters || body.config || body.values || {};
  for (const [key, value] of Object.entries(input)) { const clamped = clampParam(key, value); if (clamped != null && current[key] !== clamped) { current[key] = clamped; changed[key] = clamped; } }
  await putJson(env, 'config_values', current);
  if (Object.keys(changed).length) await appendLogs(env, [{ ts: new Date().toISOString(), event: 'config_updated', data: { changed, preset: preset?.key || null, source: 'app' } }]);
  return json({ ok: true, changed: Object.entries(changed), changed_values: changed, preset: preset?.key || null, parameters: DEFAULT_PARAMS.map((p) => ({ ...p, value: current[p.key] })) });
}
async function modeResponse(env: Env): Promise<Response> {
  const mode = await executionMode(env);
  return json({ mode, autopilot_enabled: mode === 'auto' });
}
async function updateMode(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);
  const mode: ExecutionMode = String(body.mode || '').toLowerCase() === 'auto' ? 'auto' : 'semi';
  await setExecutionMode(env, mode);
  await appendLogs(env, [{ ts: new Date().toISOString(), event: 'execution_mode_updated', data: { mode, source: 'app' } }]);
  await notifyWhatsApp(env, 'execution_mode_updated', mode === 'auto' ? 'Piloto automático activado' : 'Modo semiautomático activado', mode === 'auto' ? 'El bot puede operar señales IA elegibles sin popup, manteniendo candados.' : 'El bot solo ejecuta órdenes condicionadas autorizadas desde la app.', mode, 0);
  // Wake a cycle now so the runner receives the new boundary instead of
  // waiting for the next five-minute cron. The runner also re-checks this
  // boundary immediately before any real confirmation.
  const dispatch = (await desiredState(env)) === 'running' ? await dispatchRunner(env, `execution_mode_${mode}`) : null;
  return json({ ok: true, mode, autopilot_enabled: mode === 'auto', dispatch });
}

async function dcaConfig(env: Env): Promise<DCAConfig> {
  return getJson<DCAConfig>(env, 'dca_config', initializeDCAConfig());
}

async function dcaResponse(env: Env): Promise<Response> {
  const config = await dcaConfig(env);
  const portfolio = await getJson<any>(env, 'portfolio_snapshot', {});
  const market = await getJson<any[]>(env, 'market_snapshot', []);

  const schedules = config.symbols.map(symbol => {
    const quote = market.find((q: any) => q.symbol === symbol);
    const asset = portfolio.assets?.find((a: any) => a.symbol === symbol);
    const price_change_24h = quote?.change_24h || 0;
    const volatility = Math.abs(price_change_24h); // Simplified volatility
    const portfolio_allocation = asset?.weight || 0;
    const target_allocation = portfolio.allocation?.[symbol] || 0;

    const aiDecision = decideDCABuyAI(symbol, price_change_24h, volatility, portfolio_allocation, target_allocation);

    return {
      symbol,
      amount_usdc: config.amount_usdc,
      frequency: config.frequency,
      last_buy: null as string | null,
      next_buy: config.next_execution,
      total_bought_count: 0,
      avg_price_paid: 0,
      ai_decision: aiDecision,
      auto_execute: aiDecision.should_buy && aiDecision.confidence >= 0.7,
    };
  });

  return json({ enabled: config.enabled, config, schedules, auto_buy_ready: schedules.filter((s: any) => s.auto_execute).length });
}

async function updateDCA(env: Env, request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({})) as any;
  if (body.confirmed !== true) return json({ detail: 'confirmation_required' }, 400);

  const config = await dcaConfig(env);

  if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
  if (body.frequency && ['hourly', '6hourly', '12hourly', 'daily'].includes(body.frequency)) {
    config.frequency = body.frequency;
  }
  if (typeof body.amount_usdc === 'number' && body.amount_usdc > 0) {
    config.amount_usdc = Math.max(1, Math.min(50, body.amount_usdc));
  }
  if (Array.isArray(body.symbols)) {
    config.symbols = body.symbols.filter((s: string) => /^[A-Z0-9]{2,12}$/.test(s));
  }

  if (config.enabled && config.symbols.length === 0) {
    return json({ detail: 'DCA requires at least one symbol' }, 400);
  }

  config.next_execution = calculateNextDCAExecution(config.last_execution, config.frequency);
  await putJson(env, 'dca_config', config);
  await appendLogs(env, [{
    ts: new Date().toISOString(),
    event: 'dca_config_updated',
    data: { enabled: config.enabled, frequency: config.frequency, amount_usdc: config.amount_usdc, symbols: config.symbols, source: 'app' }
  }]);

  return json({ ok: true, config });
}

async function analyticsResponse(env: Env, request: Request): Promise<Response> {
  const period = new URL(request.url).searchParams.get('period') as '1d' | '7d' | '30d' | '90d' || '30d';
  const movements = await getJson<any[]>(env, 'movement_history', []);
  const portfolio = await getJson<any>(env, 'portfolio_snapshot', {});
  const analytics = calculateAnalytics(movements, portfolio, period);
  return json({ analytics });
}
async function riskMetricsResponse(env: Env): Promise<Response> {
  const adaptive = await getJson<any>(env, 'adaptive_risk_state', {});
  const snapshot = await getJson<any>(env, 'portfolio_snapshot', {});
  const total = Number(snapshot.total_usd || 0);
  const market = latestMarket(await getJson<any[]>(env, 'recent_logs', []));
  const volatility = Array.from(market.values()).reduce((sum, q) => sum + Math.abs(Number(q?.change_24h || 0)), 0) / Math.max(1, market.size);
  const risk = calculateRiskMetrics(adaptive, total, volatility);
  return json({ risk });
}
async function rebalanceResponse(env: Env): Promise<Response> {
  const allocation = await allocationValues(env);
  const snapshot = await getJson<any>(env, 'portfolio_snapshot', {});
  const assets = new Map<string, any>();
  for (const [symbol, value] of Object.entries(snapshot.assets || {})) {
    const clean = cleanSymbol(String(symbol));
    if (clean) assets.set(clean, value);
  }
  const total = Number(snapshot.total_usd || 0);
  const opps = calculateRebalanceOpportunities(allocation, assets, total);
  return json({ rebalance_opportunities: opps, next_rebalance_days: 7 });
}
async function versionResponse(): Promise<Response> {
  const info = getVersionInfo();
  return json(info);
}

function serveHTML(): Response {
  const html = `<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'><meta name='theme-color' content='#0a0f0d'><link rel='manifest' href='manifest.webmanifest'><link rel='apple-touch-icon' href='icon-192.png'><meta name='mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'><title>TradBot IA</title><style>:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Roboto",sans-serif;--bg:#0a0f0d;--card:#0f1816;--line:#1e3729;--ink:#e5f2eb;--muted:#7a8a82;--green:#5eeec8;--red:#ff7080}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 75% -5%,#0d3028 0,transparent 35%),var(--bg);color:var(--ink)}button{font:inherit;cursor:pointer}.shell{width:min(100%,800px);margin:auto;padding:calc(16px + env(safe-area-inset-top)) 12px calc(40px + env(safe-area-inset-bottom));display:grid;gap:16px}.topbar{padding:12px 0 16px;border-bottom:2px solid var(--line)}.topbar>div{display:flex;justify-content:space-between;align-items:flex-start}.eyebrow{margin:0 0 6px;color:var(--muted);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}h1{margin:0;font-size:28px;letter-spacing:-.02em;font-weight:700}h1 span{color:var(--green)}.status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--green);text-transform:uppercase;font-weight:600}.status i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green)}.card{background:linear-gradient(135deg,rgba(12,20,17,.7),rgba(8,12,10,.9));border:1px solid var(--line);border-radius:14px;padding:20px}.sectionHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}h2{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}.label{margin:0 0 8px;color:var(--muted);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}.portfolio{padding:24px 20px 16px;position:relative;overflow:hidden}.portfolio strong{font-size:40px;letter-spacing:-.04em;font-weight:800}.portfolio .range{position:absolute;right:20px;top:24px;font-size:11px}.range button{border:1px solid var(--green);background:rgba(94,238,200,.08);color:var(--green);border-radius:8px;padding:7px 10px;font-size:10px;font-weight:600}.range button.active{background:var(--green);color:var(--bg)}.range span{display:block;margin-top:12px;font-size:13px;font-weight:700}svg{display:block;width:100%;height:140px;margin:12px 0 0}.line{fill:none;stroke:var(--green);stroke-width:2.8;filter:drop-shadow(0 0 6px #5eeec844)}.area{fill:url(#fill);stroke:none}.muted,small{color:var(--muted);font-size:11px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:14px}.metrics article{padding:16px;background:rgba(94,238,200,.05);border:1px solid rgba(94,238,200,.15);border-radius:12px}.metrics strong{display:block;margin:8px 0 6px;font-size:20px;font-weight:700}.market{display:flex;gap:10px;overflow-x:auto;margin-top:12px;padding-bottom:2px;scroll-behavior:smooth}.market article{min-width:140px;background:rgba(30,55,41,.4);border:1px solid var(--line);border-radius:12px;padding:14px;flex-shrink:0}.market b{display:block;margin-bottom:8px;font-size:13px;font-weight:600}.market span{font-size:14px;margin:6px 0;font-weight:600}.market em{font-size:11px;font-style:normal;opacity:.8}.up{color:var(--green)}.down{color:var(--red)}.assets,.movements{display:grid;margin-top:12px}.assets article,.movements article{display:grid;grid-template-columns:40px 1fr auto;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}.coin,.txIcon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:rgba(94,238,200,.12);color:var(--green);font-weight:700;font-size:12px}.txIcon.sell{background:rgba(255,112,128,.12);color:#ff9aaa}.assets b,.movements b{display:block;margin-bottom:4px;font-size:14px;font-weight:600}.assets small,.movements small{color:var(--muted);font-size:10px}.assetValue,.txValue{text-align:right}.assetValue strong,.txValue strong{display:block;font-size:14px;margin-bottom:4px}.actionGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.actionGrid button{text-align:center;min-height:72px;padding:14px;border-radius:12px;color:var(--ink);background:linear-gradient(135deg,rgba(94,238,200,.15),rgba(94,238,200,.05));border:1.5px solid var(--line);font-weight:600;transition:all .2s}.actionGrid button:hover:not(:disabled){background:linear-gradient(135deg,rgba(94,238,200,.25),rgba(94,238,200,.1));border-color:var(--green)}.actionGrid button:disabled{opacity:.4}.actionGrid .danger{background:linear-gradient(135deg,rgba(255,112,128,.15),rgba(255,112,128,.05));border-color:rgba(255,112,128,.3);color:#ffb0b8}.actionGrid span{display:block;font-size:11px;margin-bottom:6px;opacity:.8}.notice{margin:12px 0 0;border-left:3px solid var(--green);padding:12px 14px;color:var(--green);background:rgba(94,238,200,.08);font-size:11px;line-height:1.6;border-radius:6px}dialog{background:var(--card);border:1px solid var(--line);border-radius:14px;color:var(--ink)}dialog::backdrop{background:rgba(0,0,0,.6)}dialog button{background:linear-gradient(135deg,rgba(94,238,200,.15),rgba(94,238,200,.05));border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px 16px;font-weight:600}dialog button.primary{background:var(--green);color:var(--bg);border-color:var(--green)}@media(max-width:480px){.metrics{grid-template-columns:1fr}.portfolio strong{font-size:36px}.actionGrid{grid-template-columns:1fr}}.rangeButtons{display:flex;gap:6px;justify-content:flex-end}.rangeButtons button{opacity:.6;transition:.2s;background:rgba(94,238,200,.08);border:1px solid var(--line);color:var(--green);border-radius:8px;padding:7px 10px;font-size:10px;font-weight:600}.rangeButtons button.active{opacity:1;background:var(--green);color:var(--bg);border-color:var(--green)}.range{min-width:160px}

dialog{width:min(92vw,700px);max-height:86vh;color:var(--ink);background:#090f0d;border:1px solid #29483b;border-radius:16px;padding:18px}
dialog::backdrop{background:#020504d9;backdrop-filter:blur(4px)}
.dialogHead{display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#090f0d;padding-bottom:12px}
.dialogHead button,.primary{border:1px solid #2e644d;background:#11261d;color:var(--green);border-radius:8px;padding:9px;font:inherit;font-size:10px}
.logRows{max-height:68vh;overflow:auto}.logRows article{border-top:1px solid var(--line);padding:12px 0}.logRows time,.logRows b{display:block;font-size:10px}.logRows time{color:var(--muted);margin-bottom:4px}.logRows pre{white-space:pre-wrap;word-break:break-word;color:#9db3a8;font-size:9px;line-height:1.5}
.cycle{display:grid;gap:10px}.cycle .sectionHead span{color:var(--green);font-size:11px}.progress{height:7px;background:#102019;border:1px solid #1f3b30;border-radius:99px;overflow:hidden}.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#65f5ac,#c1ae77);box-shadow:0 0 10px #65f5ac88;transition:width .4s ease}.cycleGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.cycleGrid span{border:1px solid var(--line);border-radius:8px;padding:8px;background:#0b1511;min-width:0}.cycleGrid b,.cycleGrid small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cycleGrid b{font-size:12px}.cycleGrid small{margin-top:4px}
.decisions{display:grid;gap:7px;margin-top:8px;max-height:310px;overflow:auto;padding-right:2px}.decisions article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;border:1px solid var(--line);border-left:3px solid #3d5e4f;border-radius:8px;background:#0b1511;padding:9px}.decisions article.trade{border-left-color:var(--green)}.decisions article.decision{border-left-color:#c1ae77}.decisions article.block{border-left-color:var(--red)}.decisions b,.decisions small{display:block}.decisions p{margin:6px 0 0;color:#9db3a8;font-size:10px;line-height:1.4}.decisions span,.sectionHead>span{color:var(--green);font-size:10px;white-space:nowrap}.decisions small{margin-top:3px}
.decisions article.decision>span{color:#c1ae77}.decisions article.block>span{color:var(--red)}
.decisions article.hold{border-left-color:#3d5e4f}.decisions article.hold>span{color:var(--muted)}
.livePanel{display:grid;gap:10px}.liveGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.liveGrid article,.liveSignal{border:1px solid var(--line);border-radius:10px;background:#0b1511;padding:10px;min-width:0}.liveGrid small,.liveSignal small{display:block;margin-bottom:5px;color:var(--muted)}.liveGrid b,.liveSignal b{display:block;font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.liveSignal p{margin:0;color:#9db3a8;font-size:10px;line-height:1.45}.livePanel .sectionHead>span{color:var(--green)}
.forecast{display:grid;gap:9px}.forecastPlans{display:grid;gap:8px;max-height:300px;overflow:auto}.forecastPlans article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;border:1px solid var(--line);border-left:3px solid #c1ae77;border-radius:10px;background:#0b1511;padding:9px}.forecastPlans article.buy{border-left-color:var(--green)}.forecastPlans article.sell{border-left-color:#ffb36b}.forecastPlans b,.forecastPlans small{display:block}.forecastPlans p{margin:6px 0 0;color:#9db3a8;font-size:10px;line-height:1.4}.forecastPlans span{text-align:right;color:var(--green);font-size:11px;white-space:nowrap}.forecastPlans span small{margin-top:4px;color:var(--muted)}.notice.mini{font-size:9px;padding:7px 9px}
.miniAction{border:1px solid #2e644d;background:#10231b;color:var(--green);border-radius:8px;padding:8px;font-size:10px}.proposalBody article{border:1px solid var(--line);border-radius:12px;background:#0b1511;padding:12px}.proposalBody h3{margin:0 0 8px;font-size:16px}.proposalBody p{font-size:11px;line-height:1.45}.proposalActions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.proposalActions button{border:1px solid #2e644d;background:#11261d;color:var(--green);border-radius:8px;padding:10px;font:inherit;font-size:10px}.proposalActions .danger{border-color:#53282d;color:#ff8b93}
.configForm{display:grid;gap:8px;margin:14px 0}.configForm label{display:grid;grid-template-columns:1fr 100px;gap:12px;align-items:center;border-top:1px solid var(--line);padding-top:9px;font-size:10px}.configForm small{display:block;margin-top:4px}.configForm input{width:100%;background:#0f1915;color:var(--ink);border:1px solid #294338;border-radius:7px;padding:9px}.primary{width:100%;font-weight:700}.actionGrid button:not(:disabled){cursor:pointer}.actionGrid button:not(:disabled):active{transform:scale(.98)}

/* Mobile-first compact layout: no horizontal overflow or oversized gaps. */
html,body,#app{width:100%;max-width:100%;overflow-x:hidden}.shell{width:100%;max-width:600px;padding:calc(10px + env(safe-area-inset-top)) 9px calc(16px + env(safe-area-inset-bottom));gap:8px}.card{border-radius:12px;padding:12px}.topbar{padding:2px 3px 5px}.portfolio{padding:14px 14px 0}.portfolio strong{font-size:28px}.portfolio .range{top:14px;right:14px}svg{width:calc(100% + 28px);height:105px;margin:5px -14px 0}.metrics{gap:8px}.metrics .card{min-width:0}.metrics strong{font-size:14px;white-space:normal}.market{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;overflow:visible;margin-top:9px}.market article{min-width:0;padding:9px}.market span{overflow:hidden;text-overflow:ellipsis}.assets,.movements{margin-top:6px}.assets article,.movements article{grid-template-columns:30px minmax(0,1fr) auto;gap:7px;padding:9px 0}.coin,.txIcon{width:27px;height:27px;font-size:10px}.assetValue,.txValue{max-width:115px}.actionGrid{gap:6px}.actionGrid button{min-height:58px;padding:9px}.notice{padding:7px 9px}.sectionHead{gap:8px}dialog{width:calc(100vw - 18px);padding:12px;border-radius:12px}.logRows{max-height:72vh}.configForm label{grid-template-columns:minmax(0,1fr) 88px;gap:7px}
@media(max-width:380px){.shell{padding-left:6px;padding-right:6px}.metrics{grid-template-columns:1fr 1fr}.actionGrid{grid-template-columns:1fr 1fr}.portfolio strong{font-size:24px}.market article{padding:7px}.txValue{grid-column:2;text-align:left;max-width:none}.movements article{grid-template-columns:28px minmax(0,1fr)}}
@media(max-width:360px){.cycleGrid{grid-template-columns:1fr}.cycle .sectionHead{align-items:flex-start}.cycle .sectionHead span{text-align:right}}
@media(max-width:360px){.liveGrid{grid-template-columns:1fr}.livePanel .sectionHead{align-items:flex-start}.livePanel .sectionHead>span{text-align:right}}
@media(max-width:380px){.forecastPlans article{grid-template-columns:1fr}.forecastPlans span{text-align:left;white-space:normal}}
.presetGrid{display:grid;grid-template-columns:1fr;gap:10px;margin:12px 0 14px}.preset{border:1px solid rgba(101,245,172,.22);border-radius:16px;background:rgba(101,245,172,.06);color:#eafff3;text-align:left;padding:12px}.preset b{display:block;font-size:13px;letter-spacing:.08em;text-transform:uppercase}.preset small{display:block;margin-top:5px;color:#9fb7aa;line-height:1.35}
.allocBox{border:1px solid rgba(101,245,172,.18);border-radius:16px;padding:12px;margin:14px 0;background:rgba(101,245,172,.035)}.allocBox h3{margin:0;font-size:13px}.allocationRows{display:grid;gap:8px;margin-top:10px}.allocationRows article{display:grid;grid-template-columns:32px 1fr 74px 34px;gap:8px;align-items:center;padding:9px;border:1px solid #1a2923;border-radius:12px;background:#0b1512}.allocationRows input,.allocAdd input{width:100%;background:#070b0a;color:#e8f3ed;border:1px solid #274335;border-radius:9px;padding:8px}.allocationRows button,.allocAdd button,#suggestAlloc{border:1px solid #274335;background:#10231b;color:#65f5ac;border-radius:9px;padding:8px}.allocAdd{display:grid;grid-template-columns:1fr auto;gap:8px;margin:10px 0}.primary:disabled{opacity:.45}

/* Paleta de graficos: el par categorico (#3987e5 / #d95926) paso los 6 checks
   del validador sobre la superficie #0f1816 (CVD deltaE 26.8, contraste OK). */
.viz{--viz-linea:#5eeec8;--viz-macd:#3987e5;--viz-signal:#d95926;
--viz-pos:#5eeec8;--viz-neg:#ff7080;--viz-grid:rgba(255,255,255,.07);--viz-ink:var(--muted)}
.viz svg{width:100%;display:block;overflow:visible}
.viz .gridline{stroke:var(--viz-grid);stroke-width:1}
.viz .serie{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.viz .banda{fill:rgba(255,255,255,.04)}
.viz .cross{stroke:var(--viz-ink);stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
.viz .ejelbl{fill:var(--viz-ink);font-size:9px}
.vizHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:14px 0 2px}
.vizHead b{font-size:12px}.vizHead span{font-size:11px;color:var(--muted)}
.vizLeg{display:flex;gap:12px;font-size:10px;color:var(--muted);margin-top:4px}
.vizLeg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
#vizTip{position:fixed;pointer-events:none;background:#0b1211;border:1px solid var(--line);
border-radius:6px;padding:8px 10px;font-size:11px;z-index:99;display:none;line-height:1.5}
.clickable{cursor:pointer}
/* Layout fluido: se adapta de forma continua al ancho real del navegador,
   en vez de saltar entre breakpoints fijos. */
img,svg{max-width:100%}
html,body{overflow-x:hidden}
*{min-width:0}
.shell{width:min(100%,1120px);padding-left:clamp(8px,2.5vw,20px);padding-right:clamp(8px,2.5vw,20px)}
h1{font-size:clamp(20px,5.5vw,28px)}
.portfolio strong{font-size:clamp(26px,7.5vw,40px)}
.metrics strong{font-size:clamp(16px,4.2vw,20px)}
.card{padding:clamp(14px,3.5vw,20px)}
/* auto-fit + min(): nunca desborda en pantallas muy angostas */
.metrics{grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))}
.actionGrid{grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))}
/* las rejillas del template van con estilo inline; se sobreescriben por atributo */
[style*="1fr 1fr 1fr"]{grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))!important}
[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr))!important}
.sectionHead{flex-wrap:wrap;gap:8px}
.assets article,.movements article{grid-template-columns:clamp(30px,8vw,40px) 1fr auto;gap:clamp(6px,2vw,12px)}
dialog{width:min(94vw,620px);max-height:88vh;overflow:auto;padding:0}
.logRows,.proposalBody{max-width:100%;overflow-x:auto}
pre{white-space:pre-wrap;word-break:break-word}
/* el bloque de rango va absolute y se encimaba con el total en anchos chicos */
@media(max-width:620px){
  .portfolio>div{flex-direction:column;align-items:stretch}
  .portfolio .range{position:static;min-width:0;text-align:left;margin-top:14px}
  .rangeButtons{justify-content:flex-start;flex-wrap:wrap}
}
/* la barra avanza cada segundo: transicion lineal de 1s para que se vea fluida */
#cycleProgress{transition:width 1s linear!important}
@keyframes latido{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
.status.online i{animation:latido 1.6s ease-in-out infinite}
.market{scrollbar-width:thin}


/* --- Tarjetas de decisiones/planes/movimientos -------------------------
   Estas clases las genera el JS y no existian en la CSS de la APK: sin
   estilo, los textos quedaban pegados unos encima de otros. */
/* La CSS de la APK define .decisions article como rejilla de 2 columnas para
   una estructura distinta a la que genera este panel: el segundo <small>
   caia en la columna estrecha y el texto quedaba vertical. Se necesita la
   misma especificidad (0,1,1) para poder anularla. */
.decisions article,.forecastPlans article,.movements article,.assets article,
.decision,.plan,.movement{
  display:block;padding:10px 12px;margin:0 0 6px;
  background:rgba(94,238,200,.05);border:1px solid var(--line);border-radius:10px}
.decision small,.plan small,.movement small{display:block;margin-top:3px;line-height:1.45}
.decision b,.plan b,.movement b{font-size:13px;line-height:1.4}
.badge{display:inline-block;padding:3px 8px;border-radius:4px;font-size:10px;
  font-weight:600;background:rgba(94,238,200,.15);color:var(--green);white-space:nowrap}
.row{display:block;padding:10px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row b{line-height:1.4}
.row small{display:block;margin-top:4px;line-height:1.5}
/* La CSS de la APK fuerza svg{height:140px}; mis paneles tienen viewBox
   distintos y quedaban aplastados. Que la altura salga del viewBox. */
.viz svg{height:auto}

/* la razon larga necesita fluir en varias lineas, no quedar en una columna */
.decisions article > small,.forecastPlans article > small{
  display:block;width:auto;white-space:normal;overflow-wrap:break-word;margin-top:3px}
.decisions article > .decisionHead{width:auto}
/* el badge no debe crear una columna propia */
.decisions span.badge{white-space:nowrap;color:var(--green)}
/* --- Anti-solapamiento -------------------------------------------------
   Los textos largos (fecha+hora+estado en la cabecera, "PILOTO AUTO ·
   RUNNER TARDE", razones de la IA) se salian de contenedores pensados para
   una sola linea corta. Se permite que fluyan en varias lineas. */
.topbar > div{flex-wrap:wrap;gap:8px}
.topbar > div > div{min-width:0;flex:1 1 auto}
/* la insignia de version lleva fecha, estado y reloj: debe poder partirse */
.topbar .status{white-space:normal}
h1{overflow-wrap:break-word}
.metrics strong{line-height:1.35;overflow-wrap:break-word;white-space:normal}
.metrics small{display:block;overflow-wrap:break-word}
/* el watchlist scrollea en horizontal: cada tarjeta necesita ancho propio */
.market article{min-width:150px}
.market b,.market span,.market small{display:block;white-space:nowrap}
.market small{white-space:normal}
/* filas de activos e historial: la columna central es la que debe ceder */
.assets article,.movements article{align-items:start}
.assets b,.movements b,.assets small,.movements small{overflow-wrap:break-word;white-space:normal}
.assetValue,.txValue{white-space:nowrap}
/* razones y decisiones: texto largo sin cortar palabras a medias */
.decision small,.plan small,.row small,.notice,#liveHoldReason{overflow-wrap:break-word}
.decisionHead{display:flex;align-items:baseline;justify-content:space-between;
  gap:8px;flex-wrap:wrap;margin-bottom:2px}
.decisionHead b{flex:1 1 auto;min-width:8ch}
/* los articulos de estas rejillas no deben poder colapsar a cero */
.decisions > *,.forecastPlans > *,.movements > *,.assets > *{min-width:0}
.decisions,.forecastPlans{min-width:0}
/* cabeceras de los paneles de grafico */
.vizHead{flex-wrap:wrap}
.vizHead b,.vizHead span{overflow-wrap:break-word}
/* rejilla del ciclo: los valores largos ya no empujan a la etiqueta */
#lastDecision,#lastTrade{white-space:normal;overflow-wrap:break-word;text-overflow:clip}
/* formularios de modalidades en pantallas estrechas */
#stratBody label{display:block;overflow-wrap:break-word}
#stratBody input{max-width:100%}
/* botones del centro de control */
.actionGrid button{overflow-wrap:break-word}
/* en escritorio ancho aprovecha el espacio en dos columnas */
@media(min-width:1000px){
  .shell{grid-template-columns:1fr 1fr;align-items:start}
  .topbar,.portfolio{grid-column:1 / -1}
}
</style></head><body><div id='app'><main class="shell">
<header class="topbar">
  <div>
    <p class="eyebrow">TRADEBOT AI</p>
    <h1>crypto<span>_</span>bot</h1>
    <div style="margin-top:8px;padding:8px 12px;background:rgba(94,238,200,.12);border-radius:8px;border:1px solid rgba(94,238,200,.2);font-size:10px;font-weight:600">
      <span id="appVersion" style="color:var(--green)">v1.4.3</span> · CLOUD READY · <span id="connection" class="status" style="display:inline-flex;margin:0"><i></i><span>conectando</span></span>
    </div>
  </div>
</header>

<section class="portfolio card">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <p class="label">VALOR TOTAL</p>
      <strong id="total" style="display:block;margin:8px 0">$—</strong>
      <p id="updated" class="muted" style="margin:0">Datos del motor</p>
    </div>
    <div class="range" style="text-align:right">
      <div class="rangeButtons">
        <button class="active" data-range="live">LIVE</button>
        <button data-range="1d">1D</button>
        <button data-range="1w">1S</button>
        <button data-range="1m">1M</button>
      </div>
      <span id="delta" style="display:block;margin-top:12px;font-size:16px;font-weight:700">—</span>
    </div>
  </div>
  <svg id="chart" viewBox="0 0 600 170" role="img" aria-label="Evolución de cartera" style="margin-top:12px">
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5eeec8" stop-opacity=".3"/>
        <stop offset="1" stop-color="#5eeec8" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="area"/>
    <path class="line"/>
  </svg>
</section>

<section class="metrics">
  <article class="card">
    <p class="label">MOTOR</p>
    <strong id="engineState">—</strong>
    <small id="heartbeat">sin conexión</small>
  </article>
  <article class="card">
    <p class="label">MODO / IA</p>
    <strong><span id="tradeMode">—</span> · <span id="aiState">—</span></strong>
    <small id="aiModel">esperando modelo</small>
  </article>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">CICLO CLOUD</p>
      <h2 id="cycleState">Esperando runner</h2>
    </div>
    <span id="cycleTimer" style="font-size:12px;font-weight:600">—</span>
  </div>
  <div class="progress" style="height:6px;background:var(--line);border-radius:3px;margin:12px 0;overflow:hidden">
    <i id="cycleProgress" style="display:block;height:100%;background:var(--green);width:0%;transition:width .2s;box-shadow:0 0 8px var(--green)"></i>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px">
    <div style="padding:8px;background:rgba(94,238,200,.05);border-radius:8px;border:1px solid var(--line)">
      <b id="cycleNumber" style="display:block;font-size:16px">—</b>
      <small class="muted">Ciclo</small>
    </div>
    <div style="padding:8px;background:rgba(94,238,200,.05);border-radius:8px;border:1px solid var(--line)">
      <b id="lastDecision" style="display:block;font-size:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">—</b>
      <small class="muted">Última decisión</small>
    </div>
    <div style="padding:8px;background:rgba(94,238,200,.05);border-radius:8px;border:1px solid var(--line)">
      <b id="lastTrade" style="display:block;font-size:16px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">—</b>
      <small class="muted">Última operación</small>
    </div>
  </div>
  <p id="cycleHint" class="muted" style="margin-top:10px;margin-bottom:0">GitHub Actions ejecuta el runner remoto por ciclos.</p>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">ESTADO EN VIVO</p>
      <h2>Bot e IA</h2>
    </div>
    <span id="livePulse" style="font-size:11px">—</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <article style="padding:10px;background:rgba(94,238,200,.08);border-radius:8px;border:1px solid rgba(94,238,200,.15)">
      <small class="muted" style="display:block;margin-bottom:4px">IA</small>
      <b id="liveAiSeen" style="font-size:12px">—</b>
    </article>
    <article style="padding:10px;background:rgba(94,238,200,.08);border-radius:8px;border:1px solid rgba(94,238,200,.15)">
      <small class="muted" style="display:block;margin-bottom:4px">Runner</small>
      <b id="liveCycleSeen" style="font-size:12px">—</b>
    </article>
  </div>
  <div style="padding:10px;background:rgba(94,238,200,.05);border-left:2px solid var(--green);border-radius:4px">
    <small class="muted">Última señal IA</small>
    <b id="liveLastSignal" style="display:block;font-size:12px;margin-top:4px">—</b>
  </div>
  <div style="padding:10px;background:rgba(94,238,200,.05);border-left:2px solid var(--green);border-radius:4px;margin-top:8px">
    <small class="muted">Razón actual</small>
    <p id="liveHoldReason" style="margin:4px 0 0;font-size:12px">Esperando datos…</p>
  </div>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">MERCADO TIEMPO REAL</p>
      <h2>Watchlist</h2>
    </div>
    <button id="refresh" style="padding:7px 12px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-size:10px;font-weight:600">ACTUALIZAR</button>
  </div>
  <div id="market" class="market"><p class="muted">Cargando…</p></div>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">DECISIONES IA</p>
      <h2>Señales en vivo</h2>
    </div>
    <span id="decisionLive" style="font-size:10px;font-weight:600">AUTO</span>
  </div>
  <div id="decisions" class="decisions" style="display:grid;gap:8px"><p class="muted">Cargando…</p></div>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">PREDICCIÓN 1D</p>
      <h2>Órdenes condicionadas</h2>
    </div>
    <span id="forecastMode" style="font-size:11px;font-weight:600">1D</span>
  </div>
  <p id="forecastSummary" class="muted" style="margin:0 0 12px">Cargando escenarios…</p>
  <button id="newOrder" style="width:100%;padding:10px;margin-bottom:12px;background:rgba(94,238,200,.15);border:1px solid var(--line);color:var(--ink);border-radius:8px;font-weight:600;font-size:12px">+ NUEVA ORDEN</button>
  <div id="forecastPlans" class="forecastPlans" style="display:grid;gap:8px"><p class="muted">Cargando…</p></div>
  <p id="forecastNote" class="notice" style="margin-top:12px;margin-bottom:0">Referencia 1D para decisiones; no garantiza ganancias.</p>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">DISTRIBUCIÓN</p>
      <h2>Activos en cartera</h2>
    </div>
  </div>
  <div id="assets" class="assets"><p class="muted">Cargando…</p></div>
</section>

<section class="card">
  <div class="sectionHead">
    <div>
      <p class="label">HISTORIAL</p>
      <h2>Movimientos ejecutados</h2>
    </div>
  </div>
  <div id="movements" class="movements"><p class="muted">Cargando…</p></div>
</section>

<section class="card">
  <div>
    <p class="label">CENTRO DE CONTROL</p>
    <h2>Autoridad de trading</h2>
  </div>
  <div class="actionGrid">
    <button id="start"><span>INICIAR</span><small>Activar motor</small></button>
    <button id="modeToggle"><span>MODO</span><small id="modeLabel">Semiautomático</small></button>
    <button id="pause"><span>PAUSAR</span><small>Pausar trading</small></button>
    <button id="logs"><span>LOGS</span><small>IA & Operaciones</small></button>
    <button id="config"><span>CONFIG</span><small>Parámetros</small></button>
    <button id="stop" class="danger"><span>STOP</span><small>Emergencia</small></button>
  </div>
  <button id="checkUpdate" style="width:100%;padding:12px;margin-top:14px;background:linear-gradient(135deg,rgba(94,238,200,.2),rgba(94,238,200,.08));border:1.5px solid var(--line);color:var(--ink);border-radius:10px;font-weight:600"><span style="display:block">🔄 ACTUALIZAR APP</span><small id="updateLabel" style="display:block;font-size:10px;opacity:.8;margin-top:4px">Comprobar versión disponible</small></button>
  <p id="receipt" class="notice" style="margin-top:12px;margin-bottom:0" aria-live="polite">Cada acción requiere confirmación y genera recibo.</p>
</section>
</main>

<dialog id="logsDialog"><div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2 style="margin:0">IA / TRADING LOGS</h2><small id="logsLive" style="color:var(--muted)">LIVE · actualizando</small></div><button data-close="logsDialog" style="background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">CERRAR</button></div><div id="logRows" class="logRows" tabindex="0"></div></div></dialog>

<dialog id="proposalDialog"><div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2 style="margin:0">PROPUESTA DEL BOT</h2><small style="color:var(--muted)">Requiere autorización</small></div><button data-close="proposalDialog" style="background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">CERRAR</button></div><div id="proposalBody" class="proposalBody"></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><button id="rejectProposal" class="danger" style="padding:10px;border-radius:8px;background:rgba(255,112,128,.15);border:1px solid rgba(255,112,128,.3);color:#ffb0b8;font-weight:600">RECHAZAR</button><button id="acceptProposal" class="primary" style="padding:10px;border-radius:8px;background:var(--green);color:var(--bg);border:none;font-weight:600">ACEPTAR</button></div></div></dialog>

<dialog id="orderDialog"><div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2 style="margin:0">ORDEN CONDICIONADA</h2><small style="color:var(--muted)">Se ejecuta al trigger</small></div><button data-close="orderDialog" style="background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">CERRAR</button></div><form id="orderForm" class="configForm"><input name="id" type="hidden"><label><span>Símbolo<small>BTC, ETH, POL…</small></span><input name="symbol" maxlength="12" required></label><label><span>Lado<small>BUY o SELL</small></span><select name="side"><option>BUY</option><option>SELL</option></select></label><label><span>Trigger USD<small>Precio de activación</small></span><input name="trigger_price_usd" type="number" step="any" required></label><label><span>Monto USD<small>Valor de la orden</small></span><input name="notional" type="number" step="0.01" required></label><label><span>Nota<small>Opcional</small></span><input name="note" maxlength="160"></label></form><p id="orderEstimate" class="notice" style="margin:12px 0">Estimación pendiente.</p><button id="saveOrder" style="width:100%;padding:10px;background:var(--green);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:12px">GUARDAR ORDEN</button></div></dialog>

<dialog id="updateDialog"><div style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><h2 style="margin:0">🆕 NUEVA VERSIÓN</h2><small id="updateDialogVersion" style="color:var(--muted)">v1.4.2</small></div><button data-close="updateDialog" style="background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">CERRAR</button></div><div style="padding:12px;background:rgba(94,238,200,.05);border-radius:8px;border:1px solid var(--line)"><p id="updateMsg" class="muted" style="margin:0">Cargando detalles...</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><button id="skipUpdate" style="padding:10px;border-radius:8px;background:rgba(255,112,128,.15);border:1px solid rgba(255,112,128,.3);color:#ffb0b8;font-weight:600">DESPUÉS</button><button id="downloadUpdate" style="padding:10px;border-radius:8px;background:var(--green);color:var(--bg);border:none;font-weight:600">DESCARGAR</button></div></div></dialog>

<dialog id="configDialog"><div style="padding:14px"><h2>CONFIGURACIÓN SEGURA</h2><button data-close="configDialog" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">✕</button><p class="muted" style="margin:8px 0 16px">Solo parámetros autorizados. Los rangos son límites duros.</p><div id="configPresets" class="presetGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px"></div><section class="allocBox"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div><h3 style="margin:0">DISTRIBUCIÓN OBJETIVO</h3><small id="allocSum" style="color:var(--muted)">Suma 0%</small></div><button id="suggestAlloc" type="button" style="padding:6px 10px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-size:10px;font-weight:600">AUTO IA</button></div><p class="muted" style="margin:0 0 10px;font-size:11px">Edita porcentajes por activo. Deben sumar 100%.</p><div id="allocationRows" class="allocationRows"></div><div class="allocAdd" style="display:flex;gap:6px;margin-top:10px"><input id="newAsset" placeholder="NUEVO ACTIVO" maxlength="12" style="flex:1;padding:8px;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:6px"><button id="addAsset" type="button" style="padding:8px 12px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-weight:600;font-size:11px">AGREGAR</button></div><button id="saveAllocation" style="width:100%;padding:10px;margin-top:10px;background:var(--green);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:12px">GUARDAR DISTRIBUCIÓN</button></section><form id="configForm" class="configForm" style="margin-top:16px"></form><button id="saveConfig" style="width:100%;padding:10px;background:var(--green);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:12px">REVISAR Y GUARDAR</button></div></dialog></div><script>var API='https://crypto-bot-api.crypto-bot-desk.workers.dev';var TOKEN='crypto_bot_mobile_7e5abd730812890a86e76cd90e93682c';var range='live';var lastStatus=null;var precios={};var propActual=null;function el(i){return document.getElementById(i)}function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}function money(v){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(v)||0)}function px(v){v=Number(v)||0;var d=v<1?6:v<10?4:2;return 'USD '+new Intl.NumberFormat('es-MX',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v)}var TZ='America/Mazatlan';function hhmm(t){try{return new Date(t).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:TZ})}catch(e){return '-'}}function fecha(t){try{return new Date(t).toLocaleString('es-MX',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:TZ})}catch(e){return '-'}}function setConn(ok,txt){var c=el('connection');c.className=ok?'status online':'status offline';c.style.display='inline-flex';c.style.margin='0';c.innerHTML='<i></i><span>'+esc(txt)+'</span>'}window.onerror=function(m){setConn(false,'js: '+m);return false};async function req(p,m,b){var h={'Accept':'application/json'};if(TOKEN){h['Authorization']='Bearer '+TOKEN}if(b){h['Content-Type']='application/json'}var r=await fetch(API+p,{method:m||'GET',headers:h,body:b?JSON.stringify(b):undefined});var j=null;try{j=await r.json()}catch(e){}if(!r.ok){throw new Error(traduce((j&&j.detail)||('API '+r.status)))}return j}function traduce(d){d=String(d);var m=d.match(/^buy_orders_exceed_free_usdc_([0-9.]+)_available_([0-9.]+)$/);if(m){return 'Las compras activas comprometen '+money(m[1])+' pero solo hay '+money(m[2])+' libres. Cancela alguna orden de compra para liberar capital.'}m=d.match(/^sell_orders_exceed_held_([0-9.]+)_available_([0-9.]+)$/);if(m){return 'Las ventas activas suman '+money(m[1])+' pero solo tienes '+money(m[2])+' de ese activo.'}m=d.match(/^amount_usdc_must_be_([0-9.]+)_([0-9.]+)$/);if(m){return 'El monto de compra debe estar entre '+money(m[1])+' y '+money(m[2])+'.'}m=d.match(/^value_usd_must_be_([0-9.]+)_([0-9.]+)$/);if(m){return 'El monto de venta debe estar entre '+money(m[1])+' y '+money(m[2])+'.'}if(d==='buy_trigger_must_be_below_current_price'){return 'En una compra el trigger debe quedar por DEBAJO del precio actual.'}if(d==='sell_trigger_must_be_above_current_price'){return 'En una venta el trigger debe quedar por ENCIMA del precio actual.'}if(d.indexOf('base_assets_required')===0){return 'No puedes eliminar los activos base (USDC, BTC, ETH, CRO, SOL, XRP).'}return d}function chart(series){var svg=el('chart');if(!svg)return;var pts=(series||[]).map(function(p){return Number(p.value_usd)||0});var area=svg.querySelector('.area'),line=svg.querySelector('.line');if(pts.length<2){if(line)line.setAttribute('d','');if(area)area.setAttribute('d','');return}var W=600,H=170,mn=Math.min.apply(null,pts),mx=Math.max.apply(null,pts),rg=(mx-mn)||1;var d='',a='';for(var k=0;k<pts.length;k++){var x=k*(W/(pts.length-1));var y=H-10-((pts[k]-mn)/rg)*(H-24);d+=(k?' L':'M')+x.toFixed(1)+' '+y.toFixed(1)}a=d+' L'+W+' '+H+' L0 '+H+' Z';if(line){line.setAttribute('d',d);line.setAttribute('fill','none');line.setAttribute('stroke','#5eeec8');line.setAttribute('stroke-width','2')}if(area){area.setAttribute('d',a);area.setAttribute('fill','url(#fill)')}}function renderDash(d){el('total').textContent=money(d.total_usd);el('updated').textContent=d.as_of?('Motor '+hhmm(d.as_of)+' h Culiacan'):'Datos del motor';var p=d.performance_1d;if(p){var s=Number(p.change_usd)||0,pc=Number(p.change_pct)||0;var dl=el('delta');dl.textContent=(s>=0?'+':'')+money(s)+' ('+(pc>=0?'+':'')+pc.toFixed(2)+'%)';dl.className=s>=0?'up':'down'}chart(d.series);var mk=d.market||[];el('market').innerHTML=mk.length?mk.map(function(q){var ch=Number(q.change_24h)||0;return '<article class=clickable data-sym="'+esc(q.symbol)+'"><b>'+esc(q.symbol)+'</b><span>'+px(q.price_usd)+'</span>'+'<small class='+(ch>=0?'up':'down')+'>'+(ch>=0?'+':'')+ch.toFixed(2)+'%</small>'+'<small class=muted>ver grafico</small></article>'}).join(''):'<p class=muted>Sin mercado</p>';precios={};for(var pi=0;pi<mk.length;pi++){precios[mk[pi].symbol]=Number(mk[pi].price_usd)||0}var as=d.assets||[];el('assets').innerHTML=as.length?as.map(function(x){return '<article class=clickable data-sym="'+esc(x.symbol)+'"><b>'+esc(x.symbol)+'</b><span>'+money(x.value_usd)+'</span>'+'<small>'+((Number(x.weight)||0)*100).toFixed(1)+'% de cartera - ver grafico</small></article>'}).join(''):'<p class=muted>Sin activos</p>';enlazaClicks()}function enlazaClicks(){var el2=document.querySelectorAll('[data-sym]');for(var i=0;i<el2.length;i++){(function(n){n.onclick=function(){abreIndicadores(n.getAttribute('data-sym'))}})(el2[i])}}var tick={next:null,prog:0,intv:300,at:0};function pintaTick(){if(!tick.at){return}var dt=(Date.now()-tick.at)/1000;if(tick.next!=null){var q=Math.max(0,tick.next-dt);el('cycleTimer').textContent=(q>=60?(Math.floor(q/60)+'m '+Math.floor(q%60)+'s'):(Math.ceil(q)+'s'))}var p=Math.min(1,(Number(tick.prog)||0)+dt/(tick.intv||300));el('cycleProgress').style.width=(p*100).toFixed(1)+'%'}function relojLocal(){var e=el('relojTZ');if(e){e.textContent=new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:TZ})+' Culiacan'}}setInterval(function(){try{relojLocal()}catch(e){}try{pintaTick()}catch(e){}},1000);function renderRunner(s){var r=s.runner;if(!r)return;el('cycleState').textContent=r.health?String(r.health).toUpperCase():'Esperando runner';tick={next:r.seconds_to_next,prog:Number(r.progress)||0,intv:r.interval_seconds||300,at:Date.now()};pintaTick();el('cycleNumber').textContent=s.cycle!=null?s.cycle:'-';var ld=r.latest_decision&&r.latest_decision.data?r.latest_decision.data:null;el('lastDecision').textContent=ld?((ld.signal&&ld.signal.action||'HOLD')+' '+(ld.symbol||'')):'-';var lt=r.latest_trade&&r.latest_trade.data?r.latest_trade.data:null;el('lastTrade').textContent=lt?((lt.side||'')+' '+(lt.symbol||'')):'-';el('livePulse').textContent=r.health?String(r.health).toUpperCase():'-';el('liveAiSeen').textContent=s.ai_last_seen?hhmm(s.ai_last_seen):'-';el('liveCycleSeen').textContent=r.last_seen?hhmm(r.last_seen.ts):'-';if(ld){el('liveLastSignal').textContent=(ld.signal&&ld.signal.action||'HOLD')+' '+(ld.symbol||'');el('liveHoldReason').textContent=(ld.signal&&ld.signal.reason)||ld.reason||'Sin razon'}if(s.ai_error){el('liveHoldReason').textContent=s.ai_error;el('liveHoldReason').className='down';el('liveLastSignal').textContent='IA SIN RESPUESTA'}}function renderDecisions(list){el('decisions').innerHTML=(list&&list.length)?list.map(function(x){var c=x.confidence==null?'':Math.round(Number(x.confidence)*100)+'%';return '<article class=decision><div class=decisionHead><b>'+esc(x.title)+'</b>'+'<span class=badge>'+esc(x.badge||'')+'</span></div>'+'<small>'+esc(x.reason||'')+'</small>'+'<small class=muted>'+esc(x.detail||'')+(c?(' - '+c):'')+'</small></article>'}).join(''):'<p class=muted>Sin decisiones</p>'}function planKey(p){return p.side+':'+p.symbol+':'+Number(p.trigger_price_usd||0).toFixed(6)}function vistos(){try{return JSON.parse(localStorage.getItem('tb_props')||'{}')}catch(e){return {}}}function marcar(k,v){var o=vistos();o[k]=v;try{localStorage.setItem('tb_props',JSON.stringify(o))}catch(e){}}function mostrarPropuesta(p){propActual=p;var pnl=Number(p.estimated_pnl_usd)||0;var monto=p.side==='BUY'?(p.amount_usdc||0):(p.value_usd||0);el('proposalBody').innerHTML='<div class=row><b>'+esc(p.side)+' '+esc(p.symbol)+'</b> - confianza '+Math.round((Number(p.confidence)||0)*100)+'%</div>'+'<div class=row>Trigger '+px(p.trigger_price_usd)+'<br>Actual '+px(p.current_price_usd)+'</div>'+'<div class=row>Monto '+money(monto)+'<br>P/L estimado: <span class='+(pnl>=0?'up':'down')+'>'+(pnl>=0?'+':'')+money(pnl)+'</span></div>'+'<div class=row><small>'+esc(p.reason||'')+'</small></div>';el('proposalDialog').showModal()}function hayDialogoAbierto(){var ds=document.querySelectorAll('dialog');for(var i=0;i<ds.length;i++){if(ds[i].open)return true}return false}function renderForecast(f){el('forecastSummary').textContent=f.summary||'Sin escenarios';el('forecastMode').textContent=f.mode||'1D';if(f.note){el('forecastNote').textContent=f.note}var ords=f.orders||[],pl=f.plans||[],html='';for(var i=0;i<ords.length;i++){var o=ords[i];var pn=Number(o.estimated_pnl_usd)||0;html+='<article class=plan style="border-left:3px solid var(--green)">'+'<div class=decisionHead><b>'+esc(o.side)+' '+esc(o.symbol)+'</b>'+'<span class=badge>'+esc(o.status||'activa')+'</span></div>'+'<small>Trigger '+px(o.trigger_price_usd)+' - Actual '+px(o.current_price_usd)+'</small>'+'<small class='+(pn>=0?'up':'down')+'>P/L est '+(pn>=0?'+':'')+money(pn)+'</small>'+'<div style="margin-top:8px;display:flex;gap:6px">'+'<button data-cancel-order="'+esc(o.id)+'" style="padding:6px 10px;font-size:10px;background:rgba(255,112,128,.15);color:#ffb0b8;border:1px solid rgba(255,112,128,.3)">CANCELAR</button>'+'<button data-edit-order="'+esc(o.id)+'" style="padding:6px 10px;font-size:10px">EDITAR</button>'+'</div></article>'}for(var k=0;k<pl.length;k++){var p=pl[k];var pv=Number(p.estimated_pnl_usd)||0;html+='<article class=plan><div class=decisionHead><b>'+esc(p.side)+' '+esc(p.symbol)+'</b>'+'<span class=badge>'+Math.round((Number(p.confidence)||0)*100)+'%</span></div>'+'<small>Trigger '+px(p.trigger_price_usd)+' - Actual '+px(p.current_price_usd)+'</small>'+'<small class='+(pv>=0?'up':'down')+'>P/L est '+(pv>=0?'+':'')+money(pv)+'</small>'+'<small class=muted>'+esc(p.reason||'')+'</small>'+'<div style="margin-top:8px"><button data-plan="'+k+'" style="padding:6px 10px;font-size:10px">REVISAR PROPUESTA</button></div>'+'</article>'}el('forecastPlans').innerHTML=html||'<p class=muted>Sin planes ni ordenes</p>';var btns=el('forecastPlans').querySelectorAll('[data-plan]');for(var b=0;b<btns.length;b++){(function(bt){bt.onclick=function(){mostrarPropuesta(pl[Number(bt.getAttribute('data-plan'))])}})(btns[b])}var cans=el('forecastPlans').querySelectorAll('[data-cancel-order]');for(var c=0;c<cans.length;c++){(function(bt){bt.onclick=async function(){var id=bt.getAttribute('data-cancel-order');if(!confirm('Cancelar esta orden condicionada?'))return;try{await req('/api/v1/orders/cancel','POST',{confirmed:true,id:id});el('receipt').textContent='RECIBO - orden cancelada';refresh()}catch(e){alert('No se pudo cancelar: '+e.message)}}})(cans[c])}var eds=el('forecastPlans').querySelectorAll('[data-edit-order]');for(var d2=0;d2<eds.length;d2++){(function(bt){bt.onclick=function(){var id=bt.getAttribute('data-edit-order');for(var z=0;z<ords.length;z++){if(String(ords[z].id)===id){var o=ords[z];abrirOrden({id:o.id,symbol:o.symbol,side:o.side,trigger:o.trigger_price_usd,notional:o.side==='BUY'?o.amount_usdc:o.value_usd,note:o.note||''});return}}}})(eds[d2])}var esSemi=!(lastStatus&&lastStatus.autopilot_enabled);if(esSemi&&!hayDialogoAbierto()){var vs=vistos();for(var q=0;q<pl.length;q++){var kk=planKey(pl[q]);if(!vs[kk]){mostrarPropuesta(pl[q]);break}}}var fn2=el('forecastNote');if(fn2){fn2.textContent=esSemi?'Modo SEMI: cada propuesta espera tu aceptacion.':'Modo AUTO: el bot convierte sus propuestas en ordenes por si solo; aqui solo las ves.'}}function abrirOrden(pre){var f=el('orderForm');f.elements.id.value=(pre&&pre.id)||'';f.elements.symbol.value=(pre&&pre.symbol)||'';f.elements.side.value=(pre&&pre.side)||'BUY';f.elements.trigger_price_usd.value=(pre&&pre.trigger)||'';f.elements.notional.value=(pre&&pre.notional)||'';f.elements.note.value=(pre&&pre.note)||'';estimaOrden();el('orderDialog').showModal()}function estimaOrden(){var f=el('orderForm');var sy=String(f.elements.symbol.value||'').trim().toUpperCase();var tr=Number(f.elements.trigger_price_usd.value);var no=Number(f.elements.notional.value);if(!sy||!(tr>0)||!(no>0)){el('orderEstimate').textContent='Completa simbolo, trigger y monto.';return}var cur=precios[sy]||0;var t=f.elements.side.value+' '+sy+' - trigger '+px(tr);if(cur){var df=((tr-cur)/cur)*100;t+=' - actual '+px(cur)+' ('+(df>=0?'+':'')+df.toFixed(2)+'%)'}else{t+=' - sin precio de referencia'}t+=' - monto '+money(no);el('orderEstimate').textContent=t}function renderMovements(list){el('movements').innerHTML=(list&&list.length)?list.map(function(m){return '<article class=movement><div class=decisionHead><b>'+esc(m.side)+' '+esc(m.description||'')+'</b>'+'<span class=badge>'+esc(m.status||'')+'</span></div>'+'<small>'+esc(m.amount)+' '+esc(m.amount_currency)+' a '+esc(m.to_amount)+' '+esc(m.to_currency)+'</small>'+'<small class=muted>'+esc(m.value_usd)+' - '+fecha(m.ts)+'</small></article>'}).join(''):'<p class=muted>Sin movimientos</p>'}function V(x){return (x&&x.status==='fulfilled'&&x.value)?x.value:null}async function refresh(){try{// Ordenes, libro, movimientos y supervisor cambian despacio: pedirlos cada
// 15 s gastaba cuota de lecturas KV sin aportar nada. Van cada 4 refrescos.
var lento=(vueltas%4===0);vueltas++;
var peticiones=[req('/api/v1/status'),req('/api/v1/dashboard?range='+range),req('/api/v1/decisions?limit=12'),req('/api/v1/forecast')];
if(lento){peticiones.push(req('/api/v1/movements?limit=20'),req('/api/v1/orders'),req('/api/v1/ledger'),req('/api/v1/supervisor/pending'))}
var o=await Promise.allSettled(peticiones);
var s=V(o[0]),d=V(o[1]),dc=V(o[2]),fc=V(o[3]);
var mv=lento?V(o[4]):null,od=lento?V(o[5]):null,led=lento?V(o[6]):null,sup=lento?V(o[7]):null;if(od){renderOrdenes(od,s)}if(led){renderLedger(led)}if(sup){renderSupervisor(sup)}if(!s){throw new Error(o[0].reason&&o[0].reason.message||'status caido')}lastStatus=s;var bad=o.filter(function(x){return x.status!=='fulfilled'}).length;setConn(true,bad?('online - '+bad+' seccion(es) sin datos'):'online');renderRunner(s);revisaKV(s);if(d){renderDash(d)}if(dc){renderDecisions(dc.decisions)}if(fc){renderForecast(fc);revisaInactividad(s,(fc.plans||[]).length>0)}else{el('forecastSummary').textContent='Prediccion no disponible ahora'}if(mv){renderMovements(mv.movements)}
vigilaNovedades(fc,mv);el('engineState').textContent=String(s.state||'-').toUpperCase();el('tradeMode').textContent=s.autopilot_enabled?'PILOTO AUTO':(s.trading_mode||'-');el('modeLabel').textContent=s.autopilot_enabled?'Piloto automatico':'Semiautomatico';var ah=s.ai_health;var ai=el('aiState');ai.textContent=ah==='healthy'?'IA LIVE':ah==='waiting'?'IA WAIT':ah==='fallback'?'FALLBACK':ah==='stale'?'RUNNER TARDE':'IA ERROR';ai.className=ah==='healthy'?'up':(ah==='waiting'||ah==='stale')?'':'down';if(s.ai_error){el('cycleHint').textContent='IA sin responder: '+s.ai_error+' - con REQUIRE_AI_FOR_EXECUTION=YES el bot queda en HOLD y no opera.';el('cycleHint').className='notice down'}else if(ah==='stale'){el('cycleHint').textContent='Ultimo ciclo OK pero vencido: el runner de GitHub Actions no reporto a tiempo.'}el('aiModel').textContent=(s.ai_provider||'-')+' - '+(s.ai_model||'sin modelo');el('heartbeat').textContent=s.last_heartbeat?('Ultimo ciclo '+hhmm(s.last_heartbeat*1000)+' h'):'Sin ciclo remoto';el('appVersion').textContent='v1.4.5 - '+(s.trading_day||'')+' Culiacan';}catch(e){setConn(false,'offline');el('engineState').textContent='OFFLINE';el('heartbeat').textContent=e.message}}async function control(a,label){if(!confirm('Confirmar '+label+'?'))return;try{var r=await req('/api/v1/control/'+a,'POST',{confirmed:true});el('receipt').textContent='RECIBO - '+(r.receipt&&r.receipt.event||a)+' - '+hhmm(Date.now());setTimeout(refresh,1500)}catch(e){el('receipt').textContent='ERROR - '+e.message}}async function loadLogs(){el('logsLive').textContent='LIVE - '+hhmm(Date.now());try{var d=await req('/api/v1/logs?limit=80&compact=1');el('logRows').innerHTML=(d.logs||[]).map(function(x){return '<article><time>'+fecha(x.ts)+'</time><b>'+esc(x.event)+'</b>'+'<pre>'+esc(JSON.stringify(x.data||{},null,2))+'</pre></article>'}).join('')||'<p>Sin registros</p>'}catch(e){el('logRows').textContent=e.message}}async function loadConfig(){try{var d=await req('/api/v1/config');el('configForm').innerHTML=(d.parameters||[]).map(function(p){return '<label><span>'+esc(p.label)+'<small>'+esc(p.key)+' - '+p.min+' a '+p.max+'</small></span>'+'<input name='+esc(p.key)+' type=number value='+p.value+' min='+p.min+' max='+p.max+' step=any></label>'}).join('')}catch(e){el('configForm').innerHTML='<p class=down>'+esc(e.message)+'</p>'}}el('start').onclick=function(){control('start','INICIAR el motor')};el('pause').onclick=function(){control('pause','PAUSAR el trading')};el('stop').onclick=function(){control('stop','DETENER (emergencia)')};el('refresh').onclick=function(){refresh()};el('logs').onclick=function(){el('logsDialog').showModal();loadLogs()};el('config').onclick=function(){el('configDialog').showModal();loadConfig()};el('modeToggle').onclick=async function(){var next=(lastStatus&&lastStatus.autopilot_enabled)?'semi':'auto';if(!confirm('Cambiar a modo '+next+'?'))return;try{await req('/api/v1/mode','POST',{confirmed:true,mode:next});el('receipt').textContent='RECIBO - modo '+next;setTimeout(refresh,1200)}catch(e){el('receipt').textContent='ERROR - '+e.message}};el('checkUpdate').onclick=async function(){try{var v=await req('/api/v1/version');el('updateLabel').textContent='Version backend '+(v.version||v.latest||'-')}catch(e){el('updateLabel').textContent=e.message}};var nb=el('newOrder');if(nb){nb.onclick=function(){abrirOrden(null)}}var of=el('orderForm');if(of){var ins=of.querySelectorAll('input,select');for(var oi=0;oi<ins.length;oi++){ins[oi].addEventListener('input',estimaOrden);ins[oi].addEventListener('change',estimaOrden)}}el('saveOrder').onclick=async function(){var f=el('orderForm');var sy=String(f.elements.symbol.value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');var side=f.elements.side.value;var tr=Number(f.elements.trigger_price_usd.value);var no=Number(f.elements.notional.value);if(!sy||!(tr>0)||!(no>0)){alert('Completa simbolo, trigger y monto validos.');return}var pay={confirmed:true,id:f.elements.id.value||'',symbol:sy,side:side,trigger_price_usd:tr,note:f.elements.note.value||'',status:'active'};if(side==='BUY'){pay.amount_usdc=no}else{pay.value_usd=no}if(!confirm('Guardar orden REAL condicionada?'+String.fromCharCode(10)+String.fromCharCode(10)+side+' '+sy+String.fromCharCode(10)+'Trigger: '+px(tr)+String.fromCharCode(10)+'Monto: '+money(no)+String.fromCharCode(10)+String.fromCharCode(10)+'Se ejecuta cuando el runner detecte el trigger.'))return;try{await req('/api/v1/orders','POST',pay);el('orderDialog').close();el('receipt').textContent='RECIBO - orden '+side+' '+sy+' guardada';refresh()}catch(e){alert('No se pudo guardar: '+e.message)}};el('acceptProposal').onclick=async function(){var p=propActual;if(!p)return;var pay={confirmed:true,symbol:p.symbol,side:p.side,trigger_price_usd:p.trigger_price_usd,current_price_usd:p.current_price_usd,status:'active',note:'Aceptada desde panel web'};if(p.side==='BUY'){pay.amount_usdc=p.amount_usdc||0}else{pay.value_usd=p.value_usd||0}try{await req('/api/v1/orders','POST',pay);marcar(planKey(p),'aceptada');el('proposalDialog').close();propActual=null;el('receipt').textContent='RECIBO - propuesta aceptada '+pay.side+' '+pay.symbol;refresh()}catch(e){alert('No se pudo aceptar: '+e.message)}};el('rejectProposal').onclick=function(){if(propActual){marcar(planKey(propActual),'rechazada')}el('proposalDialog').close();propActual=null;el('receipt').textContent='Propuesta descartada'};var ds=document.querySelectorAll('[data-close]');for(var q=0;q<ds.length;q++){(function(b){b.onclick=function(){el(b.getAttribute('data-close')).close()}})(ds[q])}var rb=document.querySelectorAll('[data-range]');for(var z=0;z<rb.length;z++){(function(b){b.onclick=function(){for(var y=0;y<rb.length;y++){rb[y].className=''}b.className='active';range=b.getAttribute('data-range');refresh()}})(rb[z])}var vb=el('appVersion');if(vb&&vb.parentNode){var sp=document.createElement('span');sp.id='relojTZ';sp.style.color='var(--green)';vb.parentNode.appendChild(document.createTextNode(' - '));vb.parentNode.appendChild(sp)}relojLocal();var STRATS=null;var STRAT_META={grid:{t:'GRID',d:'Escalera de ordenes de compra y venta alrededor del precio',f:[['symbol','Simbolo','text'],['levels','Niveles','number'],['step_pct','Paso %','number'],['amount_usdc','USDC por nivel','number']]},dca:{t:'DCA',d:'Compra programada cada X horas, ligeramente bajo mercado',f:[['symbol','Simbolo','text'],['interval_hours','Cada (horas)','number'],['amount_usdc','USDC por compra','number'],['dip_pct','Bajo mercado %','number']]},rebalancer:{t:'PORTFOLIO BALANCER',d:'Reajusta hacia la asignacion objetivo (motor: REBALANCE)',f:[['sells_without_profit','Permitir ventas sin ganancia','bool']]},dip_buyer:{t:'DIP BUYER',d:'Comprar en retrocesos, nunca perseguir precio (motor: buy_low_policy)',f:[['max_chase_pct','Max persecucion 24h %','number']]},cro:{t:'COMPRAS DE CRO',d:'Desactivadas por defecto en el motor: CRO solo se reduce vendiendo si excede su objetivo',f:[['compras_habilitadas','Permitir comprar CRO','bool']]},universo:{t:'UNIVERSO Y ROTACION',d:'Nucleo que nunca rota y tope de activos extra para no fragmentar',f:[['nucleo','Nucleo protegido','text'],['max_extra','Max activos extra','number'],['excluir','Excluir (coma)','text']]},usdt:{t:'USDT OPERABLE',d:'Libera el saldo en USDT para venderlo contra USDT_USD y volverlo capital',f:[['operable','Habilitado','bool']]},rsi:{t:'RSI',d:'Compra en sobreventa y vende en sobrecompra, sobre velas reales',f:[['symbol','Simbolo','text'],['timeframe','Marco','text'],['period','Periodo','number'],['oversold','Sobreventa','number'],['overbought','Sobrecompra','number'],['amount_usdc','USDC','number']]},macd:{t:'MACD',d:'Cruce del histograma MACD 12/26/9 sobre velas reales',f:[['symbol','Simbolo','text'],['timeframe','Marco','text'],['amount_usdc','USDC','number']]},momentum:{t:'MOMENTUM',d:'Ranking por tendencia 7d/24h y cuantos activos evalua la IA',f:[['breakout_min_confidence','Confianza breakout','number'],['prefilter','Activos que evalua la IA','number']]}};function pintaEstrategias(){var c=el('stratBody');if(!c||!STRATS)return;var h='';for(var k in STRAT_META){if(!STRAT_META.hasOwnProperty(k))continue;var m=STRAT_META[k],v=STRATS[k]||{};h+='<article class=row style="padding:12px 0">'+'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'+'<div><b>'+m.t+'</b><br><small class=muted>'+esc(m.d)+'</small></div>'+(('enabled' in v)?('<label style="display:flex;align-items:center;gap:6px;white-space:nowrap">'+'<input type=checkbox data-st="'+k+'" '+(v.enabled?'checked':'')+'>'+'<small>'+(v.enabled?'ON':'OFF')+'</small></label></div>'):'</div>')+'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:8px;margin-top:8px">';for(var i=0;i<m.f.length;i++){var f=m.f[i];if(f[2]==='bool'){h+='<label style="font-size:11px"><input type=checkbox data-sf="'+k+'.'+f[0]+'" '+(v[f[0]]?'checked':'')+'> '+esc(f[1])+'</label>'}else{h+='<label style="font-size:11px">'+esc(f[1])+'<input data-sf="'+k+'.'+f[0]+'" type='+f[2]+' value="'+esc(v[f[0]])+'" step=any style="width:100%"></label>'}}if(k==='grid'&&GRIDDIAG){var g=GRIDDIAG;var ok=g.puede_operar;var parcial=ok&&g.niveles_financiables<g.niveles_pedidos;var col=ok?(parcial?'#ffc107':'var(--green)'):'#ff7080';var txt=ok?(parcial?('Solo se financian '+g.niveles_financiables+' de los '+g.niveles_pedidos+' niveles pedidos: cada nivel congela '+money(g.usd_por_nivel)+' y tienes '+money(g.usdc_libre)+' libres.'):('Capital suficiente para los '+g.niveles_pedidos+' niveles.')):('No se activara: un grid necesita al menos '+g.minimo_requerido+' niveles financiados ('+money(g.usdc_necesario)+'). Tienes '+money(g.usdc_libre)+' libres, alcanza para '+g.niveles_financiables+'.');h+='<p style="margin-top:8px;font-size:11px;border-left:3px solid '+col+';padding:8px 10px;background:rgba(255,255,255,.03);border-radius:4px">'+esc(txt)+'</p>'}h+='</div></article>'}c.innerHTML=h;var cbs=c.querySelectorAll('[data-st]');for(var z=0;z<cbs.length;z++){(function(b){b.onchange=function(){b.parentNode.querySelector('small').textContent=b.checked?'ON':'OFF'}})(cbs[z])}}var GRIDDIAG=null;async function cargaEstrategias(){try{var d=await req('/api/v1/strategies');STRATS=d.strategies;GRIDDIAG=d.grid_diagnostico||null;pintaEstrategias()}catch(e){var c=el('stratBody');if(c){c.innerHTML='<p class=down>'+esc(e.message)+'</p>'}}}async function guardaEstrategias(){var c=el('stratBody');if(!c||!STRATS)return;var out={};for(var k in STRAT_META){if(!STRAT_META.hasOwnProperty(k))continue;out[k]={}}var cbs=c.querySelectorAll('[data-st]');for(var i=0;i<cbs.length;i++){out[cbs[i].getAttribute('data-st')].enabled=cbs[i].checked}var fs=c.querySelectorAll('[data-sf]');for(var j=0;j<fs.length;j++){var parts=fs[j].getAttribute('data-sf').split('.');var val=fs[j].type==='checkbox'?fs[j].checked:(fs[j].type==='number'?Number(fs[j].value):fs[j].value);out[parts[0]][parts[1]]=val}var act=[];for(var q in out){if(out[q].enabled)act.push(STRAT_META[q].t)}if(!confirm('Guardar modalidades?'+String.fromCharCode(10)+String.fromCharCode(10)+'Activas: '+(act.join(', ')||'ninguna')+String.fromCharCode(10)+String.fromCharCode(10)+'Grid y DCA crearan ordenes condicionadas reales en el proximo ciclo.'))return;try{var r=await req('/api/v1/strategies','POST',{confirmed:true,strategies:out});STRATS=r.strategies;pintaEstrategias();el('receipt').textContent='RECIBO - modalidades guardadas';refresh()}catch(e){alert('No se pudo guardar: '+e.message)}}(function(){var sh=document.querySelector('.shell');if(!sh)return;var sec=document.createElement('section');sec.className='card';sec.innerHTML='<div class=sectionHead><div><p class=label>MODALIDADES</p>'+'<h2>Estrategias de trading</h2></div>'+'<button id=stratSave style="padding:7px 12px;font-size:10px">GUARDAR</button></div>'+'<div id=stratBody><p class=muted>Cargando...</p></div>'+'<p class=notice style="margin-top:12px">RSI y MACD funcionan sobre velas reales de Crypto.com. '+'Bollinger sigue pendiente. Toca cualquier activo del watchlist para ver sus graficos.</p>';var ctrl=null;var secs=sh.querySelectorAll('section.card');for(var i=0;i<secs.length;i++){if(secs[i].textContent.indexOf('CENTRO DE CONTROL')>=0){ctrl=secs[i];break}}if(ctrl){sh.insertBefore(sec,ctrl)}else{sh.appendChild(sec)}el('stratSave').onclick=guardaEstrategias;cargaEstrategias()})();function renderOrdenes(od,st){var c=el('ordBody');if(!c)return;var all=(od&&od.orders)||[];var act=all.filter(function(o){return o.status==='active'});var comprado=0,vendido=0;for(var i=0;i<act.length;i++){if(act[i].side==='BUY'){comprado+=Number(act[i].amount_usdc)||0}else{vendido+=Number(act[i].value_usd)||0}}var libre=st&&st.free_usdc!=null?Number(st.free_usdc):null;var exceso=libre!=null&&comprado>libre;var head='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));gap:8px;margin-bottom:10px">'+'<div style="padding:8px;background:rgba(94,238,200,.05);border:1px solid var(--line);border-radius:8px">'+'<b style="display:block" class='+(exceso?'down':'')+'>'+money(comprado)+'</b><small class=muted>Compras comprometidas</small></div>'+'<div style="padding:8px;background:rgba(94,238,200,.05);border:1px solid var(--line);border-radius:8px">'+'<b style="display:block">'+(libre!=null?money(libre):'-')+'</b><small class=muted>USDC libre</small></div>'+'<div style="padding:8px;background:rgba(94,238,200,.05);border:1px solid var(--line);border-radius:8px">'+'<b style="display:block">'+money(vendido)+'</b><small class=muted>Ventas comprometidas</small></div></div>';if(exceso){head+='<p class=notice style="border-left-color:#ff7080;color:#ffb0b8;background:rgba(255,112,128,.08)">'+'Tus compras activas comprometen '+money(comprado)+' pero solo hay '+money(libre)+' libres. '+'Por eso el backend rechaza aceptar nuevas compras. Cancela alguna para liberar capital.</p>'}if(!act.length){c.innerHTML=head+'<p class=muted>Sin ordenes activas</p>';return}var h='';for(var k=0;k<act.length;k++){var o=act[k];var monto=o.side==='BUY'?(o.amount_usdc||0):(o.value_usd||0);h+='<article class=row><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+'<div><b>'+esc(o.side)+' '+esc(o.symbol)+'</b> '+money(monto)+'<br><small class=muted>Trigger '+px(o.trigger_price_usd)+' - actual '+px(o.current_price_usd)+'</small></div>'+'<button data-cx="'+esc(o.id)+'" style="padding:6px 10px;font-size:10px;background:rgba(255,112,128,.15);color:#ffb0b8;border:1px solid rgba(255,112,128,.3)">CANCELAR</button>'+'</div></article>'}c.innerHTML=head+h;var bs=c.querySelectorAll('[data-cx]');for(var z=0;z<bs.length;z++){(function(bt){bt.onclick=async function(){if(!confirm('Cancelar esta orden y liberar su capital?'))return;try{await req('/api/v1/orders/cancel','POST',{confirmed:true,id:bt.getAttribute('data-cx')});el('receipt').textContent='RECIBO - orden cancelada';refresh()}catch(e){alert(e.message)}}})(bs[z])}}(function(){var sh=document.querySelector('.shell');if(!sh)return;var sec=document.createElement('section');sec.className='card';sec.innerHTML='<div class=sectionHead><div><p class=label>ORDENES ACTIVAS</p>'+'<h2>Capital comprometido</h2></div>'+'<button id=pushBtn style="padding:7px 12px;font-size:10px">ACTIVAR NOTIFICACIONES</button>'+'</div><div id=ordBody><p class=muted>Cargando...</p></div>';var ref=null;var secs=sh.querySelectorAll('section.card');for(var i=0;i<secs.length;i++){if(secs[i].textContent.indexOf('MODALIDADES')>=0){ref=secs[i];break}}if(ref){sh.insertBefore(sec,ref)}else{sh.appendChild(sec)}el('pushBtn').onclick=activaPush;estadoPush()})();function b64ToU8(b){var pad='='.repeat((4-b.length%4)%4);var raw=atob((b+pad).replace(/-/g,'+').replace(/_/g,'/'));var arr=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++){arr[i]=raw.charCodeAt(i)}return arr}async function activaPush(){
if(enApp){await preparaAvisosApp();await avisaApp("TradBot IA","Notificaciones activadas en la app.");return}if(!('serviceWorker' in navigator)||!('PushManager' in window)){alert('Este navegador no soporta notificaciones push.');return}try{var perm=await Notification.requestPermission();if(perm!=='granted'){alert('Permiso de notificaciones denegado.');return}var reg=await navigator.serviceWorker.register('sw.js');await navigator.serviceWorker.ready;var v=await req('/api/v1/push/vapid');if(!v.configured){alert('El servidor no tiene VAPID configurado.');return}var sub=await reg.pushManager.getSubscription();if(!sub){sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(v.public_key)})}await req('/api/v1/push/subscribe','POST',{subscription:sub.toJSON()});var b=el('pushBtn');if(b){b.textContent='NOTIFICACIONES ON'}el('receipt').textContent='Notificaciones activadas en este dispositivo'}catch(e){alert('No se pudo activar: '+e.message)}}async function estadoPush(){var b=el('pushBtn');if(!b)return;try{if(!('serviceWorker' in navigator))return;var reg=await navigator.serviceWorker.getRegistration();if(reg){var sb=await reg.pushManager.getSubscription();if(sb&&Notification.permission==='granted'){b.textContent='NOTIFICACIONES ON'}}}catch(e){}}var escTimer=null,escLeft=60,escActiva=false;(function(){var d=document.createElement('dialog');d.id='escDialog';d.innerHTML='<div style="padding:16px">'+'<h2 style="margin:0 0 4px">Sin respuesta a las propuestas</h2>'+'<small class=muted>Llevas mas de 30 minutos sin aceptar ni descartar</small>'+'<p style="margin:14px 0">El bot pasara a <b>modo automatico</b> y aceptara sus propias '+'propuestas en <b id=escSeg>60</b> s.</p>'+'<div class=progress style="height:6px;background:var(--line);border-radius:3px;overflow:hidden;margin:10px 0">'+'<i id=escBar style="display:block;height:100%;background:var(--green);width:100%;transition:width 1s linear"></i></div>'+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">'+'<button id=escCancel class=danger style="padding:10px;border-radius:8px;background:rgba(255,112,128,.15);'+'border:1px solid rgba(255,112,128,.3);color:#ffb0b8;font-weight:600">SEGUIR EN SEMI</button>'+'<button id=escNow style="padding:10px;border-radius:8px;background:var(--green);color:var(--bg);'+'border:none;font-weight:600">PASAR A AUTO YA</button></div></div>';document.body.appendChild(d)})();async function pasaAuto(){paraEsc();try{await req('/api/v1/mode','POST',{confirmed:true,mode:'auto'});await req('/api/v1/proposals/ack','POST',{motivo:'escalada_a_auto'});el('receipt').textContent='RECIBO - modo AUTO activado por inactividad';refresh()}catch(e){el('receipt').textContent='ERROR - '+e.message}}function paraEsc(){if(escTimer){clearInterval(escTimer);escTimer=null}escActiva=false;var d=el('escDialog');if(d&&d.open){d.close()}}async function cancelaEsc(){paraEsc();try{await req('/api/v1/proposals/ack','POST',{motivo:'escalada_cancelada'});el('receipt').textContent='Sigues en modo SEMI; el contador se reinicio'}catch(e){el('receipt').textContent='ERROR - '+e.message}}function abreEsc(){if(escActiva)return;escActiva=true;escLeft=60;var d=el('escDialog');if(!d)return;el('escSeg').textContent='60';el('escBar').style.width='100%';d.showModal();el('escCancel').onclick=cancelaEsc;el('escNow').onclick=pasaAuto;escTimer=setInterval(function(){escLeft--;if(el('escSeg')){el('escSeg').textContent=String(Math.max(0,escLeft))}if(el('escBar')){el('escBar').style.width=Math.max(0,(escLeft/60)*100)+'%'}if(escLeft<=0){pasaAuto()}},1000)}async function revisaInactividad(st,hayPlanes){if(!st)return;if(st.autopilot_enabled){paraEsc();return}if(!hayPlanes){paraEsc();return}var idle=st.semi_idle_seconds;var lim=Number(st.semi_idle_limit||1800);if(idle==null){try{await req('/api/v1/proposals/ack','POST',{motivo:'baseline'})}catch(e){}return}if(idle>lim){abreEsc()}}function renderLedger(L){var c=el('ledBody');if(!c||!L)return;var r=L.resumen||{};var res=Number(r.resultado_trading_usd||0);var sinFlujos=(L.flows||[]).length===0;var h='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:8px">';var real=Number(r.resultado_realizado_usd||0);var ncerr=Number(r.operaciones_cerradas||0);var celdas=[['Depositos',money(r.depositos_usd),''],['Retiros',money(r.retiros_usd),''],['Valor inicial '+(r.desde?String(r.desde).slice(5,10):''),money(r.valor_inicial_usd),''],['Valor actual',money(r.valor_actual_usd),''],['Resultado trading',(res>=0?'+':'')+money(res),(res>=0?'up':'down')],['P/L realizado ('+ncerr+' cerradas)',(real>=0?'+':'')+money(real),(real>=0?'up':'down')],['Coste de friccion ('+Number(r.conversiones||0)+' conversiones)',money(Number(r.costo_friccion_usd||0)),(Number(r.costo_friccion_usd||0)>=0?'':'down')]];for(var i=0;i<celdas.length;i++){h+='<div style="padding:8px;background:rgba(94,238,200,.05);'+'border:1px solid var(--line);border-radius:8px"><b style="display:block" class='+celdas[i][2]+'>'+celdas[i][1]+'</b><small class=muted>'+celdas[i][0]+'</small></div>'}h+='</div>';h+='<p class=notice style="margin-top:10px"><b>Que mide cada uno.</b> '+'&quot;Resultado trading&quot; es un estimado por diferencia de valor de cartera desde el '+(r.desde?String(r.desde).slice(0,10):'inicio del libro')+'; arrastra cualquier deposito o retiro que no quedara registrado y las comisiones de conversion. '+'&quot;P/L realizado&quot; es la suma exacta de las operaciones ya cerradas: ese es el resultado '+'real del bot operando. &quot;Coste de friccion&quot; es lo que se pierde por el spread al cambiar '+'una stablecoin por otra: la comision esta exenta, pero cambiar USDT por USDC cuesta ~1.9%. '+'No es trading, es el precio de mover dinero.</p>';if(sinFlujos){h+='<p class=notice style="margin-top:10px">El libro arranca vacio: aun no ha '+'registrado depositos ni retiros, asi que el resultado de arriba es solo la variacion de valor '+'y NO descuenta el dinero que metiste. Sera exacto a partir de los movimientos de hoy.</p>'}else{h+='<div style="margin-top:10px">';var fl=L.flows||[];for(var k=0;k<fl.length&&k<12;k++){var f=fl[k];var etiqueta=f.kind==='conversion'?'CONVERSION':f.kind==='operacion'?'OPERACION':(f.kind==='deposito'?'INGRESO':'EGRESO');
var clase=(f.kind==='conversion'||f.kind==='operacion')?'muted':(f.kind==='deposito'?'up':'down');
h+='<article class=row><b class='+clase+'>'+etiqueta+' '+esc(f.symbol)+'</b> '+money(f.value_usd)+'<br><small class=muted>'+fecha(f.ts)+' - cantidad '+esc(f.amount)+'</small></article>'}h+='</div>'}c.innerHTML=h}var supPend=null;function renderSupervisor(sp){var hay=sp&&sp.cambios&&Object.keys(sp.cambios).length;if(!hay){supPend=null;var dd=el('supDialog');if(dd&&dd.open){dd.close()}return}if(supPend&&supPend.ts===sp.ts)return;supPend=sp;var filas='';for(var k in sp.cambios){if(!sp.cambios.hasOwnProperty(k))continue;filas+='<article class=row><b>'+esc(k)+'</b><br><small>'+esc(String(sp.previos&&sp.previos[k]))+'  ->  <b class=up>'+esc(String(sp.cambios[k]))+'</b></small></article>'}el('supBody').innerHTML='<p class=muted>Propuesto '+fecha(sp.ts)+'</p>'+filas+'<p class=notice style="margin-top:10px">Nada se ha aplicado todavia. Si rechazas, la '+'configuracion actual se mantiene intacta.</p>';if(!hayDialogoAbierto()){el('supDialog').showModal()}}async function resuelveSup(accion){try{await req('/api/v1/supervisor/resolve','POST',{confirmed:true,accion:accion});el('supDialog').close();supPend=null;el('receipt').textContent='RECIBO - ajuste del supervisor '+(accion==='aceptar'?'aplicado':'rechazado');refresh()}catch(e){alert(e.message)}}(function(){var sh=document.querySelector('.shell');if(!sh)return;var sec=document.createElement('section');sec.className='card';sec.innerHTML='<div class=sectionHead><div><p class=label>RESULTADO REAL</p>'+'<h2>Ingresos, egresos y trading</h2></div></div>'+'<div id=ledBody><p class=muted>Cargando...</p></div>';var ref=null;var secs=sh.querySelectorAll('section.card');for(var i=0;i<secs.length;i++){if(secs[i].textContent.indexOf('ORDENES ACTIVAS')>=0){ref=secs[i];break}}if(ref){sh.insertBefore(sec,ref)}else{sh.appendChild(sec)}var d=document.createElement('dialog');d.id='supDialog';d.innerHTML='<div style="padding:16px"><h2 style="margin:0 0 4px">El supervisor propone ajustes</h2>'+'<small class=muted>Requiere tu aprobacion</small><div id=supBody></div>'+'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px">'+'<button id=supNo style="padding:10px;border-radius:8px;background:rgba(255,112,128,.15);'+'border:1px solid rgba(255,112,128,.3);color:#ffb0b8;font-weight:600">RECHAZAR</button>'+'<button id=supSi style="padding:10px;border-radius:8px;background:var(--green);color:var(--bg);'+'border:none;font-weight:600">APLICAR</button></div></div>';document.body.appendChild(d);el('supSi').onclick=function(){resuelveSup('aceptar')};el('supNo').onclick=function(){resuelveSup('rechazar')}})();var VIZ=null;function ptos(vals,W,H,pad){var idx=[],vs=[];for(var i=0;i<vals.length;i++){if(vals[i]!==null&&vals[i]!==undefined){idx.push(i);vs.push(Number(vals[i]))}}if(vs.length<2)return null;var mn=Math.min.apply(null,vs),mx=Math.max.apply(null,vs),rg=(mx-mn)||1;var n=vals.length-1;return {mn:mn,mx:mx,x:function(i){return (i/n)*W},y:function(v){return H-pad-((v-mn)/rg)*(H-pad*2)},idx:idx}}function linea(vals,W,H,pad){var m=ptos(vals,W,H,pad);if(!m)return '';var d='';for(var k=0;k<m.idx.length;k++){var i=m.idx[k];d+=(k?' L':'M')+m.x(i).toFixed(1)+' '+m.y(Number(vals[i])).toFixed(1)}return d}function panelPrecio(S,W){var H=150,pad=10;var d=linea(S.close,W,H,pad);var m=ptos(S.close,W,H,pad);if(!m)return '';var g='';for(var i=1;i<4;i++){var y=(H/4)*i;g+='<line class=gridline x1="0" y1='+y+' x2='+W+' y2='+y+'/>'}return '<svg viewBox="0 0 '+W+' '+H+'" data-h='+H+'>'+g+'<path class=serie d="'+d+'" style="stroke:var(--viz-linea)"/>'+'<text class=ejelbl x="2" y=10>'+px(m.mx)+'</text>'+'<text class=ejelbl x="2" y='+(H-2)+'>'+px(m.mn)+'</text></svg>'}function panelRSI(S,W){var H=90,pad=8;var n=S.rsi.length-1;var y=function(v){return H-pad-((v-0)/100)*(H-pad*2)};var d='';var first=true;for(var i=0;i<S.rsi.length;i++){var v=S.rsi[i];if(v===null||v===undefined)continue;d+=(first?'M':' L')+((i/n)*W).toFixed(1)+' '+y(Number(v)).toFixed(1);first=false}return '<svg viewBox="0 0 '+W+' '+H+'" data-h='+H+'>'+'<rect class=banda x="0" y='+y(70)+' width='+W+' height='+(y(30)-y(70))+'/>'+'<line class=gridline x1="0" y1='+y(70)+' x2='+W+' y2='+y(70)+'/>'+'<line class=gridline x1="0" y1='+y(30)+' x2='+W+' y2='+y(30)+'/>'+'<path class=serie d="'+d+'" style="stroke:var(--viz-linea)"/>'+'<text class=ejelbl x="2" y='+(y(70)-3)+'>70 sobrecompra</text>'+'<text class=ejelbl x="2" y='+(y(30)+10)+'>30 sobreventa</text></svg>'}function panelMACD(S,W){var H=80,pad=8;
var todos=[];
for(var i=0;i<S.macd.length;i++){
if(S.macd[i]!==null)todos.push(Number(S.macd[i]));
if(S.signal[i]!==null)todos.push(Number(S.signal[i]))}
if(todos.length<2)return '<p class=muted>Sin datos MACD</p>';
var mn=Math.min.apply(null,todos),mx=Math.max.apply(null,todos),rg=(mx-mn)||1;
var n=S.macd.length-1;
var y=function(v){return H-pad-((v-mn)/rg)*(H-pad*2)};
var dm='',ds='',f1=true,f2=true;
for(var j=0;j<S.macd.length;j++){
if(S.macd[j]!==null){dm+=(f1?'M':' L')+((j/n)*W).toFixed(1)+' '+y(Number(S.macd[j])).toFixed(1);f1=false}
if(S.signal[j]!==null){ds+=(f2?'M':' L')+((j/n)*W).toFixed(1)+' '+y(Number(S.signal[j])).toFixed(1);f2=false}}
var cero=(mn<0&&mx>0)?('<line class="gridline" x1="0" y1="'+y(0).toFixed(1)+'" x2="'+W+'" y2="'+y(0).toFixed(1)+'"/>'):'';
return '<svg viewBox="0 0 '+W+' '+H+'" data-h="'+H+'">'+cero+
'<path class="serie" d="'+dm+'" style="stroke:var(--viz-macd)"/>'+
'<path class="serie" d="'+ds+'" style="stroke:var(--viz-signal)"/>'+
'<text class="ejelbl" x="2" y="10">'+mx.toFixed(1)+'</text>'+
'<text class="ejelbl" x="2" y="'+(H-2)+'">'+mn.toFixed(1)+'</text></svg>'}

// El histograma lleva escala propia: compartirla con las lineas MACD lo aplastaba
// a 0.1 px, porque la senal llega a ~1180 y el histograma se mueve bajo 200.
function panelHist(S,W){var H=80,pad=8;
var vs=[];for(var i=0;i<S.hist.length;i++){if(S.hist[i]!==null)vs.push(Number(S.hist[i]))}
if(vs.length<2)return '<p class=muted>Sin histograma</p>';
var mn=Math.min.apply(null,vs),mx=Math.max.apply(null,vs);
if(mn>0)mn=0;if(mx<0)mx=0;
var rg=(mx-mn)||1;var n=S.hist.length-1;
var y=function(v){return H-pad-((v-mn)/rg)*(H-pad*2)};
var y0=y(0);
var bw=Math.max(1.5,(W/vs.length)-1);
var barras='';
for(var k=0;k<S.hist.length;k++){var v=S.hist[k];if(v===null)continue;
var vy=y(Number(v));var alto=Math.max(1,Math.abs(vy-y0));
barras+='<rect x="'+((k/n)*W-bw/2).toFixed(1)+'" y="'+Math.min(vy,y0).toFixed(1)+
'" width="'+bw.toFixed(1)+'" height="'+alto.toFixed(1)+'" rx="1" style="fill:'+
(Number(v)>=0?'var(--viz-pos)':'var(--viz-neg)')+';opacity:0.7"/>'}
return '<svg viewBox="0 0 '+W+' '+H+'" data-h="'+H+'">'+barras+
'<line class="gridline" x1="0" y1="'+y0.toFixed(1)+'" x2="'+W+'" y2="'+y0.toFixed(1)+'"/>'+
'<text class="ejelbl" x="2" y="10">'+mx.toFixed(1)+'</text>'+
'<text class="ejelbl" x="2" y="'+(H-2)+'">'+mn.toFixed(1)+'</text></svg>'}

var vizTF='1h',vizSym=null,vizTabla=false;(function(){var d=document.createElement('dialog');d.id='vizDialog';d.innerHTML='<div style="padding:16px" class=viz>'+'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">'+'<div><h2 id=vizTitle style="margin:0">-</h2>'+'<small class=muted id=vizSub>-</small></div>'+'<div style="display:flex;gap:6px">'+'<button data-tf="1h" style="padding:6px 10px;font-size:10px">1H</button>'+'<button data-tf="4h" style="padding:6px 10px;font-size:10px">4H</button>'+'<button data-tf="1D" style="padding:6px 10px;font-size:10px">1D</button>'+'<button data-close="vizDialog" style="padding:6px 10px;font-size:10px;background:none;'+'border:1px solid var(--line);color:var(--green)">CERRAR</button></div></div>'+'<div id=vizBody><p class=muted>Cargando velas...</p></div></div>';document.body.appendChild(d);var tp=document.createElement('div');tp.id='vizTip';document.body.appendChild(tp);var tfs=d.querySelectorAll('[data-tf]');for(var i=0;i<tfs.length;i++){(function(b){b.onclick=function(){vizTF=b.getAttribute('data-tf');abreIndicadores(vizSym)}})(tfs[i])}d.querySelector('[data-close]').onclick=function(){d.close();el('vizTip').style.display='none'}})();async function abreIndicadores(sym){if(!sym)return;vizSym=sym;var dlg=el('vizDialog');if(!dlg.open)dlg.showModal();el('vizTitle').textContent=sym;el('vizSub').textContent='cargando '+vizTF+'...';el('vizBody').innerHTML='<p class=muted>Cargando velas...</p>';try{var d=await req('/api/v1/indicators?series=1&timeframe='+encodeURIComponent(vizTF)+'&symbol='+encodeURIComponent(sym));if(d.error){el('vizBody').innerHTML='<p class=down>'+esc(d.error)+'</p>';return}VIZ=d;var S=d.series,W=600;var hm=d.macd||{};el('vizSub').textContent=d.candles+' velas '+d.timeframe+' - Crypto.com';var h='';h+='<div class=vizHead><b>Precio</b><span id=vPre>'+px(d.price)+'</span></div>'+panelPrecio(S,W);h+='<div class=vizHead><b>RSI 14</b><span id=vRsi>'+(d.rsi==null?'-':d.rsi)+'</span></div>'+panelRSI(S,W);h+='<div class=vizHead><b>MACD 12/26/9</b><span>linea vs senal</span></div>'+panelMACD(S,W);h+='<div class=vizLeg><span><i style="background:var(--viz-macd)"></i>MACD</span>'+'<span><i style="background:var(--viz-signal)"></i>Senal</span></div>';h+='<div class=vizHead><b>Histograma MACD</b><span id=vMac>'+(hm.hist==null?'-':hm.hist)+'</span></div>'+panelHist(S,W);h+='<div class=vizLeg><span><i style="background:var(--viz-pos)"></i>Positivo</span>'+'<span><i style="background:var(--viz-neg)"></i>Negativo</span></div>';h+='<p class=notice style="margin-top:12px">'+esc(lecturaTecnica(d))+'</p>';h+='<button id=vizTabBtn style="margin-top:10px;padding:7px 12px;font-size:10px">VER DATOS</button>'+'<div id=vizTabla style="display:none;max-height:240px;overflow:auto;margin-top:8px"></div>';el('vizBody').innerHTML=h;el('vizTabBtn').onclick=function(){vizTabla=!vizTabla;el('vizTabla').style.display=vizTabla?'block':'none';this.textContent=vizTabla?'OCULTAR DATOS':'VER DATOS';if(vizTabla)pintaTabla(S)};montaCrosshair(S,W);}catch(e){el('vizBody').innerHTML='<p class=down>'+esc(e.message)+'</p>'}}function lecturaTecnica(d){var r=d.rsi,m=d.macd||{};var t=[];if(r!=null){t.push(r<=30?('RSI '+r+': sobreventa'):r>=70?('RSI '+r+': sobrecompra'):('RSI '+r+': zona neutra'))}if(m.hist!=null){var cruce=(m.prev_hist<=0&&m.hist>0)?'cruce alcista recien formado':(m.prev_hist>=0&&m.hist<0)?'cruce bajista recien formado':(m.hist>0?'histograma positivo':'histograma negativo');t.push('MACD: '+cruce)}return t.join(' - ')||'Sin lectura'}function pintaTabla(S){var n=S.close.length;var filas='';for(var i=n-1;i>=Math.max(0,n-40);i--){filas+='<tr><td>'+(n-i)+'</td><td>'+px(S.close[i])+'</td><td>'+(S.rsi[i]==null?'-':S.rsi[i])+'</td><td>'+(S.hist[i]==null?'-':S.hist[i])+'</td></tr>'}el('vizTabla').innerHTML='<table style="width:100%;font-size:11px;border-collapse:collapse">'+'<thead><tr style="color:var(--muted);text-align:left"><th>#</th><th>Cierre</th><th>RSI</th><th>MACD hist</th></tr></thead>'+'<tbody>'+filas+'</tbody></table>'}function montaCrosshair(S,W){var svgs=el('vizBody').querySelectorAll('svg');var tip=el('vizTip');var n=S.close.length;function mueve(ev){var r=svgs[0].getBoundingClientRect();var rel=Math.min(1,Math.max(0,(ev.clientX-r.left)/r.width));var i=Math.round(rel*(n-1));for(var k=0;k<svgs.length;k++){var sv=svgs[k];var vieja=sv.querySelector('.cross');if(vieja)vieja.remove();var H=Number(sv.getAttribute('data-h'))||100;var ln=document.createElementNS('http://www.w3.org/2000/svg','line');ln.setAttribute('class','cross');ln.setAttribute('x1',(rel*W).toFixed(1));ln.setAttribute('x2',(rel*W).toFixed(1));ln.setAttribute('y1','0');ln.setAttribute('y2',String(H));sv.appendChild(ln)}tip.innerHTML='<b>vela '+(n-i)+' atras</b><br>Cierre '+px(S.close[i])+'<br>RSI '+(S.rsi[i]==null?'-':S.rsi[i])+'<br>MACD hist '+(S.hist[i]==null?'-':S.hist[i]);tip.style.display='block';var tx=Math.min(window.innerWidth-160,ev.clientX+14);tip.style.left=tx+'px';tip.style.top=(ev.clientY+14)+'px'}function sale(){tip.style.display='none';var cs=el('vizBody').querySelectorAll('.cross');for(var q=0;q<cs.length;q++){cs[q].remove()}}for(var z=0;z<svgs.length;z++){svgs[z].addEventListener('mousemove',mueve);svgs[z].addEventListener('mouseleave',sale);svgs[z].addEventListener('touchmove',function(e){if(e.touches[0])mueve(e.touches[0])})}}
// Si el runner aparece atrasado, se consulta UNA vez la sonda de KV para poder
// decir si el problema es que no corre o que corre y no puede guardar.
var kvChecado=false;
async function revisaKV(st){
var r=st&&st.runner;
if(!r||r.health!=='late'){kvChecado=false;var v=el('kvAviso');if(v)v.remove();return}
if(kvChecado)return; kvChecado=true;
try{var k=await req('/api/v1/kv/health');
if(k.escribe_ok)return;
var sh=document.querySelector('.shell');if(!sh)return;
var box=el('kvAviso');
if(!box){box=document.createElement('p');box.id='kvAviso';box.className='notice';
box.style.borderLeftColor='#ff7080';box.style.color='#ffb0b8';
box.style.background='rgba(255,112,128,.08)';
sh.insertBefore(box,sh.children[1]||null)}
box.textContent='El runner SI se esta ejecutando, pero no puede guardar su estado: '+
k.detalle+' Por eso aparece LATE y el ciclo no avanza. Se restablece a las '+
k.reinicio_utc+' UTC.';
}catch(e){}}


// --- Notificaciones dentro del APK -------------------------------------------
// Android WebView no implementa la Push API, asi que dentro de Capacitor el push
// web no llega. Se usa el canal NATIVO de notificaciones locales: la pagina ya
// refresca cada 15 s, y cuando detecta algo nuevo dispara el aviso nativo.
var enApp = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);
var LN = enApp ? window.Capacitor.Plugins.LocalNotifications : null;
var avisoId = 1;
var ultimaProp = null, ultimoMov = null, avisosListos = false;

async function preparaAvisosApp(){
  if(!enApp || avisosListos) return;
  try{
    var p = await LN.requestPermissions();
    avisosListos = (p && (p.display === 'granted' || p.display === 'prompt'));
    var b = el('pushBtn');
    if(b) b.textContent = avisosListos ? 'NOTIFICACIONES ON (APP)' : 'PERMISO DENEGADO';
  }catch(e){}
}

async function avisaApp(titulo, cuerpo){
  if(!enApp || !avisosListos) return;
  try{
    await LN.schedule({notifications:[{
      id: avisoId++,
      title: titulo,
      body: cuerpo,
      smallIcon: 'ic_stat_icon',
      iconColor: '#5eeec8'
    }]});
  }catch(e){}
}

// Compara contra lo ya visto para no repetir el mismo aviso en cada refresco.
function vigilaNovedades(fc, mv){
  if(!enApp) return;
  var p = (fc && fc.plans && fc.plans[0]) || null;
  if(p){
    var k = p.side + ':' + p.symbol + ':' + Number(p.trigger_price_usd).toFixed(6);
    if(ultimaProp && ultimaProp !== k){
      avisaApp(p.side + ' ' + p.symbol + ' - propuesta del bot',
        'Trigger ' + px(p.trigger_price_usd) + ' - confianza ' +
        Math.round((Number(p.confidence)||0)*100) + '%');
    }
    ultimaProp = k;
  }
  var m = (mv && mv.movements && mv.movements[0]) || null;
  if(m){
    var mk = String(m.id || m.ts);
    if(ultimoMov && ultimoMov !== mk){
      var pnl = m.pnl_known ? (' - P/L ' + (m.pnl_usd>=0?'+':'') + money(m.pnl_usd)) : '';
      avisaApp(m.side + ' ' + m.symbol + ' ejecutada',
        m.value_usd + ' USD' + pnl);
    }
    ultimoMov = mk;
  }
}

if(enApp){preparaAvisosApp()}
var vueltas=0,timer=null;
function arranca(){if(timer)return;timer=setInterval(refresh,15000);refresh()}
function detiene(){if(timer){clearInterval(timer);timer=null}}
// Con la pantalla apagada o la app en segundo plano no hay nadie mirando:
// seguir pidiendo datos solo quemaba cuota de Cloudflare.
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden'){detiene()}else{vueltas=0;arranca()}});
if(document.visibilityState!=='hidden'){arranca()}else{refresh()}</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
}


































export default {
  // OJO: cada handler se devuelve con 'await'. Sin el, 'return handler(...)'
  // entrega una promesa todavia sin resolver y el 'finally' de abajo vacia el
  // buffer de KV ANTES de que el handler haya escrito nada: los cambios de
  // configuracion se perdian en silencio devolviendo 200.
  async fetch(request: Request, envOriginal: Env): Promise<Response> {
    const env = conBuffer(envOriginal);
    try {
    const url = new URL(request.url); const route = `${request.method} ${url.pathname}`;
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (route === 'GET /') return serveHTML();
    if (route === 'GET /api/v1/health') return json({ ok: true, environment: env.ENVIRONMENT || 'production', version: '1.4.4-long-short' });
    if (route === 'GET /api/v1/status') return await status(env);
    if (route === 'GET /api/v1/dashboard') return await dashboard(env, request);
    if (route === 'GET /api/v1/movements') return await movements(env, request);
    if (route === 'GET /api/v1/decisions') return await decisions(env, request);
    if (route === 'GET /api/v1/forecast') return await forecast(env);
    if (route === 'GET /api/v1/logs') return await logs(env, request);
    if (route === 'GET /api/v1/config') return await configResponse(env);
    if (route === 'GET /api/v1/analytics') return await analyticsResponse(env, request);
    if (route === 'GET /api/v1/risk') return await riskMetricsResponse(env);
    if (route === 'GET /api/v1/rebalance') return await rebalanceResponse(env);
    if (route === 'GET /api/v1/version') return await versionResponse();
    if (route === 'GET /api/v1/allocation') return await allocationResponse(env);
    if (route === 'GET /api/v1/orders') return await ordersResponse(env);
    if (route === 'GET /api/v1/mode') return await modeResponse(env);
    if (route === 'GET /api/v1/dca') return await dcaResponse(env);
    if (route === 'GET /api/v1/riesgo') {
      if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401);
      const st = await strategyConfig(env); const cfg = await configValues(env);
      const basis: any = await costBasisState(env);
      const r = await mapasDeRiesgo([
        ...String(st.universo.nucleo || '').split(','), st.grid.symbol, st.dca.symbol, st.rsi.symbol, st.macd.symbol,
        ...Object.keys(basis?.positions || {}),
      ]).catch(() => ({ stop: '', objetivo: '', persecucion: '', detalle: { error: 'calculo_riesgo_fallido' } as Record<string, any> }));
      return json({
        por_activo: r.detalle,
        global: { stop_pct: cfg.STOP_LOSS_PCT * 100, objetivo_pct: cfg.MIN_PROFIT_TO_SELL_PCT * 100, costo_pct: cfg.ESTIMATED_ROUNDTRIP_COST_PCT * 100 },
        enviado_al_runner: { STOP_LOSS_PCT_BY_ASSET: r.stop, MIN_PROFIT_TO_SELL_PCT_BY_ASSET: r.objetivo, BUY_MAX_24H_CHASE_PCT_BY_ASSET: r.persecucion },
        nota: 'El stop se dimensiona al rango diario real de cada moneda. Los activos sin datos usan el valor global.',
      });
    }
    if (route === 'GET /api/v1/kv/health') return await kvHealthResponse(env);
    if (route === 'GET /api/v1/ledger') return await ledgerResponse(env);
    if (route === 'POST /api/v1/orders/enforce') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await enforceNow(env, 'manual'); }
    if (route === 'GET /api/v1/supervisor/pending') return await supervisorPendingResponse(env);
    if (route === 'POST /api/v1/supervisor/resolve') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await resolveSupervisor(env, request); }
    if (route === 'GET /api/v1/strategies') return await strategiesResponse(env);
    if (route === 'GET /api/v1/indicators') return await indicatorsResponse(env, request);
    if (route === 'GET /api/v1/push/latest') return json(await getJson<any>(env, 'last_push_aviso', { kind: 'none', title: 'TradBot IA', body: 'Sin avisos recientes.', ts: null }));
    if (route === 'GET /api/v1/push/vapid') return json({ public_key: env.VAPID_PUBLIC_KEY || null, configured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) });
    if (route === 'POST /api/v1/push/subscribe') return await pushSubscribe(env, request);
    if (route === 'POST /api/v1/proposals/ack') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401);
      const b2 = await request.json().catch(() => ({})) as any;
      await markUserResponse(env, String(b2?.motivo || 'ack'));
      return json({ ok: true, semi_idle_seconds: 0 }); }
    if (route === 'POST /api/v1/push/test') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return json({ ok: true, sent: await sendPush(env, 'test') }); }
    if (route === 'POST /api/v1/strategies') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateStrategies(env, request); }
    if (route === 'POST /api/v1/auth/check') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return json({ ok: true, authorized: true }); }
    if (route === 'POST /api/v1/config') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateConfig(env, request); }
    if (route === 'POST /api/v1/allocation') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateAllocation(env, request); }
    if (route === 'POST /api/v1/orders') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateOrder(env, request); }
    if (route === 'POST /api/v1/orders/cancel') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await cancelOrder(env, request); }
    if (route === 'POST /api/v1/force-sell-once') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await forceSellOnce(env, request); }
    if (route === 'POST /api/v1/mode') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateMode(env, request); }
    if (route === 'POST /api/v1/dca') { if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401); return await updateDCA(env, request); }
    if (route === 'POST /api/v1/notify/test') {
      if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401);
      await notifyWhatsApp(env, 'manual_test', 'Prueba de WhatsApp', 'Notificaciones CryptoBot activas.', `manual:${Date.now()}`, 0);
      return json({ ok: true, enabled: truthy(env.WHATSAPP_ENABLED), provider: env.WHATSAPP_PROVIDER || 'meta_cloud', to_configured: Boolean(env.WHATSAPP_TO) });
    }
    if (route === 'GET /api/v1/runner/next') {
      if (!runnerAuthorized(request, env)) return json({ detail: 'No autorizado' }, 401);
      const values = await configValues(env); const desired = await desiredState(env); const allocation = await allocationValues(env); const mode = await executionMode(env); const basis = await costBasisState(env); const forceSell = await forceSellOnceState(env); const dca = await dcaConfig(env);
      const orders = await executableConditionalOrders(env);
      const strat = await strategyConfig(env);
      // Stop y objetivo dimensionados al rango diario real de cada moneda.
      // Se calcula aqui porque el worker ya consulta velas y las cachea 6 h.
      const posiciones = (basis as any)?.positions && typeof (basis as any).positions === 'object'
        ? Object.keys((basis as any).positions) : [];
      // Si el calculo falla el bot NO puede quedarse sin config: se degrada a
      // mapas vacios y el runner usa el stop global de siempre.
      const riesgo = await mapasDeRiesgo([
        ...String(strat.universo.nucleo || '').split(','),
        strat.grid.symbol, strat.dca.symbol, strat.rsi.symbol, strat.macd.symbol,
        ...orders.map((o: any) => String(o?.symbol || '')),
        ...posiciones,
      ]).catch(() => ({ stop: '', objetivo: '', persecucion: '', detalle: { error: 'calculo_riesgo_fallido' } as Record<string, any> }));
      return json({ ok: true, desired_state: desired, riesgo_por_activo: riesgo.detalle, execution_mode: mode, cycle: dailyCycle(), raw_cycle: Math.floor(Date.now() / (CICLO_SEGUNDOS * 1000)), trading_day: tradingDayKey(), ai: { provider: 'groq', model: env.GROQ_MODEL || 'openai/gpt-oss-20b', groq_configured: true }, conditional_orders: orders, force_sell_once: forceSell, config: { ...values, ...allocationToRunnerConfig(allocation), TRADING_AUTOPILOT_MODE: mode.toUpperCase(), CONDITIONAL_ORDERS_JSON: JSON.stringify(orders), FORCE_SELL_ONCE_JSON: forceSell ? JSON.stringify(forceSell) : '', COST_BASIS_STATE_JSON: JSON.stringify(basis), DCA_CONFIG_JSON: JSON.stringify(dca), COST_BASIS_SYNC: 'YES', SUPERVISOR_EXECUTE: 'YES', AI_PROVIDER: 'groq', AI_FALLBACK_PROVIDERS: '', REQUIRE_AI_FOR_EXECUTION: 'YES', GROQ_REASONING_EFFORT: 'low', AI_PREFILTER_CANDIDATES: String(strat.momentum.enabled ? strat.momentum.prefilter : 2), AI_CHUNK_SIZE: '1', TRADING_SWARM_MAX_CHUNK: '1', REMOTE_STATE_STORE: 'cloudflare_kv', LOSS_HOLD_MODE: 'YES', DECISION_PNL_REFERENCE: '1D', ADAPTIVE_BASELINE_MODE: '1D', BUY_LOW_SELL_HIGH_POLICY: strat.dip_buyer.enabled ? 'YES' : 'NO', ALLOW_REBALANCE_SELLS_WITHOUT_PROFIT: strat.rebalancer.sells_without_profit ? 'YES' : 'NO', ALLOW_SELL_WITH_UNKNOWN_COST: strat.proteccion.sell_with_unknown_cost ? 'YES' : 'NO', ALLOW_DEFENSIVE_STOP_SELLS: strat.proteccion.defensive_stop_sells ? 'YES' : 'NO', ALLOW_STRONG_AI_SELLS_WITHOUT_PROFIT: strat.proteccion.strong_ai_sells_without_profit ? 'YES' : 'NO', STRONG_AI_SELL_CONFIDENCE: String(strat.proteccion.strong_ai_confidence), STOP_LOSS_PCT_BY_ASSET: riesgo.stop, MIN_PROFIT_TO_SELL_PCT_BY_ASSET: riesgo.objetivo, BUY_MAX_24H_CHASE_PCT_BY_ASSET: riesgo.persecucion, GRID_MIN_PROFIT_PCT: String(Math.max(Number(values.ESTIMATED_ROUNDTRIP_COST_PCT || 0.012) * 2, Math.max(0.1, Number(strat.grid.step_pct) || 2.5) / 100)), HELD_STABLE_EXCLUDE: strat.usdt.operable ? 'USDC' : 'USDC,USDT', UNIVERSE_AUTOPILOT_CORE: strat.universo.nucleo, CRO_BUY_DISABLED: strat.cro.compras_habilitadas ? 'NO' : 'YES', UNIVERSE_AUTOPILOT_MAX_INCLUDE: String(strat.universo.max_extra), TRADE_EXCLUDE: strat.universo.excluir, BUY_MAX_24H_CHASE_PCT: String(strat.dip_buyer.max_chase_pct), BUY_BREAKOUT_MIN_CONFIDENCE: String(strat.momentum.breakout_min_confidence), STRATEGIES_JSON: JSON.stringify(strat) } });
    }
    if (route === 'POST /api/v1/runner/report') {
      if (!runnerAuthorized(request, env)) return json({ detail: 'No autorizado' }, 401);
      const body = await request.json().catch(() => ({})) as any;
      const report: Report = { ts: new Date().toISOString(), status: body.status || 'unknown', cycle: dailyCycle(), returncode: body.returncode ?? null, duration_seconds: body.duration_seconds ?? null, summary: { ...(body.summary || {}), raw_cycle: body.cycle ?? null, trading_day: tradingDayKey() } };
      const incomingLogs = (body.logs || []).slice(-160) as LogItem[];
      const merged = await appendLogs(env, incomingLogs);
      await appendPortfolioHistory(env, incomingLogs);
      await appendMovementHistory(env, incomingLogs);
      await reconcileConditionalOrders(env, incomingLogs);
      await reconcileCostBasisState(env, incomingLogs);
      await reconcileCashFlows(env, incomingLogs).catch(() => {});
      if (incomingLogs.some((item) => item.event === 'forced_loss_sell_executed')) await env.CRYPTO_BOT_STATE.delete('force_sell_once');
      await notifyRunnerEvents(env, incomingLogs, report);
      await pushOnTrades(env, incomingLogs).catch(() => {});
      const applied = await applySupervisorChanges(env, report, incomingLogs);

      // Presupuesto del dia: si el ritmo proyecta pasar del 70%, se omiten las
      // escrituras prescindibles para que las criticas nunca se queden fuera.
      const kvd = await leerKvDia(env);
      const proyeccion = kvProyeccion(kvd);
      const degradar = proyeccion !== null && proyeccion > KV_LIMITE_DIA * KV_UMBRAL;

      // Fase 1: todo MENOS recent_logs, para conocer las escrituras reales.
      const buf = kvBuf(env);
      const logsPendientes = buf?.datos.get('recent_logs');
      buf?.sucias.delete('recent_logs');
      const f1 = await flushKv(env, degradar);
      const reales = (f1?.escritas.length || 0) + 1; // +1: recent_logs de la fase 2
      if (buf && logsPendientes !== undefined) { buf.datos.set('recent_logs', logsPendientes); buf.sucias.add('recent_logs'); }

      const kvHoy: KvDia = { dia: kvd.dia, reportes: kvd.reportes + 1, escrituras: kvd.escrituras + reales, alertado: kvd.alertado };
      const avisar = degradar && !kvd.alertado;
      if (avisar) kvHoy.alertado = true;

      // last_report ya no ocupa una clave propia: viaja como evento en recent_logs.
      await appendLogs(env, [{ ts: report.ts, event: 'runner_report', data: { ...report, summary: { ...report.summary, supervisor_applied: applied, kv: { escritas: f1?.escritas || [], omitidas: f1?.omitidas || 0, degradadas: f1?.degradadas || 0 }, kv_dia: kvHoy, kv_proyeccion: proyeccion, kv_degradado: degradar } } as any }]);

      // Fase 2: recent_logs, una sola vez.
      const b = await flushKv(env, degradar);
      const persisted = ((f1?.fallos || 0) + (b?.fallos || 0)) === 0;
      if (avisar) {
        await sendPush(env, 'kv_presupuesto', { kind: 'aviso', title: `Cuota de Cloudflare proyectada al ${Math.round((proyeccion || 0) / KV_LIMITE_DIA * 100)}%`, body: 'Se omiten escrituras secundarias para proteger al bot.' }).catch(() => {});
      }
      return json({ ok: true, stored: merged.length, supervisor_applied: applied, persisted, kv_escritas: b?.escritas || [], kv_omitidas: b?.omitidas || 0, kv_proyeccion: proyeccion, kv_degradado: degradar, ...(persisted ? {} : { warning: 'Fallo al escribir en KV; estado guardado solo en parte' }) });
    }
    const controlMatch = url.pathname.match(/^\/api\/v1\/control\/(start|pause|stop)$/);
    if (request.method === 'POST' && controlMatch) {
      if (!appAuthorized(request, env)) return json({ detail: 'Dispositivo no autorizado' }, 401);
      const action = controlMatch[1] as 'start' | 'pause' | 'stop';
      const desired: DesiredState = action === 'start' ? 'running' : action === 'pause' ? 'paused' : 'stopped';
      await setDesiredState(env, desired);
      await appendLogs(env, [{ ts: new Date().toISOString(), event: `remote_trading_${action}_requested`, data: { desired_state: desired, source: 'app' } }]);
      const dispatch = action === 'start' ? await dispatchRunner(env, 'control_start') : null;
      return json({ ok: true, receipt: { ts: new Date().toISOString(), event: `remote_trading_${action}_requested`, data: { desired_state: desired } }, dispatch });
    }
    return json({ detail: 'Not found', route }, 404);
    } finally {
      await flushKv(env);
    }
  },
  async scheduled(_controller: ScheduledController, envOriginal: Env, ctx: ExecutionContext): Promise<void> {
    const env = conBuffer(envOriginal);
    ctx.waitUntil((async () => {
      try {
        if (await desiredState(env) !== 'running') return;
        const hayOrdenes = (await conditionalOrders(env)).some((o) => o.status === 'active');
        if (hayOrdenes) await enforceNow(env, 'ciclo').catch(() => {});
        await generateStrategyOrders(env).catch(() => {});
        await autoAcceptProposals(env).catch(() => {});
        await pushOnNewProposals(env).catch(() => {});
        // Se escribe ANTES de despachar al runner, para que lea las ordenes ya guardadas.
        await flushKv(env);
        await dispatchRunner(env, 'cron');
      } finally {
        await flushKv(env);
      }
    })());
  },
};
