"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Flame, LayoutGrid, ChefHat, BarChart3, Settings2, ChevronRight, ArrowUpRight, Plus, Search, RefreshCw, Clock3, Check, CheckCheck, PackageCheck, Bike, ShoppingBag, X, Download, Upload, CircleHelp, LogOut, ExternalLink, Printer, AlertTriangle, UtensilsCrossed, ArrowRight, Minus, SlidersHorizontal, Store, Wifi, LoaderCircle, FileJson, ShieldCheck, CalendarDays } from "lucide-react";
import type { AppSettings, Order, OrderItem, OrderStatus } from "../lib/domain";
import { parseNewOrder, parseSettings, validateImport } from "../lib/domain";

type View = "orders" | "kitchen" | "reports" | "settings";
type Mode = "demo" | "live";
type Workspace = { orders: Order[]; activeOrders: Order[]; settings: AppSettings; truncated?: boolean; activeTruncated?: boolean };
const statuses: OrderStatus[] = ["new", "preparing", "ready", "handed_over", "cancelled"];
const labels: Record<OrderStatus, string> = { new: "待接单", preparing: "制作中", ready: "待取餐", handed_over: "已交接", cancelled: "已取消" };
const actions: Partial<Record<OrderStatus, { label: string; next: OrderStatus }>> = { new: { label: "接单并制作", next: "preparing" }, preparing: { label: "完成出餐", next: "ready" }, ready: { label: "确认已交接", next: "handed_over" } };
const catalog = [
  { name: "招牌部队锅", spec: "单人锅 · 微辣", price: 3290, tag: "招牌", icon: "锅" },
  { name: "招牌部队锅", spec: "双人分享锅 · 中辣", price: 5890, tag: "招牌", icon: "锅" },
  { name: "招牌肥牛石锅拌饭", spec: "标准份 · 微辣", price: 2690, tag: "人气", icon: "饭" },
  { name: "韩式泡菜五花肉拌饭", spec: "标准份 · 微辣", price: 2690, tag: "经典", icon: "饭" },
  { name: "香煎鸡腿石锅拌饭", spec: "标准份 · 不辣", price: 2590, tag: "经典", icon: "饭" },
  { name: "菌菇蔬菜石锅拌饭", spec: "标准份 · 不辣", price: 2290, tag: "清爽", icon: "饭" },
  { name: "芝士年糕", spec: "小份", price: 1290, tag: "小食", icon: "食" },
  { name: "冰镇可乐", spec: "330ml", price: 500, tag: "饮品", icon: "饮" },
];
function today() { return new Date(Date.now() + 28800000).toISOString().slice(0, 10); }
function time(value: number) { return new Date(value).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }); }
function money(value: number) { return (value / 100).toFixed(2); }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

