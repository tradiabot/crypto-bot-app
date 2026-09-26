import "./style.css";
import "./dialogs.css";
import { CapacitorHttp } from "@capacitor/core";

type RunnerLive={health:string;desired_state:string;interval_seconds:number;elapsed_seconds:number|null;seconds_to_next:number|null;overdue_seconds:number;progress:number;last_seen:{ts:string;cycle:number}|null;last_report:{ts:string;status:string;cycle:number|null;returncode:number|null;duration_seconds:number|null;summary:Record<string,unknown>}|null;latest_decision:{ts:string;data:Record<string,unknown>}|null;latest_trade:{ts:string;data:Record<string,unknown>}|null};
type Status={state:string;cycle:number|null;last_heartbeat:number|null;engine_available:boolean;trading_controls:"locked"|"enabled";execution_mode?:"semi"|"auto";autopilot_enabled?:boolean;trading_mode:string;real_trading:boolean;ai_active:boolean;ai_model:string|null;ai_provider?:string|null;ai_health?:"healthy"|"fallback"|"error"|"waiting";ai_last_seen?:string|null;runner?:RunnerLive};
type Point={ts:string;value_usd:number};
type Asset={symbol:string;amount:number;value_usd:number;weight:number;target_pct?:number};
type Quote={symbol:string;price_usd:number;change_24h:number};
type Dashboard={as_of:string|null;total_usd:number;assets:Asset[];series:Point[];market:Quote[];range?:string;performance_1d?:{start:number;current:number;change_usd:number;change_pct:number}|null;decision_reference?:string};
type Movement={id:string;ts:string;side:string;description:string;amount:string;amount_currency:string;to_amount:string;to_currency:string;value_usd:string;status:string;confidence:number;origin?:string;reason:string};
type Decision={ts:string;kind:string;title:string;badge:string;confidence:number|null;amount:number|string|null;reason:string;detail:string};
type ConfigParam={key:string;value:number;min:number;max:number;label:string;description?:string};
type ConfigPreset={key:string;label:string;description:string;values:Record<string,number>};
type AllocationRow={symbol:string;target_pct:number;current_pct:number;value_usd:number;held:boolean};
type AllocationData={allocation:Record<string,number>;suggested:Record<string,number>;assets:AllocationRow[]};
type ForecastPlan={symbol:string;side:"BUY"|"SELL";trigger_price_usd:number;current_price_usd:number;amount_usdc?:number;value_usd?:number;estimated_pnl_usd?:number;estimated_pnl_pct?:number;estimated_pnl_basis?:"avg_cost"|"current_price";avg_cost_usd?:number|null;estimated_outcome?:string;confidence:number;reason:string;status:string;executable:boolean;target_pct:number;current_pct:number;preserve_min_pct:number};
type ConditionalOrder={id:string;symbol:string;side:"BUY"|"SELL";trigger_price_usd:number;current_price_usd?:number;amount_usdc?:number;value_usd?:number;estimated_pnl_usd?:number;estimated_pnl_pct?:number;estimated_pnl_basis?:"avg_cost"|"current_price";avg_cost_usd?:number|null;estimated_outcome?:string;status:string;note?:string;updated_at:string};
type ForecastData={as_of:string|null;mode:string;decision_reference?:string;performance_1d?:{start:number;current:number;change_usd:number;change_pct:number}|null;summary:string;plans:ForecastPlan[];orders?:ConditionalOrder[];note:string};

const logs:string[]=[];
function log(msg:string){
  logs.push(msg);
  const status=document.querySelector("#status");
  if(status)status.textContent=msg;
  console.log(msg);
}

