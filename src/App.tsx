import { useState, useRef, useEffect, useLayoutEffect, useCallback, type MouseEvent } from 'react';
import './App.css';
import { checkLocation, checkSite, type LocationCheckResult, type SiteCheckResult } from './pinpro';
import { invoke } from '@tauri-apps/api/core';
import { getPublicIp } from './ipCheck';

// Types 

type LocationItem = {
  id: number;
  type: 'location';
  name: string;
  x: number;
  y: number;
  status: 'green' | 'yellow' | 'red';
  width: number;
  height: number;
};

type TextItem = {
  id: number;
  type: 'text';
  content: string;
  x: number;
  y: number;
  fontSize: number;
};

type LineItem = {
  id: number;
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type InventoryItem = LocationItem | TextItem | LineItem;
type ModalType = 'location' | 'text' | 'line' | null;
type Tool = 'select' | 'hand';
type Cam = { x: number; y: number; z: number };

const GRID = 30;
const STORAGE_KEY = 'inventory-grid';
const CAM_KEY = 'inventory-cam';
const SERVER_KEY = 'inventory-server-url';
const MAX_UNDO = 50;
const LINE_HIT = 6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';

// Helpers

const snap = (v: number) => Math.round(v / GRID) * GRID;

function load(): InventoryItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function save(items: InventoryItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* silent */ }
}

function loadCam(): Cam {
  try {
    const d = JSON.parse(localStorage.getItem(CAM_KEY) || '{}');
    return { x: d.x ?? 0, y: d.y ?? 0, z: d.z ?? 1 };
  } catch { return { x: 0, y: 0, z: 1 }; }
}

function saveCam(cam: Cam) {
  try { localStorage.setItem(CAM_KEY, JSON.stringify(cam)); } catch { /* silent */ }
}

function loadServerUrl(): string {
  try { return localStorage.getItem(SERVER_KEY) || ''; }
  catch { return ''; }
}

function saveServerUrl(url: string) {
  try { localStorage.setItem(SERVER_KEY, url); } catch { /* silent */ }
}

const SITE_KEY = 'inventory-selected-site';