export default function Dashboard() {
  const [view, setView] = useState<View>("orders");
  const [mode, setMode] = useState<Mode>("demo");
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Workspace>({ orders: [], activeOrders: [], settings: { storeName: "石小满 · 石锅拌饭", prepMinutes: 15 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [sound, setSound] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [publicDemo, setPublicDemo] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const previousIds = useRef<Set<string> | null>(null);
  const loadSequence = useRef(0);
  const mutationLock = useRef(false);
  const soundEnabled = useRef(sound);
  soundEnabled.current = sound;
  const currentScope = useRef("");
  const scope = `${mode}:${date}`;
  currentScope.current = scope;
  const audioRef = useRef<AudioContext | null>(null);

  const api = useCallback(async (path: string, method = "GET", body?: unknown): Promise<any> => {
    const response = await fetch(path, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
    let result: any; try { result = await response.json(); } catch { throw new Error("连接暂时中断，请刷新后重试"); }
    if (!response.ok) throw new Error(result.error || "操作失败，请稍后重试");
    return result;
  }, []);

  const load = useCallback(async (quiet = false) => {
    const requestScope = `${mode}:${date}`;
    if (currentScope.current !== requestScope) return;
    const sequence = ++loadSequence.current;
    if (!quiet) setLoading(true);
    try {
      const next: Workspace = await api(`/api/workspace?mode=${mode}&date=${date}`);
      if (currentScope.current !== requestScope || sequence !== loadSequence.current) return;
      const previous = previousIds.current;
      const newOrders = (next.activeOrders || []).filter(o => o.status === "new" && previous && !previous.has(o.id));
      if (newOrders.length) {
        setNotice(`有 ${newOrders.length} 笔新订单待处理`);
        if (soundEnabled.current && audioRef.current) { try { const audio = audioRef.current; const osc = audio.createOscillator(); const gain = audio.createGain(); osc.connect(gain); gain.connect(audio.destination); osc.frequency.value = 830; gain.gain.setValueAtTime(.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .45); osc.start(); osc.stop(audio.currentTime + .45); } catch { /* Audio availability must not interrupt order refresh. */ } }
      }
      previousIds.current = new Set((next.activeOrders || []).map(o => o.id));
      setData(next); setError("");
      setSelected(old => old ? [...next.orders, ...(next.activeOrders || [])].find(o => o.id === old.id) || old : null);
    } catch (err) { if (currentScope.current === requestScope && sequence === loadSequence.current) setError((err as Error).message); }
    finally { if (currentScope.current === requestScope && sequence === loadSequence.current) setLoading(false); }
  }, [mode, date, api]);

  useEffect(() => { previousIds.current = null; setData(old => ({ ...old, orders: [], activeOrders: [] })); setSelected(null); setCancelOrder(null); setCancelReason(""); setNewOpen(false); setError(""); setNotice(""); void load(); const poll = setInterval(() => { if (!document.hidden) void load(true); }, 10000); return () => { clearInterval(poll); loadSequence.current += 1; }; }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { fetch("/container/session").then(r => r.ok ? r.json() : null).then(value => { const result = value as { publicDemo?: boolean } | null; if (result?.publicDemo) { setPublicDemo(true); setMode("demo"); } }).catch(() => {}); }, []);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && !newOpen) { setSelected(null); setHelp(false); setCancelOrder(null); } }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [busy, newOpen]);

  const counts = useMemo(() => Object.fromEntries(statuses.map(s => [s, data.orders.filter(o => o.status === s).length])) as Record<OrderStatus, number>, [data.orders]);
  const active = data.activeOrders || [];
  const overdue = active.filter(o => o.status !== "ready" && o.dueAt < now);
  const crossDay = active.filter(o => new Date(o.createdAt + 28800000).toISOString().slice(0, 10) !== date);
  const orders = useMemo(() => data.orders.filter(o => (filter === "all" || o.status === filter) && `${o.number} ${o.externalId} ${o.customerName} ${o.note} ${o.items.map(i => i.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    const rank = (o: Order) => ["handed_over", "cancelled"].includes(o.status) ? 1 : 0;
    return rank(a) - rank(b) || (rank(a) === 0 ? a.dueAt - b.dueAt : b.createdAt - a.createdAt);
  }), [data.orders, filter, query]);

  async function seed() {
    if (mutationLock.current) return;
    mutationLock.current = true;
    const requestScope = scope;
    setBusy("seed"); try { const result = await api("/api/demo", "POST", {}); if (currentScope.current !== requestScope) return; const targetDate = today(); setMode("demo"); setDate(targetDate); if (mode === "demo" && date === targetDate) await load(true); setNotice(result.created ? `已载入 ${result.created} 笔演示订单` : "今天的演示订单已存在，不会重复创建"); } catch (err) { if (currentScope.current === requestScope) setError((err as Error).message); } finally { mutationLock.current = false; setBusy(""); }
  }
  async function transition(order: Order, nextStatus: OrderStatus, reason?: string) {
    if (mutationLock.current || order.isDemo !== (mode === "demo")) return;
    mutationLock.current = true;
    const requestScope = scope;
    setBusy(order.id); try { const result = await api(`/api/orders/${order.id}`, "PATCH", { expectedVersion: order.version, nextStatus, ...(reason ? { cancelReason: reason } : {}) }); if (currentScope.current !== requestScope) return; setSelected(old => old?.id === order.id ? result.order : old); setNotice(`订单 #${order.number} · ${labels[nextStatus]}`); setCancelOrder(null); setCancelReason(""); await load(true); } catch (err) { if (currentScope.current === requestScope) { setError((err as Error).message); await load(true); setNotice((err as Error).message); } } finally { mutationLock.current = false; setBusy(""); }
  }
  function exportOrders(format: "csv" | "json") {
    if (!data.orders.length) { setNotice("当前日期没有可导出的订单"); return; }
    if (format === "json") { download(`石小满-${mode}-${date}-订单快照.json`, JSON.stringify({ exportedAt: new Date().toISOString(), mode, date, truncated: !!data.truncated, orders: data.orders }, null, 2), "application/json;charset=utf-8"); }
    else {
      const cell = (value: unknown) => { let s = String(value ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
      const rows = [["订单号", "外部订单号", "模式", "来源", "状态", "顾客称呼", "菜品", "金额(元)", "创建时间(上海)", "备注"], ...data.orders.map(o => [o.number, o.externalId, o.isDemo ? "演示" : "营业", o.channel, labels[o.status], o.customerName, o.items.map(i => `${i.name}(${i.spec})×${i.quantity}`).join("；"), money(o.amountCents), new Date(o.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }), o.note])];
      download(`石小满-${mode}-${date}.csv`, "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
    }
    setNotice(data.truncated ? "已导出当前可见的前 2000 笔，请注意不是全量备份" : "订单已导出");
  }

  function toggleSound() { if (!sound) { try { audioRef.current ??= new AudioContext(); void audioRef.current.resume(); setSound(true); setNotice("新单提示音已开启；请保持页面打开"); } catch { setNotice("浏览器暂不支持提示音"); } } else setSound(false); }
  const title = { orders: "订单中心", kitchen: "厨房看板", reports: "经营概览", settings: "门店设置" }[view];
  const stats = [{ status: "new" as const, icon: ShoppingBag, caption: "等待接单", hint: "及时接单，好饭不久等", color: "orange" }, { status: "preparing" as const, icon: Flame, caption: "正在制作", hint: "石锅升温，美味进行中", color: "red" }, { status: "ready" as const, icon: PackageCheck, caption: "等待取餐", hint: "打包完成，等候交接", color: "green" }, { status: "handed_over" as const, icon: CheckCheck, caption: "已交接订单", hint: "一份热饭，一份满足", color: "gray" }];

  return <div className={`app-shell ${view === "kitchen" ? "kitchen-mode" : ""}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => setView("orders")}><span className="brand-mark"><UtensilsCrossed size={25} /></span><span><b>石小满<span className="brand-dot">.</span></b><small>STONEBOWL KITCHEN</small></span></button>
      <div className="store-switch"><span className="store-icon"><Store size={18} /></span><div><strong>{data.settings.storeName}</strong><small>门店经营工作台</small></div></div>
      <div className="nav-caption">门店管理 <span>WORKSPACE</span></div>
      <nav aria-label="主导航">{([{ id: "orders", label: "订单中心", Icon: LayoutGrid }, { id: "kitchen", label: "厨房看板", Icon: ChefHat }, { id: "reports", label: "经营概览", Icon: BarChart3 }, { id: "settings", label: "门店设置", Icon: Settings2 }] as const).map(({ id, label, Icon }) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id)}><Icon size={19} /><span>{label}</span>{id === "orders" && active.filter(o => o.status === "new").length > 0 ? <em>{active.filter(o => o.status === "new").length}</em> : view === id && <ChevronRight size={15} />}</button>)}</nav>
      <div className="sidebar-story"><span className="story-line" /><ChefHat size={29} strokeWidth={1.4} /><p>锅里有烟火<br />心里有热爱。</p><small>做好每一份热腾腾的饭</small><div className="bowl-art"><i /><i /><i /><span /></div></div>
      <div className="sidebar-bottom"><button onClick={() => setHelp(true)}><CircleHelp size={17} />使用指南<ArrowUpRight size={15} /></button><a href="/signout-with-chatgpt?return_to=/" target="_top"><span className="avatar">店</span><span><strong>我的门店空间</strong><small>登录账号独立保存</small></span><LogOut size={16} /></a></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">工作台 <ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-right"><span className="desktop-date"><CalendarDays size={14} />{new Date(now).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" })}</span><span className="platform-label"><span />美团未接入</span><button className={`icon-button ${sound ? "sound-on" : ""}`} onClick={toggleSound} title={sound ? "关闭新单提示音" : "开启新单提示音"} aria-label={sound ? "关闭提示音" : "开启提示音"}>{sound ? <Bell size={19} /> : <BellOff size={19} />}</button><span className="header-avatar">店</span></div></header>
      <div className="main-content">
        <div className={`mode-banner ${mode === "live" ? "live" : ""}`}><span className="banner-message"><ShieldCheck size={16} /><span>{publicDemo ? "公开体验空间 · 仅支持虚构演示订单，每位访客数据独立" : mode === "demo" ? "演示空间 · 所有演示订单与营业数据隔离，菜品价格仅为示例" : "营业空间 · 手工录单 / 规范 JSON 导入，状态暂不回传美团"}</span></span><div className="mode-switch"><button className={mode === "demo" ? "chosen" : ""} disabled={!!busy} onClick={() => { setMode("demo"); setFilter("all"); }}>演示体验</button><button disabled={publicDemo || !!busy} title={publicDemo ? "公开容器仅支持演示" : "独立的实际录单空间"} className={mode === "live" ? "chosen" : ""} onClick={() => { setMode("live"); setFilter("all"); }}>营业录单</button></div></div>
        <section className="page-heading"><div><div className="eyebrow">{view === "kitchen" ? "KITCHEN DISPLAY" : view === "settings" ? "STORE SETTINGS" : view === "reports" ? "DAILY INSIGHTS" : "ORDER MANAGEMENT"}</div><h1>{title}<span className="heading-dot">.</span></h1><p>{view === "orders" ? "每一份热饭，都有条不紊。" : view === "kitchen" ? "专注出餐节奏，让美味准时上桌。" : view === "reports" ? "看见今天的忙碌，也看见生意的温度。" : "把门店的日常，安排得刚刚好。"}</p></div><div className="heading-actions"><button className="button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /><span>刷新</span></button>{view !== "settings" && <button className="button primary" disabled={!!busy || loading} onClick={() => setNewOpen(true)}><Plus size={17} />新增订单</button>}</div></section>
        {error && <div className="error-banner" role="alert"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
        {(data.truncated || data.activeTruncated) && <div className="error-banner"><AlertTriangle size={17} />当前数据超过 2000 笔，列表和统计已截断，导出不是全量备份。</div>}
        {view === "orders" && <>
          <section className="stats-grid">{stats.map(({ status, icon: Icon, caption, hint, color }) => <button className={`stat-card ${filter === status ? "stat-selected" : ""}`} key={status} onClick={() => setFilter(filter === status ? "all" : status)}><div className="stat-top"><span>{caption}</span><span className={`stat-icon ${color}`}><Icon size={19} /></span></div><div className="stat-value">{loading ? "—" : counts[status]}<small>单</small>{status === "preparing" && overdue.filter(o => data.orders.some(d => d.id === o.id)).length > 0 && <em className="overdue-mini">有超时</em>}</div><p>{hint}</p></button>)}</section>
          <section className="orders-section"><div className="section-top"><h2>订单工作台 <span>{data.orders.length} 笔订单</span></h2><div className="section-top-actions"><label className="date-control"><CalendarDays size={14} /><input aria-label="订单日期" type="date" value={date} max={today()} disabled={!!busy} onChange={e => e.target.value && setDate(e.target.value)} /></label><button className="text-button" onClick={() => exportOrders("csv")}><Download size={15} />导出</button></div></div>
            <div className="order-toolbar"><div className="status-tabs">{(["all", ...statuses] as const).map(s => <button key={s} className={filter === s ? "tab active" : "tab"} onClick={() => setFilter(s)}>{s === "all" ? "全部订单" : labels[s]}<span>{s === "all" ? data.orders.length : counts[s]}</span></button>)}</div><label className="search-input"><Search size={16} /><input placeholder="搜索订单号、菜品、备注" value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索订单" />{query && <button aria-label="清空搜索" onClick={() => setQuery("")}><X size={14} /></button>}</label></div>
            {crossDay.length > 0 && <button className="cross-day" onClick={() => setView("kitchen")}><Clock3 size={15} />还有 {crossDay.length} 笔其他日期的订单未交接，前往厨房看板处理<ArrowRight size={15} /></button>}
            {loading ? <div className="loading-state"><LoaderCircle size={28} className="spin" /><p>正在读取门店订单…</p></div> : orders.length ? <div className="order-grid">{orders.map(order => <OrderCard key={order.id} order={order} now={now} busy={!!busy} detail={() => setSelected(order)} advance={() => { const action = actions[order.status]; if (action) void transition(order, action.next); }} />)}</div> : <Empty icon={<ShoppingBag size={34} />} title={query || filter !== "all" ? "这里暂时没有匹配的订单" : "新的一天，从第一份热饭开始"} description={query || filter !== "all" ? "试试其他关键词，或切换订单状态。" : mode === "demo" ? "载入示例订单，体验部队锅和石锅拌饭的完整出餐流程。" : "可以手工新增订单，或在门店设置中导入规范 JSON 文件。"}>{!query && filter === "all" && (mode === "demo" ? <button disabled={!!busy} className="button primary" onClick={seed}><Plus size={16} />{busy === "seed" ? "正在载入…" : "载入演示订单"}</button> : <button className="button primary" onClick={() => setNewOpen(true)}><Plus size={16} />录入第一笔订单</button>)}</Empty>}
          </section>
        </>}
        {view === "kitchen" && <><div className="kitchen-summary"><span><span className="live-dot" />全部日期的未完成订单 · 每 10 秒刷新</span><strong>{overdue.length ? `${overdue.length} 单已超过预计出餐时间` : "出餐节奏，一目了然"}</strong></div><div className="kanban">{(["new", "preparing", "ready"] as const).map(status => { const queue = active.filter(o => o.status === status).sort((a, b) => a.dueAt - b.dueAt); return <section className={`kanban-column ${status}`} key={status}><header><span><i />{labels[status]}</span><b>{queue.length}</b></header><div className="kanban-cards">{queue.length ? queue.map(o => <OrderCard key={o.id} order={o} now={now} busy={!!busy} detail={() => setSelected(o)} advance={() => void transition(o, actions[o.status]!.next)} compact />) : <div className="kanban-empty"><Check size={24} /><p>{status === "new" ? "新订单会出现在这里" : status === "preparing" ? "暂无制作中的订单" : "暂无待取餐订单"}</p></div>}</div></section>; })}</div></>}
        {view === "reports" && <Reports orders={data.orders} date={date} setDate={setDate} exportCsv={() => exportOrders("csv")} mode={mode} />}
        {view === "settings" && <Settings key={`${mode}:${data.settings.storeName}:${data.settings.prepMinutes}`} settings={data.settings} api={api} mode={mode} refresh={() => load(true)} toast={setNotice} exportJson={() => exportOrders("json")} />}
        <footer className="workspace-footer"><span><span />石小满工作台 <i>/</i> 把每一餐，做得更好</span><span>{mode === "demo" ? "演示数据" : "独立营业数据"} · 上海时区 · 每 10 秒刷新</span></footer>
      </div>
    </main>
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    {selected && <div className="overlay" onClick={() => !busy && setSelected(null)}><section className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={e => e.stopPropagation()}><div className="drawer-top"><span>订单详情</span><button aria-label="关闭详情" className="icon-button" onClick={() => setSelected(null)}><X size={22} /></button></div><div className="drawer-body"><div className="detail-order-number"><div><small>{selected.isDemo ? "演示订单" : "营业订单"}</small><h2 id="detail-title">#{selected.number}</h2></div><StatusBadge status={selected.status} /></div><p className="detail-external">外部单号：{selected.externalId}</p><div className="detail-info"><span><ShoppingBag size={16} />{selected.customerName}</span><span>{selected.deliveryType === "pickup" ? <ShoppingBag size={16} /> : <Bike size={16} />}{selected.deliveryType === "pickup" ? "到店自取" : "配送订单"}</span></div><div className="detail-items">{selected.items.map((item, i) => <div key={i}><div><strong>{item.name} × {item.quantity}</strong><small>{item.spec}</small></div><b>¥{money(item.unitPriceCents * item.quantity)}</b></div>)}</div>{selected.note && <div className="order-note detail-note"><AlertTriangle size={15} /><span>{selected.note}</span></div>}<div className="detail-total"><span>菜品合计<small>仅菜品金额，不含平台结算费用</small></span><b>¥{money(selected.amountCents)}</b></div><h3 className="timeline-title">订单进度</h3><ol className="timeline">{selected.events.map((event, i) => <li key={i}><i /><div><strong>{labels[event.status as OrderStatus] || event.status}</strong><small>{new Date(event.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {event.actor}</small>{event.reason && <p>取消原因：{event.reason}</p>}</div></li>)}</ol><p className="platform-footnote">这里记录门店内的制作与交接进度，不代表美团配送完成，也不会自动回传平台。</p></div><div className="drawer-actions"><button className="button secondary" onClick={() => window.print()}><Printer size={16} />打印小票</button>{["new", "preparing"].includes(selected.status) && <button className="text-button danger" onClick={() => { setCancelOrder(selected); setCancelReason(""); }}>取消订单</button>}{actions[selected.status] && <button disabled={!!busy} className="button primary" onClick={() => void transition(selected, actions[selected.status]!.next)}>{actions[selected.status]!.label}<ArrowRight size={16} /></button>}</div></section></div>}
    {selected && <div className="print-receipt"><h2>{data.settings.storeName}</h2><h1>#{selected.number}</h1><p>{selected.isDemo ? "【演示订单】" : "【门店订单】"} · {labels[selected.status]}</p><p>{new Date(selected.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p><hr />{selected.items.map((i, k) => <p key={k}><b>{i.name} × {i.quantity}</b><br />{i.spec} · ¥{money(i.unitPriceCents * i.quantity)}</p>)}<hr /><p><b>备注：{selected.note || "无"}</b></p><p>菜品合计 ¥{money(selected.amountCents)}</p><p>门店交接记录，不作为平台支付凭证</p></div>}
    {newOpen && <NewOrder key={scope} mode={mode} api={api} prepMinutes={data.settings.prepMinutes} close={() => setNewOpen(false)} done={async () => { if (currentScope.current !== scope) return; setNewOpen(false); const targetDate = today(); setDate(targetDate); setFilter("all"); setNotice("订单已创建，等待接单"); if (date === targetDate) await load(true); }} />}
    {cancelOrder && <div className="overlay modal-overlay"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><div className="modal-head"><h2 id="cancel-title">取消订单 #{cancelOrder.number}</h2><button className="icon-button" aria-label="关闭" onClick={() => setCancelOrder(null)}><X size={21} /></button></div><p className="muted">取消后无法恢复，此操作只记录门店状态，不会申请平台退款。</p><label className="field">取消原因<textarea maxLength={200} value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="例如：食材售罄，已与顾客沟通" /></label><div className="modal-footer"><button className="button secondary" onClick={() => setCancelOrder(null)}>返回</button><button className="button danger-button" disabled={!cancelReason.trim() || !!busy} onClick={() => void transition(cancelOrder, "cancelled", cancelReason)}>确认取消</button></div></section></div>}
    {help && <div className="overlay modal-overlay" onClick={() => setHelp(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><div className="modal-head"><h2 id="help-title">让热饭有条不紊</h2><button aria-label="关闭指南" className="icon-button" onClick={() => setHelp(false)}><X size={21} /></button></div><div className="help-flow">待接单<ArrowRight size={16} />制作中<ArrowRight size={16} />待取餐<ArrowRight size={16} />已交接</div><p>从“载入演示订单”开始，试着接单、完成出餐，再确认交接。厨房看板持续展示全部日期的未完成订单。</p><p>招牌部队锅和石锅拌饭已加入快捷录单；创建订单时可以调整菜品名称、规格和价格。示例价不是店内真实售价。</p><p>美团目前未接入。可手工录单，或按“门店设置”的规范转换 JSON 后导入。平台退款、配送和自动接单仍需在美团处理。</p><p>网页版使用 ChatGPT 登录，每个账号数据独立。容器公开演示使用访客空间，不能当作真实门店营业后台。</p><button className="button primary" onClick={() => setHelp(false)}>开始使用<ArrowRight size={16} /></button></section></div>}
  </div>;
}

function StatusBadge({ status }: { status: OrderStatus }) { return <span className={`status-badge ${status}`}><i />{labels[status]}</span>; }

function OrderCard({ order, now, busy, detail, advance, compact = false }: { order: Order; now: number; busy: boolean; detail: () => void; advance: () => void; compact?: boolean }) {
  const isActive = ["new", "preparing", "ready"].includes(order.status);
  const minutes = Math.ceil((order.dueAt - now) / 60000);
  const late = order.status !== "ready" && isActive && minutes < 0;
  const action = actions[order.status];
  return <article className={`order-card ${late ? "late-card" : ""} ${compact ? "compact" : ""}`}><div className="card-header"><span className={`source-chip ${order.channel === "meituan-import" ? "meituan" : ""}`}>{order.isDemo ? "演示" : order.channel === "meituan-import" ? "美团·导入" : "手工录单"}</span><StatusBadge status={order.status} /></div><div className="order-identification"><button onClick={detail}>#{order.number}</button><span>{order.deliveryType === "pickup" ? <ShoppingBag size={14} /> : <Bike size={15} />}{order.deliveryType === "pickup" ? "到店自取" : "配送"}</span></div><div className={`order-timing ${late ? "late" : ""}`}><Clock3 size={13} /><span>{late ? `出餐已超时 ${Math.abs(minutes)} 分钟` : order.status === "ready" ? `已出餐 · 等待交接` : isActive ? `预计 ${time(order.dueAt)} 出餐 · 约 ${Math.max(0, minutes)} 分钟` : `${time(order.updatedAt)} ${labels[order.status]}`}</span></div><div className="card-divider" /><div className="card-items">{order.items.map((item, i) => <div className="card-item" key={i}><div><strong>{item.name}</strong><small>{item.spec || "标准份"}</small></div><b>×{item.quantity}</b></div>)}</div><div className={`order-note ${!order.note ? "no-note" : ""}`}>{order.note ? <><AlertTriangle size={13} /><span>{order.note}</span></> : <><Check size={13} /><span>无特殊备注</span></>}</div><div className="card-bottom"><div><small>菜品合计</small><strong><span>¥</span>{money(order.amountCents)}</strong></div><span className="item-count">共 {order.items.reduce((s, i) => s + i.quantity, 0)} 件</span></div><div className="card-actions"><button className="button secondary" onClick={detail}>查看详情</button>{action ? <button className={`button ${order.status === "new" ? "primary" : order.status === "preparing" ? "prepare-action" : "ready-action"}`} disabled={busy} onClick={advance}>{busy ? <LoaderCircle size={15} className="spin" /> : order.status === "new" ? <Check size={15} /> : order.status === "preparing" ? <ChefHat size={15} /> : <CheckCheck size={15} />}{action.label}</button> : <span className="terminal-label"><CheckCheck size={15} />{labels[order.status]}</span>}</div></article>;
}

function Empty({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children?: React.ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{children}</div>; }

function NewOrder({ mode, api, prepMinutes, close, done }: { mode: Mode; api: (p: string, m?: string, b?: unknown) => Promise<any>; prepMinutes: number; close: () => void; done: () => Promise<void> }) {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [deliveryType, setDeliveryType] = useState("delivery");
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState(prepMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) close(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [busy, close]);
  function add(index: number) { const dish = catalog[index]; setItems(old => { const at = old.findIndex(i => i.name === dish.name && i.spec === dish.spec); return at < 0 ? old.length >= 40 ? old : [...old, { name: dish.name, spec: dish.spec, unitPriceCents: dish.price, quantity: 1 }] : old.map((i, k) => k === at ? { ...i, quantity: Math.min(99, i.quantity + 1) } : i); }); }
  function change(index: number, next: Partial<OrderItem>) { setItems(old => old.map((i, k) => k === index ? { ...i, ...next } : i)); }
  async function submit(e: React.FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try { const input = parseNewOrder({ channel: "manual", customerName: customerName.trim() || "顾客", deliveryType, note, items, prepMinutes: minutes }); await api("/api/orders", "POST", { mode, ...input }); await done(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <div className="overlay modal-overlay" onClick={() => !busy && close()}><form className="modal new-order-modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()} onSubmit={submit}><div className="modal-head"><div><small className="eyebrow">A FRESH ORDER</small><h2 id="new-title">新增{mode === "demo" ? "演示" : "营业"}订单</h2></div><button type="button" aria-label="关闭新建订单" className="icon-button" disabled={busy} onClick={close}><X size={22} /></button></div><div className="new-order-body"><div className="menu-picks"><div className="form-section-title"><h3>招牌好味 · 快捷添加</h3><span>示例菜单，可在右侧修改</span></div><div className="menu-grid">{catalog.map((dish, i) => <button type="button" className="menu-pick" key={i} onClick={() => add(i)}><span className={`dish-symbol ${dish.icon === "锅" ? "pot" : ""}`}>{dish.icon === "锅" ? <Flame size={22} /> : dish.icon === "饭" ? <UtensilsCrossed size={22} /> : <ShoppingBag size={21} />}</span><span><strong>{dish.name}</strong><small>{dish.spec}</small><b>¥{money(dish.price)} <em>{dish.tag}</em></b></span><Plus size={17} /></button>)}</div><p className="field-hint">价格仅为示例。请根据店内实际菜单修改名称、规格和单价。</p><div className="form-row"><label className="field">顾客称呼<input value={customerName} onChange={e => setCustomerName(e.target.value)} maxLength={40} placeholder="例如：张先生（可不填）" /></label><label className="field">取餐方式<select value={deliveryType} onChange={e => setDeliveryType(e.target.value)}><option value="delivery">配送订单</option><option value="pickup">到店自取</option></select></label></div><div className="form-row"><label className="field">预计制作时长（分钟）<input required type="number" min={3} max={120} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label></div><label className="field">忌口与订单备注<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="例如：鸡蛋全熟、少辣、酱汁分装" /></label></div><div className="order-basket"><h3>本单菜品 <span>{items.reduce((s, i) => s + i.quantity, 0)} 件</span></h3>{items.length ? items.map((item, index) => <div key={index} className="basket-item"><div className="basket-title"><input aria-label={`菜品${index + 1}名称`} required maxLength={100} value={item.name} onChange={e => change(index, { name: e.target.value })} /><button type="button" aria-label="移除菜品" onClick={() => setItems(old => old.filter((_, k) => k !== index))}><X size={15} /></button></div><input className="spec-input" aria-label={`菜品${index + 1}规格`} maxLength={100} value={item.spec} onChange={e => change(index, { spec: e.target.value })} /><div className="basket-price"><label>¥<input type="number" aria-label={`菜品${index + 1}单价（元）`} min={0} max={10000} step="0.01" required value={Number.isFinite(item.unitPriceCents) ? item.unitPriceCents / 100 : ""} onChange={e => change(index, { unitPriceCents: e.target.value === "" ? NaN : Math.round(Number(e.target.value) * 100) })} /></label><div className="quantity"><button type="button" aria-label="减少数量" disabled={item.quantity <= 1} onClick={() => change(index, { quantity: item.quantity - 1 })}><Minus size={12} /></button><b>{item.quantity}</b><button type="button" aria-label="增加数量" disabled={item.quantity >= 99} onClick={() => change(index, { quantity: item.quantity + 1 })}><Plus size={12} /></button></div></div></div>) : <div className="basket-empty"><ShoppingBag size={32} /><p>点击左侧菜品添加<br />部队锅也安排上。</p></div>}<button type="button" className="text-button add-custom" disabled={items.length >= 40} onClick={() => setItems(old => [...old, { name: "自定义菜品", spec: "标准份", unitPriceCents: 0, quantity: 1 }])}><Plus size={14} />添加自定义菜品</button><div className="basket-total"><span>菜品合计</span><b>¥{money(items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0))}</b></div></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><span className="muted">仅录入门店订单，不发起线上支付</span><button type="button" disabled={busy} className="button secondary" onClick={close}>取消</button><button className="button primary" type="submit" disabled={busy || !items.length}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}创建订单</button></div></form></div>;
}

function Reports({ orders, date, setDate, exportCsv, mode }: { orders: Order[]; date: string; setDate: (s: string) => void; exportCsv: () => void; mode: Mode }) {
  const completed = orders.filter(o => o.status === "handed_over");
  const total = completed.reduce((sum, o) => sum + o.amountCents, 0);
  const grouped = new Map<string, { quantity: number; amount: number }>();
  completed.forEach(o => o.items.forEach(i => { const old = grouped.get(i.name) || { quantity: 0, amount: 0 }; grouped.set(i.name, { quantity: old.quantity + i.quantity, amount: old.amount + i.quantity * i.unitPriceCents }); }));
  const dishes = [...grouped.entries()].sort((a, b) => b[1].quantity - a[1].quantity);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: orders.filter(o => new Date(o.createdAt + 28800000).getUTCHours() === hour).length }));
  const max = Math.max(1, ...hours.map(h => h.count));
  return <><div className="report-toolbar"><label className="date-control"><CalendarDays size={16} /><input aria-label="统计日期" type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)} /></label><button className="button secondary" onClick={exportCsv}><Download size={15} />导出当日订单</button></div><div className="report-kpis"><div className="report-kpi"><small>已交接菜品金额</small><strong><i>¥</i>{money(total)}</strong><p>{mode === "demo" ? "演示金额" : "非平台到账收入，不含佣金和配送费"}</p></div><div className="report-kpi"><small>当日订单总数</small><strong>{orders.length}<i>单</i></strong><p>含取消订单 {orders.filter(o => o.status === "cancelled").length} 单</p></div><div className="report-kpi"><small>已交接客单菜品金额</small><strong><i>¥</i>{money(completed.length ? Math.round(total / completed.length) : 0)}</strong><p>基于 {completed.length} 笔已交接订单</p></div></div><div className="report-grid"><section className="panel"><div className="panel-heading"><h2>订单时段分布</h2><span>按创建时间 · 上海时区</span></div><div className="hour-chart">{hours.map(h => <div className="hour-bar" key={h.hour} title={`${h.hour}:00 — ${h.count} 单`}><span>{h.count || ""}</span><i style={{ height: `${Math.max(2, h.count / max * 160)}px` }} /><small>{h.hour % 3 === 0 ? `${h.hour}时` : ""}</small></div>)}</div><p className="chart-note">包含当日所有状态的订单。</p></section><section className="panel"><div className="panel-heading"><h2>招牌菜品排行</h2><span>仅已交接订单</span></div>{dishes.length ? <div className="dish-ranking">{dishes.map(([name, value], index) => <div key={name}><span className={index < 3 ? "top-rank" : ""}>{String(index + 1).padStart(2, "0")}</span><div><strong>{name}</strong><small>¥{money(value.amount)}</small></div><b>{value.quantity}<small> 份</small></b></div>)}</div> : <Empty icon={<BarChart3 size={26} />} title="等第一份美味交接" description="订单交接后，会在这里形成菜品排行。" />}</section></div></>;
}

function Settings({ settings, api, mode, refresh, toast, exportJson }: { settings: AppSettings; api: (p: string, m?: string, b?: unknown) => Promise<any>; mode: Mode; refresh: () => Promise<void>; toast: (s: string) => void; exportJson: () => void }) {
  const [storeName, setStoreName] = useState(settings.storeName);
  const [minutes, setMinutes] = useState(settings.prepMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState("");
  const fileRef = useRef<HTMLInputElement>(null); const fileReadSequence = useRef(0);
  const example = { mode, orders: [{ externalId: "example-001", channel: "meituan-import", customerName: "示例顾客", deliveryType: "delivery", note: "演示用，请先在演示空间测试", items: [{ name: "招牌部队锅", spec: "单人锅 · 微辣", quantity: 1, unitPriceCents: 3290 }], prepMinutes: 15 }] };
  async function save(e: React.FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError(""); try { const settings = parseSettings({ storeName, prepMinutes: minutes }); await api("/api/settings", "PUT", settings); await refresh(); toast("门店设置已保存，新订单将采用新的制作时长"); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  async function importFile() { if (busy) return; setBusy(true); setError(""); try { const parsed = validateImport(JSON.parse(raw)); if (parsed.mode !== mode) throw new Error("文件标注的演示/营业空间与当前空间不一致，请切换到对应空间后重新选择文件"); const result = await api("/api/import", "POST", parsed); await refresh(); toast(`导入 ${result.imported} 单，跳过 ${result.duplicates} 笔重复订单`); setRaw(""); setFileName(""); if (fileRef.current) fileRef.current.value = ""; } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <div className="settings-grid"><form className="panel" onSubmit={save}><div className="panel-heading"><h2><Store size={18} />门店资料</h2><span>账号独立保存</span></div><label className="field">门店名称<input required maxLength={60} value={storeName} onChange={e => setStoreName(e.target.value)} /></label><label className="field">默认预计制作时长（分钟）<input required type="number" min={3} max={120} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /><small>用于新订单的超时提醒，不会修改已有订单的预计出餐时间。</small></label><button disabled={busy} className="button primary" type="submit"><Check size={16} />保存设置</button><div className="settings-tip"><ChefHat size={24} /><div><strong>部队锅需要多一点耐心？</strong><p>新增订单时，可为每单单独设置制作时长。</p></div></div></form><section className="panel integration-panel"><div className="panel-heading"><h2>平台接入</h2><span className="unconnected">未接入</span></div><div className="meituan-identity"><span>美团</span><div><h3>美团外卖</h3><p>真实订单自动同步尚未配置</p></div></div><p className="muted integration-description">当前支持演示、手工录单和规范 JSON 导入。自动接单、验签回调、状态回传，需在取得商户授权后按官方接口另行对接。</p><div className="integration-checks"><span><Check size={15} />门店内接单、制作、交接记录</span><span><Check size={15} />重复订单去重与操作日志</span><span><Clock3 size={15} />美团自动同步与平台状态回传待接入</span></div><p className="platform-footnote">平台取消与退款仍需在美团处理。这里不采集美团账号密码或密钥。</p></section><section className="panel import-panel"><div className="panel-heading"><h2><Upload size={18} />规范 JSON 导入</h2><span>每批最多 100 单 · 512 KB</span></div><p className="muted">这是本系统的标准格式，并非美团原生导出格式。先转换字段后导入；同一来源和外部订单号会自动去重，不覆盖已有状态。</p><div className="import-buttons"><button className="button secondary" onClick={() => download("订单导入格式示例.json", JSON.stringify(example, null, 2), "application/json")}><FileJson size={16} />下载格式示例</button><button className="text-button" onClick={exportJson}><Download size={16} />导出所选日期快照</button></div><label className="upload-zone"><Upload size={26} /><strong>{fileName || "选择已转换的 JSON 文件"}</strong><span>将导入到当前{mode === "demo" ? "演示" : "营业"}空间；新订单从“待接单”开始</span><input ref={fileRef} type="file" disabled={busy} accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; const sequence = ++fileReadSequence.current; setError(""); setRaw(""); setFileName(""); if (!file) return; if (file.size > 512 * 1024) { setError("文件超过 512 KB，请分批导入"); return; } try { const content = await file.text(); if (sequence !== fileReadSequence.current) return; setRaw(content); setFileName(file.name); } catch { if (sequence === fileReadSequence.current) setError("文件读取失败，请重新选择"); } }} /></label>{raw && <div className="import-confirm"><span>{fileName} → {mode === "demo" ? "演示空间" : "营业空间"}</span><button disabled={busy} className="button primary" onClick={importFile}>{busy ? "导入中…" : "确认导入"}<ArrowRight size={15} /></button></div>}<p className="field-hint">订单快照保留历史状态，用于查阅备份；不直接作为新订单导入文件。</p></section>{error && <div className="form-error" role="alert">{error}</div>}</div>;
}