try{
log("1. Init defaults");
const DEFAULT_API=(import.meta.env.VITE_CRYPTO_API_URL||"https://crypto-bot-api.crypto-bot-desk.workers.dev").replace(/\/$/,"");
log("2. API: "+DEFAULT_API);
localStorage.removeItem("cryptoApiUrl");
log("3. localStorage cleared");
const API=DEFAULT_API;
log("4. API constant set");
const CONTROL_TOKEN=import.meta.env.VITE_CONTROL_TOKEN||"";
log("5. Token loaded");
log("6. Querying #app element");
const app=document.querySelector<HTMLDivElement>("#app")!;
log("7. App element found");
if(!app)throw new Error("App element not found");
log("8. Setting innerHTML");
app.innerHTML=`<main class="shell">
<header class="topbar">
  <div>
    <p class="eyebrow">TRADEBOT AI</p>
    <h1>crypto<span>_</span>bot</h1>
    <div style="margin-top:8px;padding:8px 12px;background:rgba(94,238,200,.12);border-radius:8px;border:1px solid rgba(94,238,200,.2);font-size:10px;font-weight:600">
      <span id="appVersion" style="color:var(--green)">v1.4.5</span> · CLOUD READY · <span id="connection" class="status" style="display:inline-flex;margin:0"><i></i><span>conectando</span></span>
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
      <p class="label">MODALIDADES</p>
      <h2>Estrategias de trading</h2>
    </div>
    <button id="stratSave" style="padding:7px 12px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-size:10px;font-weight:600">GUARDAR</button>
  </div>
  <div id="stratBody" class="strategies" style="display:grid;gap:8px"><p class="muted">Cargando estrategias…</p></div>
  <p class="notice" style="margin-top:12px;margin-bottom:0">RSI y MACD funcionan sobre velas reales de Crypto.com. Toca cualquier activo del watchlist para ver sus gráficos.</p>
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

<dialog id="configDialog"><div style="padding:14px"><h2>CONFIGURACIÓN SEGURA</h2><button data-close="configDialog" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--green);font-weight:600;cursor:pointer">✕</button><p class="muted" style="margin:8px 0 16px">Solo parámetros autorizados. Los rangos son límites duros.</p><div id="configPresets" class="presetGrid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px"></div><section class="allocBox"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div><h3 style="margin:0">DISTRIBUCIÓN OBJETIVO</h3><small id="allocSum" style="color:var(--muted)">Suma 0%</small></div><button id="suggestAlloc" type="button" style="padding:6px 10px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-size:10px;font-weight:600">AUTO IA</button></div><p class="muted" style="margin:0 0 10px;font-size:11px">Edita porcentajes por activo. Deben sumar 100%.</p><div id="allocationRows" class="allocationRows"></div><div class="allocAdd" style="display:flex;gap:6px;margin-top:10px"><input id="newAsset" placeholder="NUEVO ACTIVO" maxlength="12" style="flex:1;padding:8px;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:6px"><button id="addAsset" type="button" style="padding:8px 12px;background:rgba(94,238,200,.1);border:1px solid var(--green);color:var(--green);border-radius:6px;font-weight:600;font-size:11px">AGREGAR</button></div><button id="saveAllocation" style="width:100%;padding:10px;margin-top:10px;background:var(--green);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:12px">GUARDAR DISTRIBUCIÓN</button></section><form id="configForm" class="configForm" style="margin-top:16px"></form><button id="saveConfig" style="width:100%;padding:10px;background:var(--green);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:12px">REVISAR Y GUARDAR</button></div></dialog>`;

const el=(id:string)=>document.getElementById(id)!;
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const money=(v:number)=>new Intl.NumberFormat("es-MX",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v||0);
function usdPrice(value:number|null|undefined){const v=Number(value||0);if(!Number.isFinite(v)||v<=0)return"USD —";let digits=2;if(v<1)digits=6;else if(v<10)digits=4;else if(v<1000)digits=2;return `USD ${new Intl.NumberFormat("es-MX",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v)}`;}
function qty(value:number){return Number(value||0).toLocaleString("es-MX",{maximumSignificantDigits:8});}
function pnlLabel(item:{side:"BUY"|"SELL";estimated_pnl_basis?:string;avg_cost_usd?:number|null}){if(item.side==="SELL"&&item.estimated_pnl_basis==="avg_cost")return" P/L costo";return" P/L vs actual";}
const CULIACAN_TZ="America/Mazatlan";
const timeFormatter=new Intl.DateTimeFormat("es-MX",{timeZone:CULIACAN_TZ,hour:"numeric",minute:"2-digit",second:"2-digit"});
const dateTimeFormatter=new Intl.DateTimeFormat("es-MX",{timeZone:CULIACAN_TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"numeric",minute:"2-digit",second:"2-digit"});
const formatTime=(value:string|number|Date)=>timeFormatter.format(new Date(value));
const formatDateTime=(value:string|number|Date)=>dateTimeFormatter.format(new Date(value));
let lastStatus:Status|null=null;
let currentProposal:ForecastPlan|null=null;
let chartRange="live";
const REFRESH_INTERVAL_MS=30000;
const LOG_REFRESH_INTERVAL_MS=15000;
const pad=(n:number)=>String(Math.max(0,Math.floor(n))).padStart(2,"0");
const mmss=(seconds:number|null|undefined)=>seconds==null?"—":`${pad(seconds/60)}:${pad(seconds%60)}`;
function ageLabel(value:string|number|Date|null|undefined){if(!value)return"—";const diff=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(diff<90)return`hace ${diff}s`;return`hace ${pad(diff/60)}:${pad(diff%60)}`;}
async function apiGet<T>(path:string):Promise<T>{
  const headers:Record<string,string>={Accept:"application/json"};
  if(CONTROL_TOKEN)headers.Authorization=`Bearer ${CONTROL_TOKEN}`;
  const response=await CapacitorHttp.get({url:`${API}${path}`,headers,connectTimeout:5000,readTimeout:10000});
  if(response.status<200||response.status>=300)throw new Error(`API ${response.status} · ${API}`);
  return (typeof response.data==="string"?JSON.parse(response.data):response.data) as T;
}
async function apiPost<T>(path:string,body:unknown):Promise<T>{const response=await CapacitorHttp.post({url:`${API}${path}`,headers:{"Content-Type":"application/json",Accept:"application/json",Authorization:`Bearer ${CONTROL_TOKEN}`},data:body,connectTimeout:5000,readTimeout:10000});if(response.status<200||response.status>=300){const detail=typeof response.data==="object"?response.data?.detail:response.data;throw new Error(String(detail||`API ${response.status}`));}return (typeof response.data==="string"?JSON.parse(response.data):response.data) as T;}
function draw(points:Point[]){const path=el("chart").querySelectorAll("path");if(points.length<2){path.forEach(p=>p.setAttribute("d",""));el("delta").textContent="—";el("delta").className="";return;}const vals=points.map(p=>Number(p.value_usd));const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;const coords=vals.map((v,i)=>[i*600/(vals.length-1),155-(v-min)*135/span]);const line=coords.map((p,i)=>`${i?"L":"M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");path[1].setAttribute("d",line);path[0].setAttribute("d",`${line} L600,170 L0,170 Z`);const d=vals.at(-1)!-vals[0];el("delta").textContent=`${d>=0?"+":""}${money(d)}`;el("delta").className=d>=0?"up":"down";}
function assetMeta(a:Asset){const core=["USDC","USDT","BTC","ETH"].includes(a.symbol);const dust=!core&&Number(a.value_usd||0)>0&&Number(a.value_usd||0)<=1;const target=Number(a.target_pct||0);const current=Number(a.weight||0)*100;return `${qty(a.amount)} · actual ${current.toFixed(1)}%${target>0?` · obj ${target.toFixed(1)}%`:""}${dust?" · polvo":""}`;}
function renderDashboard(d:Dashboard){const liveAssets=d.assets.filter(a=>Math.abs(Number(a.amount||0))>0.00000001||Number(a.value_usd||0)>0.005).sort((a,b)=>Number(b.value_usd||0)-Number(a.value_usd||0));el("total").textContent=money(d.total_usd);el("updated").textContent=d.as_of?`Actualizado ${formatTime(d.as_of)}`:"Sin snapshot";draw(d.series);el("market").innerHTML=d.market.map(q=>`<article><b>${esc(q.symbol)}</b><span>${usdPrice(q.price_usd)}</span><em class="${q.change_24h>=0?"up":"down"}">${q.change_24h>=0?"+":""}${q.change_24h.toFixed(2)}%</em></article>`).join("")||`<p class="muted">Sin mercado</p>`;el("assets").innerHTML=liveAssets.map(a=>{const current=Number(a.weight||0)*100;const target=Number(a.target_pct||0);const drift=target?current-target:0;return `<article><div class="coin">${esc(a.symbol.slice(0,1))}</div><div><b>${esc(a.symbol)}</b><small>${esc(assetMeta(a))}</small>${target>0?`<small class="${Math.abs(drift)<=1?"":"down"}">desvío ${drift>=0?"+":""}${drift.toFixed(1)} pts</small>`:""}</div><div class="assetValue"><b>${money(a.value_usd)}</b><small>${current.toFixed(1)}%</small></div><i style="--w:${Math.min(100,current)}%"></i></article>`}).join("")||`<p class="muted">Sin activos</p>`;}
function renderMovements(items:Movement[]){el("movements").innerHTML=items.map(m=>`<article><div class="txIcon ${m.side.toLowerCase()}">${m.side==="BUY"?"↘":"↗"}</div><div><b>${esc(m.description)}</b><small>${formatDateTime(m.ts)} · ${m.origin==="groq"?"IA Groq":"motor técnico"} ${Math.round((m.confidence||0)*100)}%</small></div><div class="txValue"><b>${esc(m.to_amount)} ${esc(m.to_currency)}</b><small>${money(Number(m.value_usd))} · ${esc(m.status)}</small></div></article>`).join("")||`<p class="muted">Sin movimientos ejecutados</p>`;}
function decisionReason(d:Decision){if(d.reason)return d.reason;if(d.title==="ai_execution_block"||d.title==="IA no ejecutada")return "IA sin proveedor/modelo validado en este registro; ejecucion bloqueada por seguridad.";return "";}
function renderDecisions(items:Decision[]){el("decisionLive").textContent=`LIVE · ${formatTime(Date.now())}`;el("decisions").innerHTML=items.map(d=>`<article class="${esc(d.kind)}"><div><b>${esc(d.title==="ai_execution_block"?"IA no ejecutada":d.title)}</b><small>${formatTime(d.ts)} · ${esc(d.detail||"")}</small><p>${esc(decisionReason(d))}</p></div><span>${esc(d.title==="ai_execution_block"?"BLOQUEO IA":d.badge||"")}${d.confidence!=null?` · ${Math.round(d.confidence*100)}%`:""}</span></article>`).join("")||`<p class="muted">Sin decisiones todavía</p>`;}
const signedMoney=(v:number)=>`${v>=0?"+":""}${money(v)}`;
function orderPayloadAttrs(p:ForecastPlan|ConditionalOrder){const notional=p.side==="BUY"?(p.amount_usdc||0):(p.value_usd||0);return `data-id="${esc((p as ConditionalOrder).id||"")}" data-symbol="${esc(p.symbol)}" data-side="${esc(p.side)}" data-trigger="${p.trigger_price_usd}" data-notional="${notional}" data-current="${p.current_price_usd||0}" data-note="${esc((p as ConditionalOrder).note||"")}"`;}
function proposalKey(p:ForecastPlan){return `proposal:${p.side}:${p.symbol}:${p.trigger_price_usd}:${p.amount_usdc||p.value_usd||0}`;}
function orderNotional(p:ForecastPlan){return p.side==="BUY"?(p.amount_usdc||0):(p.value_usd||0);}
function hasOpenDialog(){return [...document.querySelectorAll<HTMLDialogElement>("dialog")].some(d=>d.open);}
function proposalHandled(key:string){return localStorage.getItem(key)==="accepted"||localStorage.getItem(key)==="rejected";}
function maybePromptProposal(data:ForecastData){if(hasOpenDialog())return;const activeKeys=new Set((data.orders||[]).filter(o=>o.status==="active").map(o=>`${o.side}:${o.symbol}`));const candidate=data.plans.find(p=>orderNotional(p)>0&&!activeKeys.has(`${p.side}:${p.symbol}`)&&!proposalHandled(proposalKey(p)));if(!candidate)return;currentProposal=candidate;const body=el("proposalBody");body.innerHTML=`<article class="${candidate.side.toLowerCase()}"><h3>${esc(candidate.side)} ${esc(candidate.symbol)}</h3><p><b>Trigger:</b> ${usdPrice(candidate.trigger_price_usd)} · <b>Actual:</b> ${usdPrice(candidate.current_price_usd)}</p>${candidate.avg_cost_usd?`<p><b>Costo prom:</b> ${usdPrice(candidate.avg_cost_usd)}</p>`:""}<p><b>Monto:</b> ${candidate.side==="BUY"?`${money(candidate.amount_usdc||0)} USDC`:money(candidate.value_usd||0)}</p><p class="${(candidate.estimated_pnl_usd||0)>=0?"up":"down"}"><b>${pnlLabel(candidate)}:</b> ${signedMoney(candidate.estimated_pnl_usd||0)} · ${(candidate.estimated_pnl_pct||0).toFixed(2)}%</p><p>${esc(candidate.reason)}</p><small>ACEPTAR crea una orden condicionada real del bot. RECHAZAR descarta esta propuesta en este celular.</small></article>`;(el("proposalDialog") as HTMLDialogElement).showModal();}
function renderForecast(data:ForecastData){const perf=data.performance_1d;el("forecastMode").textContent=`REF ${data.decision_reference||"1D"}${perf?` · ${perf.change_usd>=0?"+":""}${money(perf.change_usd)}`:""}`;el("forecastMode").className=perf?(perf.change_usd>=0?"up":"down"):"";el("forecastSummary").textContent=data.summary||"Sin escenarios";el("forecastNote").textContent=data.note||"Plan condicionado; no es garantía.";const orders=(data.orders||[]).map(o=>`<article class="${o.side.toLowerCase()} activeOrder"><div><b>ACTIVA · ${esc(o.side)} ${esc(o.symbol)}</b><small>Trigger ${usdPrice(o.trigger_price_usd)} · ahora ${usdPrice(o.current_price_usd||0)}${o.avg_cost_usd?` · costo ${usdPrice(o.avg_cost_usd)}`:""}</small><p>${esc(o.note||"Orden guardada; el runner la ejecuta cuando toque el trigger.")}</p></div><span>${o.side==="BUY"?`${money(o.amount_usdc||0)} USDC`:money(o.value_usd||0)}<small class="${(o.estimated_pnl_usd||0)>=0?"up":"down"}">${pnlLabel(o)} ${signedMoney(o.estimated_pnl_usd||0)} · ${(o.estimated_pnl_pct||0).toFixed(2)}%</small><button type="button" data-edit-order ${orderPayloadAttrs(o)}>EDITAR</button><button type="button" data-cancel-order="${esc(o.id)}">CANCELAR</button></span></article>`).join("");const plans=data.plans.map(p=>`<article class="${p.side.toLowerCase()}"><div><b>${esc(p.side)} ${esc(p.symbol)}</b><small>Trigger ${usdPrice(p.trigger_price_usd)} · ahora ${usdPrice(p.current_price_usd)}${p.avg_cost_usd?` · costo ${usdPrice(p.avg_cost_usd)}`:""}</small><p>${esc(p.reason)}</p></div><span>${p.amount_usdc?`${money(p.amount_usdc)} USDC`:p.value_usd?`${money(p.value_usd)}`:"—"}<small class="${(p.estimated_pnl_usd||0)>=0?"up":"down"}">${pnlLabel(p)} ${signedMoney(p.estimated_pnl_usd||0)} · ${(p.estimated_pnl_pct||0).toFixed(2)}%</small><small>${Math.round(p.confidence*100)}% · actual ${p.current_pct.toFixed(1)}% · obj ${p.target_pct.toFixed(1)}%</small><button type="button" data-new-plan ${orderPayloadAttrs(p)}>ACTIVAR</button></span></article>`).join("");el("forecastPlans").innerHTML=orders+plans||`<p class="muted">Sin planes condicionados activos</p>`;setTimeout(()=>maybePromptProposal(data),600);}
function renderLivePanel(status:Status,items:Decision[]){const ai=items.find(x=>x.kind==="ai");const decision=items.find(x=>x.kind==="decision");const block=items.find(x=>x.kind==="block");const reasonItem=decision||block;const runnerTs=status.runner?.last_report?.ts||status.runner?.last_seen?.ts||null;el("livePulse").textContent=`pulso ${formatTime(Date.now())}`;el("liveAiSeen").textContent=`${status.ai_health==="healthy"?"IA LIVE":status.ai_health||"IA"} · ${ageLabel(status.ai_last_seen||ai?.ts)}`;el("liveCycleSeen").textContent=runnerTs?`${ageLabel(runnerTs)} · ${status.runner?.last_report?.status||status.runner?.health||"ok"}`:"sin reporte";el("liveLastSignal").textContent=ai?.reason||ai?.title||"Sin señal reciente";el("liveHoldReason").textContent=reasonItem?decisionReason(reasonItem):"Sin bloqueo; esperando señal elegible";}
function shortSignal(item:unknown){const data=(item as {data?:Record<string,unknown>}|null)?.data||{};const signal=(data.signal||{}) as Record<string,unknown>;return [signal.action||data.symbol, data.symbol||signal.source].filter(Boolean).join(" ")||"—";}
function renderTimer(r:RunnerLive){if(r.seconds_to_next!=null&&r.seconds_to_next>0){el("cycleTimer").textContent=`Próximo ${mmss(r.seconds_to_next)}`;return;}el("cycleTimer").textContent=`Esperando +${mmss(r.overdue_seconds||0)}`;}
function renderRunner(s:Status){lastStatus=s;const r=s.runner;const health=r?.health||"waiting";el("cycleState").textContent=health==="alive"?"Runner vivo":health==="late"?"Runner atrasado":health==="paused"?"Pausado":"Esperando runner";el("cycleState").className=health==="late"?"down":health==="paused"?"":"up";el("cycleNumber").textContent=String(s.cycle??r?.last_seen?.cycle??"—");el("lastDecision").textContent=shortSignal(r?.latest_decision);el("lastTrade").textContent=shortSignal(r?.latest_trade);const progress=Math.max(0,Math.min(1,r?.progress??0));(el("cycleProgress") as HTMLElement).style.width=`${Math.round(progress*100)}%`;if(!s.real_trading)el("cycleTimer").textContent="PAUSED";else if(r)renderTimer(r);el("cycleHint").textContent=r?.last_report?.ts?`Último reporte ${formatTime(r.last_report.ts)} · estado ${r.last_report.status}`:"Sin reporte remoto todavía";const start=el("start") as HTMLButtonElement;const pause=el("pause") as HTMLButtonElement;start.disabled=s.real_trading;pause.disabled=!s.real_trading;}
function tickRunner(){const pulse=el("livePulse");if(pulse)pulse.textContent=`pulso ${formatTime(Date.now())}`;if(!lastStatus?.runner)return;const r=lastStatus.runner;if(!lastStatus.real_trading){el("cycleTimer").textContent="PAUSED";return;}r.elapsed_seconds=(r.elapsed_seconds??0)+1;if((r.seconds_to_next??0)>0)r.seconds_to_next=Math.max(0,(r.seconds_to_next??0)-1);else r.overdue_seconds=(r.overdue_seconds||0)+1;r.progress=Math.min(1,(r.elapsed_seconds??0)/r.interval_seconds);renderTimer(r);(el("cycleProgress") as HTMLElement).style.width=`${Math.round(r.progress*100)}%`;}
async function refresh(){const connection=el("connection");try{const [s,d,m,dec,fc]=await Promise.all([apiGet<Status>("/api/v1/status"),apiGet<Dashboard>(`/api/v1/dashboard?range=${encodeURIComponent(chartRange)}`),apiGet<{movements:Movement[]}>("/api/v1/movements?limit=20"),apiGet<{decisions:Decision[]}>("/api/v1/decisions?limit=12"),apiGet<ForecastData>("/api/v1/forecast")]);renderDashboard(d);renderMovements(m.movements);renderDecisions(dec.decisions);renderForecast(fc);renderLivePanel(s,dec.decisions);renderRunner(s);connection.className="status online";connection.querySelector("span")!.textContent="online";el("engineState").textContent=s.state.toUpperCase();el("tradeMode").textContent=s.autopilot_enabled?"PILOTO AUTO":s.trading_mode;el("tradeMode").className=s.real_trading?"up":"";el("modeLabel").textContent=s.autopilot_enabled?"Piloto automático":"Semiautomático";const aiLabel=s.ai_health==="healthy"?"IA LIVE":s.ai_health==="fallback"?"FALLBACK":s.ai_health==="error"?"IA ERROR":"IA WAIT";el("aiState").textContent=aiLabel;el("aiState").className=s.ai_health==="healthy"?"up":s.ai_health==="waiting"?"":"down";el("aiModel").textContent=`${s.ai_provider||"—"} · ${s.ai_model||"sin modelo"}`;el("heartbeat").textContent=s.last_heartbeat?`Último ciclo ${formatTime(s.last_heartbeat*1000)}`:"Sin ciclo remoto";}catch(e){connection.className="status offline";connection.querySelector("span")!.textContent="offline";el("engineState").textContent="OFFLINE";el("heartbeat").textContent=`${e instanceof Error?e.message:"Error"} · ${API}`;}}
document.querySelectorAll<HTMLButtonElement>("[data-range]").forEach(button=>button.addEventListener("click",()=>{chartRange=button.dataset.range||"live";document.querySelectorAll<HTMLButtonElement>("[data-range]").forEach(b=>b.classList.toggle("active",b===button));refresh();}));
el("refresh").addEventListener("click",refresh);refresh();setInterval(refresh,REFRESH_INTERVAL_MS);setInterval(tickRunner,1000);

function estimateText(side:string,current:number,trigger:number,notional:number){if(!current||!trigger||!notional)return"Estimación pendiente.";const pct=side==="BUY"?(current-trigger)/current:(trigger-current)/current;const usd=notional*pct;return `P/L vs actual ${signedMoney(usd)} · ${(pct*100).toFixed(2)}% (${side==="BUY"?"ahorro si compra más bajo":"distancia hasta trigger; el motor valida costo promedio"})`;}
function fillOrderForm(data:Record<string,string>={}){const dialog=el("orderDialog") as HTMLDialogElement;const form=el("orderForm") as HTMLFormElement;(form.elements.namedItem("id") as HTMLInputElement).value=data.id||"";(form.elements.namedItem("symbol") as HTMLInputElement).value=(data.symbol||"").toUpperCase();(form.elements.namedItem("side") as HTMLSelectElement).value=data.side||"BUY";(form.elements.namedItem("trigger_price_usd") as HTMLInputElement).value=data.trigger||"";(form.elements.namedItem("notional") as HTMLInputElement).value=data.notional||"";(form.elements.namedItem("note") as HTMLInputElement).value=data.note||"";el("orderEstimate").textContent=estimateText(data.side||"BUY",Number(data.current||0),Number(data.trigger||0),Number(data.notional||0));dialog.showModal();}
el("newOrder").addEventListener("click",()=>fillOrderForm({side:"BUY"}));
el("forecastPlans").addEventListener("click",async(ev)=>{const target=ev.target as HTMLElement;const button=target.closest("button") as HTMLButtonElement|null;if(!button)return;if(button.dataset.cancelOrder){if(!window.confirm("¿SÍ, cancelar esta orden condicionada?"))return;try{await apiPost("/api/v1/orders/cancel",{confirmed:true,id:button.dataset.cancelOrder});el("receipt").textContent="RECIBO · orden condicionada cancelada";refresh();}catch(e){window.alert(e instanceof Error?e.message:"No se pudo cancelar");}return;}if(button.hasAttribute("data-new-plan")||button.hasAttribute("data-edit-order")){fillOrderForm({id:button.dataset.id||"",symbol:button.dataset.symbol||"",side:button.dataset.side||"BUY",trigger:button.dataset.trigger||"",notional:button.dataset.notional||"",current:button.dataset.current||"",note:button.dataset.note||""});}});
el("orderForm").addEventListener("input",()=>{const form=el("orderForm") as HTMLFormElement;const side=(form.elements.namedItem("side") as HTMLSelectElement).value;const trigger=Number((form.elements.namedItem("trigger_price_usd") as HTMLInputElement).value||0);const notional=Number((form.elements.namedItem("notional") as HTMLInputElement).value||0);el("orderEstimate").textContent=estimateText(side,0,trigger,notional);});
el("saveOrder").addEventListener("click",async()=>{const form=el("orderForm") as HTMLFormElement;const id=(form.elements.namedItem("id") as HTMLInputElement).value;const symbol=(form.elements.namedItem("symbol") as HTMLInputElement).value.trim().toUpperCase().replace(/[^A-Z0-9]/g,"");const side=(form.elements.namedItem("side") as HTMLSelectElement).value as "BUY"|"SELL";const trigger=Number((form.elements.namedItem("trigger_price_usd") as HTMLInputElement).value);const notional=Number((form.elements.namedItem("notional") as HTMLInputElement).value);const note=(form.elements.namedItem("note") as HTMLInputElement).value;if(!symbol||!trigger||!notional){window.alert("Completa símbolo, trigger y monto.");return;}const payload:Record<string,unknown>={confirmed:true,id,symbol,side,trigger_price_usd:trigger,note,status:"active"};if(side==="BUY")payload.amount_usdc=notional;else payload.value_usd=notional;if(!window.confirm(`¿SÍ, guardar orden REAL condicionada?\n\n${side} ${symbol}\nTrigger: ${usdPrice(trigger)}\nMonto: ${money(notional)}\n\nSe ejecutará en Crypto.com cuando el runner detecte el trigger y pase los candados.`))return;try{await apiPost("/api/v1/orders",payload);(el("orderDialog") as HTMLDialogElement).close();el("receipt").textContent=`RECIBO · orden ${side} ${symbol} guardada`;refresh();}catch(e){window.alert(e instanceof Error?e.message:"No se pudo guardar orden");}});
el("rejectProposal").addEventListener("click",()=>{if(!currentProposal)return;(el("proposalDialog") as HTMLDialogElement).close();localStorage.setItem(proposalKey(currentProposal),"rejected");el("receipt").textContent=`PROPUESTA RECHAZADA · ${currentProposal.side} ${currentProposal.symbol}`;currentProposal=null;});
el("acceptProposal").addEventListener("click",async()=>{const p=currentProposal;if(!p)return;const key=proposalKey(p);const payload:Record<string,unknown>={confirmed:true,symbol:p.symbol,side:p.side,trigger_price_usd:p.trigger_price_usd,current_price_usd:p.current_price_usd,note:`Activada desde popup · P/L est ${signedMoney(p.estimated_pnl_usd||0)}`,status:"active"};if(p.side==="BUY")payload.amount_usdc=p.amount_usdc||0;else payload.value_usd=p.value_usd||0;try{await apiPost("/api/v1/orders",payload);localStorage.setItem(key,"accepted");(el("proposalDialog") as HTMLDialogElement).close();el("receipt").textContent=`RECIBO · propuesta aceptada ${p.side} ${p.symbol}`;currentProposal=null;refresh();}catch(e){window.alert(e instanceof Error?e.message:"No se pudo aceptar propuesta");}});

const limits=()=>lastStatus?.autopilot_enabled
  ? "Piloto automático activo: la IA podrá ejecutar señales elegibles dentro de los límites guardados."
  : "Modo semiautomático activo: la IA propondrá planes; solo se ejecutan órdenes condicionadas aceptadas.";
async function control(action:"start"|"pause"|"stop"){
  const labels={start:"¿SÍ, encender el motor REAL?",pause:"¿SÍ, pausar el motor de trading?",stop:"¿SÍ, ejecutar EMERGENCY STOP ahora?"};
  if(!window.confirm(`${labels[action]}\n\n${action==="start"?limits():"La acción detendrá el motor; podrás iniciarlo nuevamente."}\n\nPulsa Aceptar para SÍ o Cancelar para NO.`))return;
  try{const result=await apiPost<{receipt:{ts:string,event:string}}>(`/api/v1/control/${action}`,{confirmed:true});el("receipt").textContent=`RECIBO · ${result.receipt.event} · ${formatTime(result.receipt.ts)}`;setTimeout(refresh,2500);}catch(e){el("receipt").textContent=`ERROR · ${e instanceof Error?e.message:"acción fallida"}`;}
}
el("start").addEventListener("click",()=>control("start"));el("pause").addEventListener("click",()=>control("pause"));el("stop").addEventListener("click",()=>control("stop"));
el("modeToggle").addEventListener("click",async()=>{const auto=lastStatus?.autopilot_enabled;const next=auto?"semi":"auto";const msg=next==="auto"?"¿SÍ, activar PILOTO AUTOMÁTICO?\n\nEl bot podrá ejecutar señales IA elegibles sin popup, manteniendo límites, cooldown y comprar bajo/vender alto. El cambio se aplicará al runner inmediatamente.":"¿SÍ, volver a SEMIAUTOMÁTICO?\n\nLas señales IA normales quedan bloqueadas de inmediato. Solo se ejecutarán órdenes condicionadas aceptadas desde la app.";if(!window.confirm(msg))return;try{const out=await apiPost<{mode:string;dispatch?:{ok?:boolean}}>("/api/v1/mode",{confirmed:true,mode:next});el("receipt").textContent=`RECIBO · modo ${out.mode==="auto"?"piloto automático":"semiautomático"} activo${out.dispatch?.ok?" · runner notificado":""}`;setTimeout(refresh,1000);}catch(e){window.alert(e instanceof Error?e.message:"No se pudo cambiar modo");}});
async function loadLogs(){el("logsLive").textContent=`LIVE · ${formatTime(Date.now())}`;try{const data=await apiGet<{logs:Array<{ts:string,event:string;data:Record<string,unknown>}>}>("/api/v1/logs?limit=80&compact=1");el("logRows").innerHTML=data.logs.map(x=>`<article><time>${formatDateTime(x.ts)}</time><b>${esc(x.event)}</b><pre>${esc(JSON.stringify(x.data,null,2))}</pre></article>`).join("")||"<p>Sin registros</p>";}catch(e){el("logRows").textContent=e instanceof Error?e.message:"Error";}}
el("logs").addEventListener("click",async()=>{const dialog=el("logsDialog") as HTMLDialogElement;dialog.showModal();el("logRows").innerHTML="<p class='muted'>Cargando…</p>";await loadLogs();});
setInterval(()=>{const dialog=el("logsDialog") as HTMLDialogElement;if(dialog.open)loadLogs();},LOG_REFRESH_INTERVAL_MS);

function allocationValuesFromForm(){const rows=[...document.querySelectorAll<HTMLInputElement>('[data-alloc-symbol]')];const out:Record<string,number>={};for(const input of rows){const symbol=input.dataset.allocSymbol||'';const value=Number(input.value||0);if(symbol&&Number.isFinite(value)&&value>0)out[symbol]=Math.round(value*100)/100;}return out;}
function updateAllocSum(){const values=allocationValuesFromForm();const sum=Object.values(values).reduce((a,b)=>a+b,0);el('allocSum').textContent=`Suma ${sum.toFixed(2)}%`;el('allocSum').className=Math.abs(sum-100)<=0.01?'up':'down';(el('saveAllocation') as HTMLButtonElement).disabled=Math.abs(sum-100)>0.01;}
function renderAllocation(data:AllocationData, override?:Record<string,number>){const source=override||Object.fromEntries(data.assets.map(a=>[a.symbol,a.target_pct]));const symbols=Array.from(new Set([...data.assets.map(a=>a.symbol),...Object.keys(source)])).sort((a,b)=>(source[b]||0)-(source[a]||0)||a.localeCompare(b));el('allocationRows').innerHTML=symbols.map(symbol=>{const asset=data.assets.find(a=>a.symbol===symbol);const value=source[symbol]??0;return `<article><div class="coin">${esc(symbol.slice(0,1))}</div><div><b>${esc(symbol)}</b><small>Actual ${(asset?.current_pct||0).toFixed(1)}% · ${money(asset?.value_usd||0)}</small></div><input data-alloc-symbol="${esc(symbol)}" type="number" min="0" max="100" step="0.01" value="${value}"><button type="button" data-remove-asset="${esc(symbol)}">✕</button></article>`}).join('')||'<p class="muted">Sin activos</p>';document.querySelectorAll<HTMLInputElement>('[data-alloc-symbol]').forEach(input=>input.addEventListener('input',updateAllocSum));document.querySelectorAll<HTMLButtonElement>('[data-remove-asset]').forEach(button=>button.addEventListener('click',()=>{const sym=button.dataset.removeAsset;const input=document.querySelector<HTMLInputElement>(`[data-alloc-symbol="${sym}"]`);if(input){input.value='0';button.closest('article')?.remove();updateAllocSum();}}));updateAllocSum();}
async function loadAllocation(){try{const data=await apiGet<AllocationData>('/api/v1/allocation');renderAllocation(data);(el('suggestAlloc') as HTMLButtonElement).onclick=()=>renderAllocation(data,data.suggested);(el('addAsset') as HTMLButtonElement).onclick=()=>{const input=el('newAsset') as HTMLInputElement;const symbol=input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(!symbol)return;const current=allocationValuesFromForm();current[symbol]=current[symbol]||0;renderAllocation({...data,assets:[...data.assets,{symbol,target_pct:0,current_pct:0,value_usd:0,held:false}]},current);input.value='';};}catch(e){el('allocationRows').innerHTML=`<p class='down'>${esc(e instanceof Error?e.message:'No se pudo cargar distribución')}</p>`;}}

el("config").addEventListener("click",async()=>{const dialog=el("configDialog") as HTMLDialogElement;dialog.showModal();el("configPresets").innerHTML="";el("configForm").innerHTML="<p class='muted'>Cargando…</p>";loadAllocation();try{const data=await apiGet<{parameters:ConfigParam[];presets?:ConfigPreset[]}>("/api/v1/config");el("configPresets").innerHTML=(data.presets||[]).map(p=>`<button type="button" class="preset" data-preset="${esc(p.key)}"><b>${esc(p.label)}</b><small>${esc(p.description)}</small></button>`).join("");el("configForm").innerHTML=data.parameters.map(p=>`<label><span>${esc(p.label)}<small>${esc(p.key)} · ${p.min}–${p.max}</small></span><input name="${esc(p.key)}" type="number" value="${p.value}" min="${p.min}" max="${p.max}" step="any"></label>`).join("");document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(button=>button.addEventListener("click",async()=>{const preset=button.dataset.preset||"";const label=button.querySelector("b")?.textContent||preset;if(!window.confirm(`¿SÍ, aplicar preset ${label}?

Esto reemplaza los límites actuales por una configuración predeterminada.`))return;try{const out=await apiPost<{changed:unknown[];preset:string}>("/api/v1/config",{confirmed:true,preset});el("receipt").textContent=`RECIBO · preset ${out.preset||preset} aplicado · ${out.changed.length} cambios`;dialog.close();setTimeout(refresh,1000);}catch(e){window.alert(e instanceof Error?e.message:"No se pudo aplicar preset");}}));}catch(e){el("configForm").innerHTML=`<p class='down'>${esc(e instanceof Error?e.message:"No se pudo cargar")}</p>`;}});
el("saveAllocation").addEventListener("click",async()=>{const allocation=allocationValuesFromForm();const sum=Object.values(allocation).reduce((a,b)=>a+b,0);if(Math.abs(sum-100)>0.01){window.alert(`La distribución debe sumar 100%. Ahora suma ${sum.toFixed(2)}%`);return;}const preview=Object.entries(allocation).map(([k,v])=>`${k} = ${v}%`).join("\n");if(!window.confirm(`¿SÍ, guardar esta distribución objetivo?\n\n${preview}\n\nLos activos en 0 se eliminan.`))return;try{const out=await apiPost<{allocation:Record<string,number>;sum:number}>("/api/v1/allocation",{confirmed:true,allocation});el("receipt").textContent=`RECIBO · distribución guardada · ${out.sum}%`;await loadAllocation();setTimeout(refresh,1000);}catch(e){window.alert(e instanceof Error?e.message:"No se pudo guardar distribución");}});
el("saveConfig").addEventListener("click",async()=>{const form=el("configForm") as HTMLFormElement;const values=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,Number(v)]));const preview=Object.entries(values).map(([k,v])=>`${k} = ${v}`).join("\n");if(!window.confirm(`¿SÍ, guardar estos límites?\n\n${preview}\n\nAceptar = SÍ · Cancelar = NO`))return;try{const out=await apiPost<{changed:unknown[]}>("/api/v1/config",{confirmed:true,values});el("receipt").textContent=`RECIBO · ${out.changed.length} parámetros guardados`; (el("configDialog") as HTMLDialogElement).close();}catch(e){window.alert(e instanceof Error?e.message:"No se pudo guardar");}});
document.querySelectorAll<HTMLElement>("[data-close]").forEach(button=>button.addEventListener("click",()=>{(el(button.dataset.close!) as HTMLDialogElement).close();}));

// Estrategias (MODALIDADES)
let currentStrategies:Record<string,any>|null=null;
const STRATEGY_UI={
  short:{title:'SHORT',desc:'Venta defensiva BTC: -3% TP, +3.5% SL',fields:[['enabled','Habilitado','bool'],['min_confidence_pct','Confianza mínima %','number']]},
  long:{title:'LONG',desc:'Compra agresiva BTC: +3% TP, -3.5% SL',fields:[['enabled','Habilitado','bool'],['min_confidence_pct','Confianza mínima %','number']]},
  grid:{title:'GRID',desc:'Escalera de ordenes de compra y venta',fields:[['symbol','Símbolo','text'],['levels','Niveles','number'],['step_pct','Paso %','number'],['amount_usdc','USDC por nivel','number']]},
  dca:{title:'DCA',desc:'Compra programada cada X horas',fields:[['symbol','Símbolo','text'],['interval_hours','Cada (horas)','number'],['amount_usdc','USDC por compra','number'],['dip_pct','Bajo mercado %','number']]},
  rsi:{title:'RSI',desc:'Compra en sobreventa y vende en sobrecompra',fields:[['symbol','Símbolo','text'],['timeframe','Marco','text'],['period','Período','number'],['oversold','Sobreventa','number'],['overbought','Sobrecompra','number']]},
  macd:{title:'MACD',desc:'Cruce del histograma MACD 12/26/9',fields:[['symbol','Símbolo','text'],['timeframe','Marco','text']]},
  dip_buyer:{title:'DIP BUYER',desc:'Comprar en retrocesos, nunca perseguir precio',fields:[['max_chase_pct','Max persecución 24h %','number']]},
  momentum:{title:'MOMENTUM',desc:'Ranking por tendencia 7d/24h',fields:[['breakout_min_confidence','Confianza breakout','number'],['prefilter','Activos que evalúa IA','number']]},
};
async function loadStrategies(){
  try{
    const data=await apiGet<{strategies:Record<string,any>}>('/api/v1/strategies');
    currentStrategies=data.strategies;
    renderStrategies();
  }catch(e){
    el('stratBody').innerHTML=`<p class="down">${esc(e instanceof Error?e.message:'No se pudo cargar')}</p>`;
  }
}
function renderStrategies(){
  if(!currentStrategies)return;
  let html='';
  for(const key in STRATEGY_UI){
    const meta=STRATEGY_UI[key as keyof typeof STRATEGY_UI];
    const strat=currentStrategies[key]||{};
    html+=`<article style="padding:12px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">`;
    html+=`<div><b>${meta.title}</b><br><small class="muted">${meta.desc}</small></div>`;
    if('enabled' in strat){
      html+=`<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" data-strat="${key}" ${strat.enabled?'checked':''}><small>${strat.enabled?'ON':'OFF'}</small></label></div>`;
    }else{html+='</div>';}
    html+=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-top:8px">`;
    for(const field of meta.fields){
      const val=strat[field[0]]??'';
      if(field[2]==='bool'){
        html+=`<label><input type="checkbox" data-field="${key}.${field[0]}" ${val?'checked':''}> ${field[1]}</label>`;
      }else{
        html+=`<label><small>${field[1]}</small><input data-field="${key}.${field[0]}" type="${field[2]}" value="${esc(String(val))}" step="any" style="width:100%"></label>`;
      }
    }
    html+='</div></article>';
  }
  el('stratBody').innerHTML=html;
  document.querySelectorAll<HTMLInputElement>('[data-strat],[data-field]').forEach(inp=>{
    inp.addEventListener('change',()=>{const sm=inp.parentElement?.querySelector('small');if(sm)sm.textContent=inp.checked?'ON':'OFF';});
  });
}
el('stratSave').addEventListener('click',async()=>{
  if(!currentStrategies)return;
  const out:any={};
  for(const key in STRATEGY_UI){out[key]={}}
  document.querySelectorAll<HTMLInputElement>('[data-strat]').forEach(inp=>{
    out[inp.dataset.strat!].enabled=inp.checked;
  });
  document.querySelectorAll<HTMLInputElement>('[data-field]').forEach(inp=>{
    const[k,f]=inp.dataset.field!.split('.');
    out[k][f]=inp.type==='checkbox'?inp.checked:(inp.type==='number'?Number(inp.value):inp.value);
  });
  if(!window.confirm('¿Guardar estas modalidades?'))return;
  try{
    await apiPost('/api/v1/strategies',{confirmed:true,strategies:out});
    el('receipt').textContent='RECIBO · modalidades guardadas';
    loadStrategies();
    refresh();
  }catch(e){window.alert(e instanceof Error?e.message:'No se pudo guardar');}
});
loadStrategies();