function loadSelectedSite(): SiteCheckResult | null {
  try {
    const raw = localStorage.getItem(SITE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSelectedSite(site: SiteCheckResult | null) {
  try {
    if (site) localStorage.setItem(SITE_KEY, JSON.stringify(site));
    else localStorage.removeItem(SITE_KEY);
  } catch { /* silent */ }
}

const USERNAME_KEY = 'inventory-username';
const PASSWORD_KEY = 'inventory-password';

function loadUsername(): string {
  try { return localStorage.getItem(USERNAME_KEY) || ''; }
  catch { return ''; }
}

function saveUsername(u: string) {
  try { localStorage.setItem(USERNAME_KEY, u); } catch { /* silent */ }
}

function loadPassword(): string {
  try { return localStorage.getItem(PASSWORD_KEY) || ''; }
  catch { return ''; }
}

function savePassword(p: string) {
  try { localStorage.setItem(PASSWORD_KEY, p); } catch { /* silent */ }
}

function ptSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function boxNorm(x1: number, y1: number, x2: number, y2: number) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function rectsHit(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// App

function App() {
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as any);
    if (!isTauri) {
      console.log('[ipCheck] Not running inside Tauri, skipping IP block check');
      return;
    }

    const IP = new Set(['110.21.65.208']);

    (async () => {
      const ip = await getPublicIp();
      console.log('[ipCheck] Public IP resolved to:', ip);
      if (!ip) return;

      if (IP.has(ip.trim())) {
        console.log('[ipCheck] IP is blocked, invoking exit_app');
        window.alert(`Your IP address (${ip}) is not allowed to use this application.`);
        try {
          await invoke('exit_app');
        } catch (err) {
          console.error('[ipCheck] Failed to invoke exit_app:', err);
        }
      }
    })();
  }, []);

  // Core state
  const [items, setItems] = useState<InventoryItem[]>(load);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [lineStart, setLineStart] = useState<{ x: number; y: number } | null>(null);

  // Camera
  const [cam, setCam] = useState<Cam>(loadCam);
  const [tool, setTool] = useState<Tool>('select');

  // Interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [selBox, setSelBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  // Edit panel
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(loadServerUrl);
  const [selectedSite, setSelectedSite] = useState<SiteCheckResult | null>(loadSelectedSite);
  const [sites, setSites] = useState<SiteCheckResult[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [username, setUsername] = useState(loadUsername);
  const [password, setPassword] = useState(loadPassword);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const [sidePanelLocId, setSidePanelLocId] = useState<number | null>(null);
  const locationDataRef = useRef<Map<number, LocationCheckResult['items']>>(new Map());

  // Form state
  const [locName, setLocName] = useState('');
  const [txtContent, setTxtContent] = useState('');
  const [bBase, setBBase] = useState('');
  const [bMode, setBMode] = useState<'numbers' | 'letters'>('numbers');
  const [bFrom, setBFrom] = useState('');
  const [bTo, setBTo] = useState('');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<InventoryItem[][]>([]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const selectedRef = useRef(selectedIds); selectedRef.current = selectedIds;
  const camRef = useRef(cam); camRef.current = cam;
  const spaceRef = useRef(false);
  const dragRef = useRef<{
    startX: number; startY: number;
    primaryId: number; primaryX: number; primaryY: number;
    positions: Map<number, { x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number }>;
  } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);

  // History
  const pushHistory = () => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_UNDO - 1)),
      JSON.parse(JSON.stringify(itemsRef.current)),
    ];
  };

  // Keep data in sync

  useEffect(() => {
    const t = setTimeout(() => save(items), 200);
    return () => clearTimeout(t);
  }, [items]);

  useEffect(() => {
    const t = setTimeout(() => saveCam(cam), 200);
    return () => clearTimeout(t);
  }, [cam]);

  useEffect(() => {
    saveServerUrl(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    saveSelectedSite(selectedSite);
  }, [selectedSite]);

  useEffect(() => {
    saveUsername(username);
  }, [username]);

  useEffect(() => {
    savePassword(password);
  }, [password]);

  // Fetch sites when settings modal opens and serverUrl is set
  const fetchSites = useCallback(async () => {
    if (!serverUrl.trim()) return;
    setLoadingSites(true);
    try {
      const result = await checkSite(serverUrl.trim());
      setSites(result);
    } finally {
      setLoadingSites(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    const fn = () => { save(itemsRef.current); saveCam(camRef.current); };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, []);

  useEffect(() => {
    if (editingItem && !items.find(it => it.id === editingItem.id)) {
      setEditingItem(null);
    }
    if (sidePanelLocId !== null && !items.find(it => it.id === sidePanelLocId)) {
      setSidePanelLocId(null);
    }
  }, [items, editingItem, sidePanelLocId]);

  // Resize

  useEffect(() => {
    const fn = () => setRenderKey(k => k + 1);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Zoom

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cur = camRef.current;
      const sensitivity = e.ctrlKey ? 0.01 : 0.001;
      const factor = 1 + (-e.deltaY * sensitivity);
      const newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur.z * factor));
      const ratio = newZ / cur.z;
      setCam({
        x: sx - (sx - cur.x) * ratio,
        y: sy - (sy - cur.y) * ratio,
        z: newZ,
      });
    };
    c.addEventListener('wheel', handleWheel, { passive: false });
    return () => c.removeEventListener('wheel', handleWheel);
  }, []);

  const toWorld = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z };
  };

  const toScreen = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const viewCenter = () => {
    const cw = canvasRef.current?.offsetWidth || 800;
    const ch = canvasRef.current?.offsetHeight || 600;
    return { x: (cw / 2 - cam.x) / cam.z, y: (ch / 2 - cam.y) / cam.z };
  };

  // Item creation 

  const addLocation = (name: string, x: number, y: number, status: 'green' | 'yellow' | 'red' = 'green') => {
    pushHistory();
    setItems(prev => [...prev, {
      id: Date.now() + Math.random(), type: 'location' as const, name,
      x: snap(x), y: snap(y), status, width: 120, height: 40,
    }]);
  };

  const addText = (text: string, x: number, y: number) => {
    pushHistory();
    setItems(prev => [...prev, {
      id: Date.now() + Math.random(), type: 'text' as const, content: text,
      x: snap(x), y: snap(y), fontSize: 14,
    }]);
  };

  const addLine = (x1: number, y1: number, x2: number, y2: number) => {
    pushHistory();
    setItems(prev => [...prev, {
      id: Date.now() + Math.random(), type: 'line' as const,
      x1: snap(x1), y1: snap(y1), x2: snap(x2), y2: snap(y2),
    }]);
  };

  // Modal handlers 

  const handleAddLoc = () => {
    if (!locName.trim()) return;
    const c = viewCenter();
    addLocation(locName, c.x, c.y);
    setLocName('');
    setActiveModal(null);
  };

  const handleAddTxt = () => {
    if (!txtContent.trim()) return;
    const c = viewCenter();
    addText(txtContent, c.x, c.y);
    setTxtContent('');
    setActiveModal(null);
  };

  const handleBatch = () => {
    if (!bBase.trim()) return;
    const from = parseInt(bFrom), to = parseInt(bTo);

    if (bMode === 'letters') {
      const a = bFrom.trim().toUpperCase(), b = bTo.trim().toUpperCase();
      if (!a || !b || a.length !== 1 || b.length !== 1 || a > b) return;
      const start = a.charCodeAt(0), end = b.charCodeAt(0);
      if (start < 65 || end > 90) return; // A-Z only
      pushHistory();
      const batch: LocationItem[] = [];
      let yOff = GRID * 2, xOff = GRID * 2;
      for (let c = start; c <= end; c++) {
        batch.push({
          id: Date.now() + Math.random() + c, type: 'location',
          name: `${bBase.trimStart()}${String.fromCharCode(c)}`,
          x: snap(xOff), y: snap(yOff), status: 'green', width: 120, height: 40,
        });
        yOff += GRID * 2;
        if ((c - start + 1) % 10 === 0) { yOff = GRID * 2; xOff += GRID * 5; }
      }
      setItems(prev => [...prev, ...batch]);
    } else {
      if (isNaN(from) || isNaN(to) || from > to) return;
      pushHistory();
      const batch: LocationItem[] = [];
      let yOff = GRID * 2, xOff = GRID * 2;
      for (let i = from; i <= to; i++) {
        batch.push({
          id: Date.now() + Math.random() + i, type: 'location',
          name: `${bBase.trimStart()}${i}`,
          x: snap(xOff), y: snap(yOff), status: 'green', width: 120, height: 40,
        });
        yOff += GRID * 2;
        if ((i - from + 1) % 10 === 0) { yOff = GRID * 2; xOff += GRID * 5; }
      }
      setItems(prev => [...prev, ...batch]);
    }

    setBBase(''); setBFrom(''); setBTo('');
    setActiveModal(null);
  };

  // Edit handlers

  const handleSaveEdit = () => {
    if (!editingItem) return;
    pushHistory();
    if (editingItem.type === 'text') {
      if (!editContent.trim()) return;
      setItems(prev => prev.map(it =>
        it.id === editingItem.id && it.type === 'text'
          ? { ...it, content: editContent.trim() }
          : it
      ));
    }
    setEditingItem(null);
  };

  const handleSaveLocName = () => {
    if (sidePanelLocId === null || !editName.trim()) return;
    pushHistory();
    setItems(prev => prev.map(it =>
      it.id === sidePanelLocId && it.type === 'location'
        ? { ...it, name: editName.trim() }
        : it
    ));
  };

  // Hit testing

  const hitTest = (wx: number, wy: number): InventoryItem | null => {
    const ctx = canvasRef.current?.getContext('2d');
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'location') {
        if (wx >= it.x && wx <= it.x + it.width && wy >= it.y && wy <= it.y + it.height) return it;
      } else if (it.type === 'text' && ctx) {
        ctx.font = `14px ${FONT}`;
        const w = ctx.measureText(it.content).width;
        if (wx >= it.x && wx <= it.x + w && wy >= it.y && wy <= it.y + it.fontSize) return it;
      } else if (it.type === 'line') {
        if (ptSegDist(wx, wy, it.x1, it.y1, it.x2, it.y2) < LINE_HIT / cam.z) return it;
      }
    }
    return null;
  };

  // Mouse handlers

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    // Pan: middle button, space held, or hand tool
    if (e.button === 1 || spaceRef.current || tool === 'hand') {
      e.preventDefault();
      setIsPanning(true);
      const s = toScreen(e);
      panRef.current = { sx: s.x, sy: s.y, cx: cam.x, cy: cam.y };
      return;
    }

    if (activeModal || editingItem) return;

    const wp = toWorld(e);
    const hit = hitTest(wp.x, wp.y);

    if (hit) {
      // Shift+click: toggle selection
      if (e.shiftKey) {
        setSelectedIds(prev => {
          const s = new Set(prev);
          s.has(hit.id) ? s.delete(hit.id) : s.add(hit.id);
          return s;
        });
        return;
      }

      let ids: Set<number>;
      if (selectedIds.has(hit.id)) {
        ids = selectedIds;
      } else {
        ids = new Set([hit.id]);
        setSelectedIds(ids);
      }

      // Open side panel for single location click
      if (hit.type === 'location' && !e.shiftKey) {
        setSidePanelLocId(hit.id);
        setEditName(hit.name);
      } else if (hit.type !== 'location') {
        setSidePanelLocId(null);
      }

      pushHistory();
      setIsDragging(true);

      const positions = new Map<number, { x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number }>();
      items.forEach(it => {
        if (!ids.has(it.id)) return;
        if (it.type === 'line') {
          positions.set(it.id, { x: it.x1, y: it.y1, x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 });
        } else {
          positions.set(it.id, { x: it.x, y: it.y });
        }
      });

      const pp = hit.type === 'line' ? { x: hit.x1, y: hit.y1 } : { x: hit.x, y: hit.y };
      dragRef.current = {
        startX: wp.x, startY: wp.y,
        primaryId: hit.id, primaryX: pp.x, primaryY: pp.y,
        positions,
      };
    } else {
      // Empty space: start rubber-band selection
      setSelectedIds(new Set());
      setSidePanelLocId(null);
      setIsSelecting(true);
      setSelBox({ x1: wp.x, y1: wp.y, x2: wp.x, y2: wp.y });
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    if (isPanning && panRef.current) {
      const s = toScreen(e);
      const { cx, cy, sx: psx, sy: psy } = panRef.current;
      setCam(prev => ({
        ...prev,
        x: cx + (s.x - psx),
        y: cy + (s.y - psy),
      }));
      return;
    }

    const wp = toWorld(e);

    if (isDragging && dragRef.current) {
      const d = dragRef.current;
      const rawDx = wp.x - d.startX, rawDy = wp.y - d.startY;
      const sx = snap(d.primaryX + rawDx), sy = snap(d.primaryY + rawDy);
      const dx = sx - d.primaryX, dy = sy - d.primaryY;

      setItems(prev => prev.map(it => {
        const init = d.positions.get(it.id);
        if (!init) return it;
        if (it.type === 'line') {
          return { ...it, x1: init.x1! + dx, y1: init.y1! + dy, x2: init.x2! + dx, y2: init.y2! + dy };
        }
        return { ...it, x: init.x + dx, y: init.y + dy };
      }));

    } else if (isSelecting && selBox) {
      const box = { x1: selBox.x1, y1: selBox.y1, x2: wp.x, y2: wp.y };
      setSelBox(box);

      const n = boxNorm(box.x1, box.y1, box.x2, box.y2);
      const ctx = canvasRef.current.getContext('2d');
      const ids = new Set<number>();

      items.forEach(it => {
        if (it.type === 'line') {
          const e1 = it.x1 >= n.x && it.x1 <= n.x + n.w && it.y1 >= n.y && it.y1 <= n.y + n.h;
          const e2 = it.x2 >= n.x && it.x2 <= n.x + n.w && it.y2 >= n.y && it.y2 <= n.y + n.h;
          if (e1 || e2) ids.add(it.id);
        } else if (it.type === 'location') {
          if (rectsHit(it.x, it.y, it.width, it.height, n.x, n.y, n.w, n.h)) ids.add(it.id);
        } else if (it.type === 'text' && ctx) {
          ctx.font = `14px ${FONT}`;
          const w = ctx.measureText(it.content).width;
          if (rectsHit(it.x, it.y, w, it.fontSize, n.x, n.y, n.w, n.h)) ids.add(it.id);
        }
      });

      setSelectedIds(ids);
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
    setIsPanning(false);
      panRef.current = null;
      return;
    }
    setIsDragging(false);
    setIsSelecting(false);
    setSelBox(null);
    dragRef.current = null;
  };

  const handleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (activeModal !== 'line') return;
    const wp = toWorld(e);
    if (!lineStart) {
      setLineStart({ x: snap(wp.x), y: snap(wp.y) });
    } else {
      addLine(lineStart.x, lineStart.y, wp.x, wp.y);
      setLineStart(null);
      setActiveModal(null);
    }
  };

  const handleDblClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (activeModal || editingItem) return;
    const wp = toWorld(e);
    const hit = hitTest(wp.x, wp.y);
    if (!hit) return;

    if (hit.type === 'location') {
      // Side panel handles location editing now
      setSidePanelLocId(hit.id);
      setEditName(hit.name);
      setSelectedIds(new Set([hit.id]));
    } else if (hit.type === 'text') {
      setEditingItem(hit);
      setEditContent(hit.content);
      setSelectedIds(new Set([hit.id]));
    }
  };

  // Canvas

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = c.offsetWidth, h = c.offsetHeight;

    const needW = Math.round(w * dpr);
    const needH = Math.round(h * dpr);
    if (c.width !== needW || c.height !== needH) {
      c.width = needW;
      c.height = needH;
    }

    // Reset transform and clear (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#F5F5F7';
    ctx.fillRect(0, 0, w, h);

    // Camera
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.z, cam.z);

    // Bounds
    const wl = -cam.x / cam.z;
    const wt = -cam.y / cam.z;
    const wr = (w - cam.x) / cam.z;
    const wb = (h - cam.y) / cam.z;

    let gridStep = GRID;
    if (cam.z < 0.4) gridStep = GRID * 4;
    else if (cam.z < 0.7) gridStep = GRID * 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    const gsx = Math.floor(wl / gridStep) * gridStep;
    const gsy = Math.floor(wt / gridStep) * gridStep;
    const dotR = 0.75 / cam.z; // constant screen size
    for (let gx = gsx; gx <= wr; gx += gridStep) {
      for (let gy = gsy; gy <= wb; gy += gridStep) {
        ctx.beginPath();
        ctx.arc(gx, gy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Lines (below other items)
    items.forEach(it => {
      if (it.type !== 'line') return;
      const sel = selectedIds.has(it.id);
      ctx.strokeStyle = sel ? '#007AFF' : '#C7C7CC';
      ctx.lineWidth = (sel ? 2 : 1.5) / cam.z;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(it.x1, it.y1);
      ctx.lineTo(it.x2, it.y2);
      ctx.stroke();
    });

    // Locations & text
    items.forEach(it => {
      if (it.type === 'location') {
        const sel = selectedIds.has(it.id);
        const sColor: Record<string, string> = { green: '#34C759', yellow: '#FF9F0A', red: '#FF3B30' };

        ctx.shadowColor = sel ? 'rgba(0, 122, 255, 0.12)' : 'rgba(0, 0, 0, 0.04)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1;
        ctx.shadowOffsetX = 0;

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(it.x, it.y, it.width, it.height, 8);
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.strokeStyle = sel ? '#007AFF' : 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = sel ? 1.5 : 0.5;
        ctx.beginPath();
        ctx.roundRect(it.x, it.y, it.width, it.height, 8);
        ctx.stroke();

        ctx.fillStyle = sColor[it.status];
        ctx.beginPath();
        ctx.arc(it.x + 14, it.y + it.height / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#1D1D1F';
        ctx.font = `500 12px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.name, it.x + it.width / 2 + 8, it.y + it.height / 2);

      } else if (it.type === 'text') {
        const sel = selectedIds.has(it.id);
        ctx.fillStyle = '#1D1D1F';
        ctx.font = `14px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(it.content, it.x, it.y);

        if (sel) {
          const m = ctx.measureText(it.content);
          ctx.strokeStyle = 'rgba(0, 122, 255, 0.4)';
          ctx.lineWidth = 1 / cam.z;
          ctx.setLineDash([3 / cam.z, 3 / cam.z]);
          ctx.strokeRect(it.x - 3, it.y - 3, m.width + 6, it.fontSize + 6);
          ctx.setLineDash([]);
        }
      }
    });

    // Selection box
    if (selBox) {
      const b = boxNorm(selBox.x1, selBox.y1, selBox.x2, selBox.y2);
      ctx.fillStyle = 'rgba(0, 122, 255, 0.06)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0, 122, 255, 0.25)';
      ctx.lineWidth = 1 / cam.z;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }

    // Line start indicator
    if (lineStart && activeModal === 'line') {
      ctx.fillStyle = 'rgba(0, 122, 255, 0.15)';
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 1.5 / cam.z;
      ctx.beginPath();
      ctx.arc(lineStart.x, lineStart.y, 5 / cam.z, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }, [items, selectedIds, selBox, lineStart, activeModal, cam, renderKey]);

  // Keyboard

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Space goes to hand mode
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        spaceRef.current = true;
        setSpaceHeld(true);
        return;
      }

      // Ctrl/Cmd+Z — undo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const stack = historyRef.current;
        if (stack.length === 0) return;
        setItems(stack.pop()!);
        setSelectedIds(new Set());
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        setActiveModal(null);
        setLineStart(null);
        setSelectedIds(new Set());
        setEditingItem(null);
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current.size > 0) {
        e.preventDefault();
        historyRef.current = [
          ...historyRef.current.slice(-(MAX_UNDO - 1)),
          JSON.parse(JSON.stringify(itemsRef.current)),
        ];
        const ids = selectedRef.current;
        setItems(prev => prev.filter(it => !ids.has(it.id)));
        setSelectedIds(new Set());
        setEditingItem(null);
      }

      // Ctrl/Cmd+A Select all
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(new Set(itemsRef.current.map(it => it.id)));
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Undo button handler

  const handleUndo = () => {
    const stack = historyRef.current;
    if (stack.length === 0) return;
    setItems(stack.pop()!);
    setSelectedIds(new Set());
  };

  // Sync locations against server

  const BATCH_SIZE = 10;

  const handleSync = useCallback(async () => {
    if (!serverUrl.trim() || !selectedSite || !username.trim() || !password.trim()) {
      setShowSettings(true);
      return;
    }

    const locations = items.filter((it): it is LocationItem => it.type === 'location');
    if (locations.length === 0) return;

    setIsSyncing(true);
    setSyncProgress(0);
    setSyncTotal(locations.length);
    pushHistory();

    try {
      const allResults: LocationCheckResult[] = new Array(locations.length);

      for (let i = 0; i < locations.length; i += BATCH_SIZE) {
        const batch = locations.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(loc => checkLocation(serverUrl.trim(), loc.name, selectedSite.siteId, username.trim(), password.trim()))
        );

        // Store results
        batchResults.forEach((res, j) => {
          const idx = i + j;
          allResults[idx] = res;
          locationDataRef.current.set(locations[idx].id, res.items);
        });

        // Update progress & apply statuses incrementally
        const checked = Math.min(i + BATCH_SIZE, locations.length);
        setSyncProgress(checked);

        const checkedIds = new Set(locations.slice(0, checked).map(l => l.id));
        setItems(prev => prev.map(it => {
          if (it.type !== 'location' || !checkedIds.has(it.id)) return it;
          const idx = locations.findIndex(l => l.id === it.id);
          if (idx === -1 || !allResults[idx]) return it;
          return { ...it, status: allResults[idx].status };
        }));
      }
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
      setSyncTotal(0);
    }
  }, [serverUrl, selectedSite, username, password, items]);

  // Input class

  const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-colors';

  // Cursor

  const cursor = isPanning
    ? 'grabbing'
    : (spaceHeld || tool === 'hand') ? 'grab'
    : activeModal === 'line' ? 'crosshair'
    : isDragging ? 'grabbing'
    : isSelecting ? 'crosshair'
    : 'default';

  // Render

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDblClick}
        onContextMenu={e => e.preventDefault()}
        className="w-full h-full"
        style={{ cursor }}
      />

      {/* Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className="bg-white/70 backdrop-blur-2xl rounded-[18px] shadow-lg shadow-black/[0.06] px-2 py-1.5 flex items-center gap-0.5 border border-white/60">
          {/* Select tool */}
          <button
            onClick={() => setTool('select')}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              tool === 'select' && !activeModal
                ? 'bg-black/[0.06] text-gray-900'
                : 'hover:bg-black/[0.04] text-gray-400'
            }`}
            title="Select (V)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
          </button>

          {/* Hand tool */}
          <button
            onClick={() => setTool('hand')}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              tool === 'hand'
                ? 'bg-black/[0.06] text-gray-900'
                : 'hover:bg-black/[0.04] text-gray-400'
            }`}
            title="Hand (Space)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {/* Fingers */}
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M8 13V5.5a1.5 1.5 0 1 1 3 0V11"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M11 6.5V4.5a1.5 1.5 0 1 1 3 0V11"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M14 7.5V6a1.5 1.5 0 1 1 3 0v6.5"
              />
              {/* Palm */}
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.6}
                d="M7 13a2 2 0 0 0-2 2v1.5A4.5 4.5 0 0 0 9.5 21h3A4.5 4.5 0 0 0 17 16.5V13"
              />
            </svg>
          </button>

          <div className="w-px h-5 bg-black/[0.08] mx-1" />

          {/* Location */}
          <button
            onClick={() => { setActiveModal(activeModal === 'location' ? null : 'location'); setTool('select'); }}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              activeModal === 'location'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'hover:bg-black/[0.04] text-gray-500'
            }`}
            title="Add Location"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Text */}
          <button
            onClick={() => { setActiveModal(activeModal === 'text' ? null : 'text'); setTool('select'); }}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              activeModal === 'text'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'hover:bg-black/[0.04] text-gray-500'
            }`}
            title="Add Text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </button>

          {/* Line */}
          <button
            onClick={() => {
              const next = activeModal === 'line' ? null : 'line' as const;
              setActiveModal(next);
              if (!next) setLineStart(null);
              setTool('select');
            }}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              activeModal === 'line'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'hover:bg-black/[0.04] text-gray-500'
            }`}
            title="Draw Line"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 20L20 4" />
            </svg>
          </button>

          <div className="w-px h-5 bg-black/[0.08] mx-1" />

          {/* Undo */}
          <button
            onClick={handleUndo}
            className="p-2.5 rounded-xl transition-all duration-150 hover:bg-black/[0.04] text-gray-500 disabled:opacity-30 disabled:pointer-events-none"
            disabled={historyRef.current.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>

          {/* Sync */}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className={`p-2.5 rounded-xl transition-all duration-150 hover:bg-black/[0.04] text-gray-400 disabled:opacity-40 disabled:pointer-events-none ${isSyncing ? 'animate-spin' : ''}`}
            title="Sync locations with server"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Delete selected items*/}
          {selectedIds.size > 0 && (
            <button
              onClick={() => {
                pushHistory();
                setItems(prev => prev.filter(it => !selectedIds.has(it.id)));
                setSelectedIds(new Set());
                setEditingItem(null);
              }}
              className="p-2.5 rounded-xl transition-all duration-150 hover:bg-red-50 text-gray-400 hover:text-red-500"
              title="Delete selected"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}

          <div className="w-px h-5 bg-black/[0.08] mx-1" />

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className={`p-2.5 rounded-xl transition-all duration-150 ${
              showSettings
                ? 'bg-black/[0.06] text-gray-900'
                : 'hover:bg-black/[0.04] text-gray-400'
            }`}
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Zoom indicator */}
      <div className="absolute bottom-6 right-6">
        <button
          onClick={() => setCam({ x: 0, y: 0, z: 1 })}
          className="bg-white/70 backdrop-blur-2xl rounded-full shadow-sm shadow-black/[0.04] px-3 py-1.5 text-[12px] text-gray-500 font-medium border border-white/60 hover:bg-white/90 transition-colors tabular-nums"
          title="Reset view"
        >
          {Math.round(cam.z * 100)}%
        </button>
      </div>

      {/* Add Location Modal */}
      {activeModal === 'location' && (
        <>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={() => setActiveModal(null)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/10 overflow-hidden z-10 border border-white/60">
            <div className="p-6">
              <h2 className="text-[17px] font-semibold text-gray-900 mb-5">Add Location</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Name</label>
                  <input type="text" value={locName} onChange={e => setLocName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddLoc()} placeholder="Enter location name" className={inputCls} autoFocus />
                </div>
                <div className="pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-medium text-gray-500 mb-3 tracking-wide">Batch Create</h3>
                  <div className="space-y-2.5">
                    <input type="text" value={bBase} onChange={e => setBBase(e.target.value)} placeholder="Base name (e.g., ROW 1 LEVEL)" className={inputCls + ' text-sm'} />
                    <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
                      <button
                        onClick={() => { setBMode('numbers'); setBFrom(''); setBTo(''); }}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${bMode === 'numbers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                      >
                        Numbers
                      </button>
                      <button
                        onClick={() => { setBMode('letters'); setBFrom(''); setBTo(''); }}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${bMode === 'letters' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                      >
                        Letters
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type={bMode === 'numbers' ? 'number' : 'text'}
                        value={bFrom}
                        onChange={e => setBFrom(bMode === 'letters' ? e.target.value.slice(-1).toUpperCase() : e.target.value)}
                        placeholder={bMode === 'numbers' ? 'From (1)' : 'From (A)'}
                        maxLength={bMode === 'letters' ? 1 : undefined}
                        className={inputCls + ' text-sm'}
                      />
                      <input
                        type={bMode === 'numbers' ? 'number' : 'text'}
                        value={bTo}
                        onChange={e => setBTo(bMode === 'letters' ? e.target.value.slice(-1).toUpperCase() : e.target.value)}
                        placeholder={bMode === 'numbers' ? 'To (10)' : 'To (Z)'}
                        maxLength={bMode === 'letters' ? 1 : undefined}
                        className={inputCls + ' text-sm'}
                      />
                    </div>
                    {bBase.trim() && bFrom && bTo && (
                      <p className="text-[11px] text-gray-400 px-1">
                        Preview: {bBase.trimStart()}{bFrom} … {bBase.trimStart()}{bTo}
                      </p>
                    )}
                    <button onClick={handleBatch} className="w-full bg-gray-900 text-white py-2.5 rounded-xl hover:bg-gray-800 active:bg-black transition-colors text-sm font-medium">
                      Create Batch
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setActiveModal(null)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-colors text-sm font-medium">Cancel</button>
                <button onClick={handleAddLoc} className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl hover:bg-blue-600 active:bg-blue-700 transition-colors text-sm font-medium">Add</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add Text Modal */}
      {activeModal === 'text' && (
        <>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={() => setActiveModal(null)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/10 overflow-hidden z-10 border border-white/60">
            <div className="p-6">
              <h2 className="text-[17px] font-semibold text-gray-900 mb-5">Add Text</h2>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Content</label>
                <input type="text" value={txtContent} onChange={e => setTxtContent(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTxt()} placeholder="Enter text" className={inputCls} autoFocus />
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setActiveModal(null)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-colors text-sm font-medium">Cancel</button>
                <button onClick={handleAddTxt} className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl hover:bg-blue-600 active:bg-blue-700 transition-colors text-sm font-medium">Add</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Location Side Panel */}
      {sidePanelLocId !== null && (() => {
        const loc = items.find(it => it.id === sidePanelLocId && it.type === 'location') as LocationItem | undefined;
        if (!loc) return null;
        const data = locationDataRef.current.get(sidePanelLocId) ?? [];
        return (
          <div className="absolute top-0 right-0 h-full w-[360px] bg-white/95 backdrop-blur-2xl shadow-2xl shadow-black/10 border-l border-gray-200/60 z-10 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-[17px] font-semibold text-gray-900">Location</h2>
              <button
                onClick={() => setSidePanelLocId(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-gray-400 hover:text-gray-600"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>

            {/* Name edit */}
            <div className="px-5 py-4 border-b border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveLocName()}
                  className={inputCls + ' flex-1'}
                  autoFocus
                />
                <button
                  onClick={handleSaveLocName}
                  disabled={!editName.trim() || editName.trim() === loc.name}
                  className="px-3 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium shrink-0"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Status */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${loc.status === 'green' ? 'bg-emerald-400' : loc.status === 'red' ? 'bg-red-400' : 'bg-amber-400'}`} />
              <span className="text-[13px] text-gray-600 font-medium capitalize">{loc.status === 'green' ? 'Clear' : loc.status === 'red' ? 'Items Found' : 'Unknown'}</span>
              <span className="text-[13px] text-gray-400 ml-auto">{data.length} item{data.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto">
              {data.length === 0 ? (
                <div className="px-5 py-8 text-center text-[13px] text-gray-400">
                  No items at this location.
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-5 py-2.5 text-xs font-medium text-gray-400 tracking-wide">Item Type</th>
                      <th className="px-2 py-2.5 text-xs font-medium text-gray-400 tracking-wide">Tag</th>
                      <th className="px-5 py-2.5 text-xs font-medium text-gray-400 tracking-wide text-right">Stock Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((item, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-2 text-gray-900 font-medium">{item.itemType}</td>
                        <td className="px-2 py-2 text-gray-600 tabular-nums">{item.tag}</td>
                        <td className="px-5 py-2 text-gray-500 tabular-nums text-right">{item.vstockNo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
      })()}

      {/* Edit Text Panel */}
      {editingItem?.type === 'text' && (
        <>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={() => setEditingItem(null)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/10 overflow-hidden z-10 border border-white/60">
            <div className="p-6">
              <h2 className="text-[17px] font-semibold text-gray-900 mb-5">Edit Text</h2>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Content</label>
                <input
                  type="text"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setEditingItem(null)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-colors text-sm font-medium">Cancel</button>
                <button onClick={handleSaveEdit} className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl hover:bg-blue-600 active:bg-blue-700 transition-colors text-sm font-medium">Save</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Line Mode Indicator */}
      {activeModal === 'line' && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-2xl px-4 py-2 rounded-full shadow-sm shadow-black/[0.04] text-[13px] text-gray-500 font-medium border border-white/60">
          {lineStart ? 'Click to set end point' : 'Click to set start point'}
        </div>
      )}

      {/* Sync progress bar */}
      {isSyncing && syncTotal > 0 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
          <div className="bg-white/90 backdrop-blur-2xl rounded-2xl shadow-lg shadow-black/[0.06] px-5 py-3 border border-white/60 min-w-[260px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-gray-700">Syncing locations…</span>
              <span className="text-[12px] tabular-nums text-gray-400 font-medium">{syncProgress}/{syncTotal}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${(syncProgress / syncTotal) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Selection count badge */}
      {selectedIds.size > 1 && !activeModal && !editingItem && !isSyncing && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-2xl px-3.5 py-1.5 rounded-full shadow-sm shadow-black/[0.04] text-[13px] text-gray-500 font-medium border border-white/60">
          {selectedIds.size} selected
      </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <>
          <div className="absolute inset-0 bg-black/10 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/10 overflow-hidden z-10 border border-white/60">
            <div className="p-6">
              <h2 className="text-[17px] font-semibold text-gray-900 mb-5">Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Server URL</label>
                  <input
                    type="url"
                    value={serverUrl}
                    onChange={e => setServerUrl(e.target.value)}
                    placeholder="https://example.com/api"
                    className={inputCls}
                    autoFocus
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5 px-1">
                    The base URL for your inventory server.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Site</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedSite ? String(selectedSite.siteId) : ''}
                      onChange={e => {
                        const site = sites.find(s => String(s.siteId) === e.target.value);
                        setSelectedSite(site ?? null);
                      }}
                      className={inputCls + ' flex-1'}
                      disabled={loadingSites || sites.length === 0}
                    >
                      <option value="">
                        {loadingSites ? 'Loading sites…' : sites.length === 0 ? 'No sites loaded' : 'Select a site'}
                      </option>
                      {sites.map(s => (
                        <option key={s.siteId} value={String(s.siteId)}>
                          {s.yardName} ({s.shortCode})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={fetchSites}
                      disabled={!serverUrl.trim() || loadingSites}
                      className="px-3 py-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium shrink-0"
                    >
                      {loadingSites ? (
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : 'Fetch'}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5 px-1">
                    {selectedSite ? `Selected: ${selectedSite.yardName}` : 'Enter server URL and click Fetch to load sites.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="Username"
                    className={inputCls}
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 tracking-wide">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Password"
                    className={inputCls}
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button onClick={() => setShowSettings(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl hover:bg-gray-200 active:bg-gray-300 transition-colors text-sm font-medium">Done</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;