let updateVersionInfo:any=null;
async function checkForUpdates(){
  try{
    const version=await apiGet<{current:string;latest:string;has_update:boolean;features_added:string[];download_url:string}>("/api/v1/version");
    console.log('✓ Version check:', version);
    updateVersionInfo=version;

    // Mostrar versión en header
    const appVersionEl=el("appVersion");
    if(appVersionEl) appVersionEl.textContent=`v${version.current}`;

    const updateBtn=el("checkUpdate") as HTMLButtonElement;
    const updateLabel=el("updateLabel") as HTMLElement;

    if(version.has_update){
      updateLabel.textContent=`✅ v${version.latest} disponible`;
      updateBtn.style.background="linear-gradient(135deg, #65f5ac, #4fc99d)";
      updateBtn.style.color="#000";

      // Mostrar popup automático
      const updateDialog=el("updateDialog") as HTMLDialogElement;
      el("updateDialogVersion").textContent=`v${version.current} → v${version.latest}`;
      el("updateMsg").innerHTML=`<b>Nuevas características:</b><br><br>${version.features_added.map(f=>`✓ ${f}`).join("<br>")}`;
      updateDialog.showModal();
    }else{
      updateLabel.textContent=`✓ Versión: v${version.current}`;
    }

    updateBtn.onclick=(e)=>{
      e.preventDefault();
      if(!version.has_update){
        window.alert(`Tienes la versión más reciente: v${version.current}`);
        return;
      }
      (el("updateDialog") as HTMLDialogElement).showModal();
    };
  }catch(e){
    const updateLabel=el("updateLabel") as HTMLElement;
    updateLabel.textContent="No se pudo verificar versión";
  }
}

el("skipUpdate").addEventListener("click",()=>{
  (el("updateDialog") as HTMLDialogElement).close();
  el("receipt").textContent="ACTUALIZACIÓN POSPUESTA · Puedes actualizar cuando quieras desde el botón UPDATE";
});

el("downloadUpdate").addEventListener("click",()=>{
  if(!updateVersionInfo)return;
  const v=updateVersionInfo;
  const downloadUrl='http://196.111.239.16:8000/TradeBot-AI-1.4.3-WAITING.apk';
  const downloadCmd=`curl -L -o ~/storage/downloads/CryptoBot-${v.latest}.apk ${downloadUrl}`;
  window.open(downloadUrl, '_blank');
  (el("updateDialog") as HTMLDialogElement).close();
  el("receipt").textContent=`DESCARGA INICIADA · ${downloadUrl}`;
});

setInterval(checkForUpdates,60000);
checkForUpdates();
}catch(e){
const msg=e instanceof Error?e.message:String(e);
const stack=e instanceof Error?e.stack:"";
const app=document.querySelector("#app");
if(app){
app.innerHTML=`<h1 style="color:red">❌ ERROR</h1><div style="background:rgba(255,0,0,.1);border:1px solid red;padding:15px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all">${msg}\n\n${stack}</div>`;
}
console.error("CRASH:",e);
document.title="ERROR - "+msg;
}
