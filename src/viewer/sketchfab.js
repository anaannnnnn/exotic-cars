/** Clear-coat amount for a given paint roughness: glossy paints get a thick coat, matte ones none. */
const clearcoatFor = (roughness) => Math.min(1, Math.max(0, 1 - (roughness - 0.3) / 0.5));

/*
 * Sketchfab Viewer API (v1.12.1) wrapper: real, licensed 3D cars.
 * The API can recolour materials and move the camera but cannot add geometry, so paint, rims, calipers
 * and glass are live; wheels and body kits are chosen from the supplier catalogue.
 */
const VERSION = '1.12.1';

const RX = {
  paint: /paint|carpaint|car[_\s-]?body|body|exterior|lacquer|coat|shell|hood|door|fender|bumper/i,
  paintNo: /glass|window|tire|tyre|wheel|rim|interior|light|lamp|chrome|plastic|rubber|brake|caliper|seat|logo|plate|badge|grill|mirror|carbon|leather|under|black|trim/i,
  rim: /rim|wheel|alloy|hub|spoke/i,
  rimNo: /tire|tyre|rubber|brake|caliper|disc|disk|bolt/i,
  caliper: /caliper/i,
  glass: /glass|window|windshield|windscreen/i,
  glassNo: /light|lamp/i
};
const toLinear = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
};
const colorChannel = (ch) => ch.AlbedoPBR || ch.DiffuseColor || ch.DiffusePBR || null;

function paintChannels(ch, hex, roughness, metalness) {
  const c = colorChannel(ch);
  if (c) { c.enable = true; c.color = toLinear(hex); if ('factor' in c) c.factor = 1; delete c.texture; }
  ch.RoughnessPBR = ch.RoughnessPBR || {};
  Object.assign(ch.RoughnessPBR, { enable: true, factor: roughness });
  delete ch.RoughnessPBR.texture;
  ch.MetalnessPBR = ch.MetalnessPBR || {};
  Object.assign(ch.MetalnessPBR, { enable: true, factor: metalness });
  delete ch.MetalnessPBR.texture;
  if (ch.ClearCoat) Object.assign(ch.ClearCoat, { enable: true, factor: clearcoatFor(roughness) });
}

export class Viewer {
  constructor(host) {
    this.host = host;
    this.iframe = null;
    this.api = null;
    this.token = 0;
    this.reset();
  }

  reset() {
    this.materials = [];
    this.originals = {};
    this.roles = { paint: {}, rim: {}, caliper: {}, glass: {} };
    this.touched = {};
    this.baseCam = null;
    this.paintSource = null;
    this.axes = null;
    this.nodeMap = null;
    this.fov = 0;
    this.desired = null;
    this.dirty = false;
  }

  /** A photo (the albedo texture) or a flat colour that shows what a material looks like. */
  #preview(mat) {
    const c = colorChannel(mat.channels || {});
    let image = null;
    const imgs = c && c.texture && c.texture.images;
    if (imgs && imgs.length) {
      const sorted = [...imgs].sort((a, b) => a.width - b.width);
      image = (sorted.find((i) => i.width >= 128) || sorted[sorted.length - 1]).url;
    }
    let color = null;
    if (c && c.color) color = `rgb(${c.color.slice(0, 3).map((v) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2))).join(',')})`;
    return { image, color };
  }

  /** Flash a material on the model so the user can see which part a tile refers to. */
  highlight(id) { try { this.api?.highlightMaterial(id, () => {}); } catch { /* older viewer builds */ } }

  capabilities() {
    const n = (o) => Object.keys(o).length;
    return {
      paint: n(this.roles.paint), rim: n(this.roles.rim), caliper: n(this.roles.caliper), glass: n(this.roles.glass),
      materials: this.materials.map((m) => ({ id: m.id, name: m.name || 'Material', ...this.#preview(m) })),
      paintTargets: Object.keys(this.roles.paint)
    };
  }

  #classify(mat) {
    const n = mat.name || '';
    if (RX.caliper.test(n)) this.roles.caliper[mat.id] = true;
    else if (RX.rim.test(n) && !RX.rimNo.test(n)) this.roles.rim[mat.id] = true;
    else if (RX.glass.test(n) && !RX.glassNo.test(n)) this.roles.glass[mat.id] = true;
    else if (RX.paint.test(n) && !RX.paintNo.test(n)) { this.roles.paint[mat.id] = true; this.paintSource = 'name'; }
  }

  /** When no material is named like body paint, pick the most saturated coloured material (works for non-grey cars). */
  #guessPaint() {
    if (Object.keys(this.roles.paint).length) return;
    let best = null, bestSat = 0.28;
    for (const m of this.materials) {
      if (this.roles.rim[m.id] || this.roles.caliper[m.id] || this.roles.glass[m.id]) continue;
      if (RX.paintNo.test(m.name || '')) continue;
      const c = colorChannel(m.channels || {});
      const col = c && c.enable !== false && c.color;
      if (!col) continue;
      const mx = Math.max(...col), mn = Math.min(...col);
      const sat = mx > 0.02 ? (mx - mn) / mx : 0;
      if (sat > bestSat) { bestSat = sat; best = m; }
    }
    if (best) { this.roles.paint[best.id] = true; this.paintSource = 'colour'; }
  }

  /** Last resort when no material is named or coloured like paint: the busiest material that is not glass, rims or trim. */
  #guessPaintByUse() {
    if (Object.keys(this.roles.paint).length || !this.nodeMap) return;
    const skip = /glass|window|tire|tyre|interior|light|lamp|plate|logo|badge|chrome|rubber|seat|leather|brake|caliper|wheel|rim|grill|mirror|black|trim|carbon|under/i;
    const uses = {};
    for (const n of Object.values(this.nodeMap)) if ((n.type === 'Geometry' || n.type === 'RigGeometry') && n.materialID) uses[n.materialID] = (uses[n.materialID] || 0) + 1;
    let best = null, bestN = 0;
    for (const m of this.materials) {
      if (this.roles.rim[m.id] || this.roles.caliper[m.id] || this.roles.glass[m.id] || skip.test(m.name || '')) continue;
      const n = uses[m.id] || 0;
      if (n > bestN) { bestN = n; best = m; }
    }
    if (best) { this.roles.paint[best.id] = true; this.paintSource = 'use'; }
  }

  /**
   * Asks the viewer which material sits under a handful of points on the car's flank (call this once the side view has
   * settled). The material seen most is the body paint - unless the material was already found by its name.
   * Resolves true when the paint target changed.
   */
  async probePaint() {
    if (!this.api || this.paintSource === 'name') return false;
    const w = this.iframe?.clientWidth || 0, h = this.iframe?.clientHeight || 0;
    if (!w || !h) return false;
    const pick = (x, y) => new Promise((ok) => {
      const t = setTimeout(() => ok(null), 1500);
      try { this.api.pickFromScreen([Math.round(x), Math.round(y)], (e, r) => { clearTimeout(t); ok(!e && r?.material?.id ? r.material.id : null); }); } catch { clearTimeout(t); ok(null); }
    });
    const pts = [];
    for (const fx of [0.4, 0.47, 0.53, 0.6]) for (const fy of [0.46, 0.52]) pts.push([w * fx, h * fy]);
    const seen = {};
    (await Promise.all(pts.map(([x, y]) => pick(x, y)))).forEach((id) => { if (id) seen[id] = (seen[id] || 0) + 1; });
    const ranked = Object.entries(seen).filter(([id]) => !this.roles.rim[id] && !this.roles.caliper[id] && !this.roles.glass[id]).sort((a, b) => b[1] - a[1]);
    if (!ranked.length || ranked[0][1] < 3) return false;
    const id = ranked[0][0];
    if (this.roles.paint[id] && Object.keys(this.roles.paint).length === 1) return false;
    this.roles.paint = { [id]: true };
    this.paintSource = 'pick';
    this.#schedule();
    return true;
  }

  #compute(mat) {
    const ch = JSON.parse(this.originals[mat.id]);
    const d = this.desired;
    const id = mat.id;
    if (!d) return ch;
    if (this.roles.paint[id]) paintChannels(ch, d.paint.color, d.paint.roughness, d.paint.metalness);
    else if (this.roles.rim[id] && d.rim) paintChannels(ch, d.rim.color, d.rim.roughness ?? 0.3, d.rim.metalness ?? 1);
    else if (this.roles.caliper[id] && d.caliper) paintChannels(ch, d.caliper, 0.35, 0.3);
    else if (this.roles.glass[id] && d.tint) {
      const c = colorChannel(ch);
      if (c) { c.enable = true; c.color = toLinear('#05070a'); delete c.texture; }
      ch.Opacity = ch.Opacity || {};
      Object.assign(ch.Opacity, { enable: true, type: ch.Opacity.type || 'alphaBlend', factor: 0.92 });
      delete ch.Opacity.texture;
    }
    return ch;
  }

  #flush() {
    this.dirty = false;
    if (!this.api) return;
    for (const mat of this.materials) {
      const id = mat.id;
      const active = this.roles.paint[id] || this.roles.rim[id] || this.roles.caliper[id] || this.roles.glass[id];
      if (!active && !this.touched[id]) continue;
      mat.channels = this.#compute(mat);
      this.touched[id] = !!active;
      this.api.setMaterial(mat, () => {});
    }
  }

  #schedule() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => this.#flush());
  }

  setLook(look) { this.desired = look; this.#schedule(); }
  togglePaintMaterial(id) { if (this.roles.paint[id]) delete this.roles.paint[id]; else this.roles.paint[id] = true; this.#schedule(); }

  unload() {
    this.token++;
    this.api = null;
    this.reset();
    this.iframe?.remove();
    this.iframe = null;
  }

  load(model) {
    this.unload();
    const mine = this.token;
    return new Promise((resolve, reject) => {
      if (!window.Sketchfab) { reject(new Error('The Sketchfab viewer script did not load.')); return; }
      const iframe = document.createElement('iframe');
      iframe.className = 'showroom-frame';
      iframe.title = `${model.name} – 3D model`;
      iframe.setAttribute('allow', 'autoplay; fullscreen; xr-spatial-tracking');
      this.host.appendChild(iframe);
      this.iframe = iframe;

      const timer = setTimeout(() => { if (mine === this.token) { this.unload(); reject(new Error('The model took too long to load.')); } }, 60000);
      const fail = (msg) => { clearTimeout(timer); if (mine !== this.token) return; this.unload(); reject(new Error(msg)); };

      new window.Sketchfab(VERSION, iframe).init(model.uid, {
        autostart: 1, preload: 1, dnt: 1, transparent: 1,
        ui_controls: 0, ui_infos: 0, ui_stop: 0, ui_inspector: 0, ui_settings: 0, ui_help: 0, ui_hint: 0, ui_vr: 0, ui_ar: 0,
        ui_fullscreen: 0, ui_annotations: 0, ui_animations: 0, ui_watermark_link: 0,
        success: (api) => {
          if (mine !== this.token) return;
          this.api = api;
          api.start();
          api.addEventListener('viewerready', () => {
            if (mine !== this.token) return;
            /* the model's own vignette would darken the edges of the transparent viewer */
            try { api.setPostProcessing({ vignetteEnable: false }); } catch { /* ignore */ }
            /* tap-to-pick: the viewer reports the material under the pointer */
            api.addEventListener('click', (info) => { if (info && info.material && this.onPick) this.onPick(info.material); }, { pick: 'slow' });
            let pending = 3;
            const done = () => {
              if (--pending > 0 || mine !== this.token) return;
              clearTimeout(timer);
              try { this.#findAxes(); } catch { this.axes = null; }
              try { this.#guessPaintByUse(); } catch { /* keep whatever was found */ }
              resolve(this.capabilities());
            };
            api.getMaterialList((err, list) => {
              if (!err && list) { this.materials = list; list.forEach((m) => { this.originals[m.id] = JSON.stringify(m.channels || {}); this.#classify(m); }); this.#guessPaint(); }
              done();
            });
            api.getNodeMap((err, map) => { this.nodeMap = !err && map ? map : null; done(); });
            api.getCameraLookAt((err, cam) => { if (!err && cam) this.baseCam = { position: [...cam.position], target: [...cam.target] }; done(); });
            try { api.getFov((err, f) => { if (!err && f) this.fov = f; }); } catch { /* older viewer builds */ }
          });
        },
        error: () => fail('Sketchfab could not open this model. It may be private or not embeddable.')
      });
    });
  }

  /** Re-reads the viewer's own framing (it settles a moment after load) so views are computed from the final camera. */
  refreshBase() {
    return new Promise((resolve) => {
      if (!this.api) { resolve(); return; }
      this.api.getCameraLookAt((err, cam) => { if (!err && cam) this.baseCam = { position: [...cam.position], target: [...cam.target] }; resolve(); });
    });
  }

  /**
   * Finds the car's own axes from where its wheels sit. Sketchfab's world is Z-up, and the four wheel
   * centres give the length axis (wheelbase > track) - so "side", "front" and "rear" are true views
   * whatever direction the author's default camera happens to look from.
   */
  #findAxes() {
    this.axes = null;
    const map = this.nodeMap;
    if (!map || !this.baseCam) return;
    const nodes = Object.values(map);
    const byId = new Map(nodes.map((n) => [n.instanceID, n]));
    const parent = new Map();
    const walk = (n) => (n.children || []).forEach((c) => { if (c && typeof c === 'object') { parent.set(c.instanceID, n.instanceID); walk(c); } });
    nodes.forEach((n) => { if (n.children?.length && !parent.has(n.instanceID) && !n.__seen) walk(n); });
    const transformOf = (n) => {
      let id = n.instanceID;
      for (let i = 0; i < 40 && id != null; i++) {
        const a = byId.get(id);
        if (a?.worldMatrix) return a.worldMatrix;
        id = parent.get(id);
      }
      return null;
    };
    const rimIds = new Set(Object.keys(this.roles.rim));
    const isGeo = (n) => n.type === 'Geometry' || n.type === 'RigGeometry';
    const named = (n) => /(^|[^a-z])(wheel|rim|tyre|tire)/i.test(n.name || '') && !/steer|spare|cap|bolt|nut|brake|caliper/i.test(n.name || '');
    const strategies = [
      () => nodes.filter((n) => isGeo(n) && rimIds.has(n.materialID)),
      () => nodes.filter((n) => n.worldMatrix && named(n)),
      () => nodes.filter((n) => isGeo(n) && named(n))
    ];
    const rel = this.baseCam.position.map((v, i) => v - this.baseCam.target[i]);
    for (const pick of strategies) {
      const pts = new Map();
      for (const n of pick()) {
        const m = transformOf(n);
        if (m) { const p = [m[12], m[13], m[14]]; pts.set(p.map((x) => x.toFixed(3)).join(','), p); }
      }
      const axes = this.#solveAxes([...pts.values()], rel);
      if (axes) {
        this.axes = axes;
        /* a material called 'wheel' that also paints things far from the wheels (trim lines, panel edges) is not safe to recolour */
        const zone = axes.wheelbase * 0.3;
        for (const id of Object.keys(this.roles.rim)) {
          const users = nodes.filter((n) => isGeo(n) && n.materialID === id);
          const near = users.filter((n) => {
            const m = transformOf(n);
            return m && axes.pts.some((p) => Math.hypot(m[12] - p[0], m[13] - p[1]) < zone);
          });
          /* a rim is a handful of meshes per wheel; hundreds means the material is the small hardware (bolts, studs, lettering) */
          if (users.length && (near.length / users.length < 0.9 || users.length > 40)) delete this.roles.rim[id];
        }
        return;
      }
    }
  }

  #solveAxes(P, rel) {
    if (P.length < 3) return null;
    const cx = P.reduce((s, p) => s + p[0], 0) / P.length;
    const cy = P.reduce((s, p) => s + p[1], 0) / P.length;
    let sxx = 0, syy = 0, sxy = 0;
    P.forEach((p) => { sxx += (p[0] - cx) ** 2; syy += (p[1] - cy) ** 2; sxy += (p[0] - cx) * (p[1] - cy); });
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let a = [Math.cos(th), Math.sin(th)];
    const along = P.map((p) => (p[0] - cx) * a[0] + (p[1] - cy) * a[1]);
    const across = P.map((p) => -(p[0] - cx) * a[1] + (p[1] - cy) * a[0]);
    const wheelbase = Math.max(...along) - Math.min(...along);
    const track = Math.max(...across) - Math.min(...across);
    if (!(wheelbase > 0) || wheelbase < track * 1.15) return null;
    /* the author's default camera looks at the car from the front */
    if (rel[0] * a[0] + rel[1] * a[1] < 0) a = [-a[0], -a[1]];
    let s = [-a[1], a[0]];
    if (rel[0] * s[0] + rel[1] * s[1] < 0) s = [-s[0], -s[1]];
    const z = P.reduce((m, p) => m + p[2], 0) / P.length;
    /* the wheel on the visible (s) side at the front */
    const front = P.filter((p) => (p[0] - cx) * s[0] + (p[1] - cy) * s[1] > 0).sort((p, q) => ((q[0] - cx) * a[0] + (q[1] - cy) * a[1]) - ((p[0] - cx) * a[0] + (p[1] - cy) * a[1]))[0];
    return { c: [cx, cy], z, f: a, s, wheelbase, wheel: front || null, pts: P };
  }
  /** Camera for a named view. Uses the wheel-derived axes when found, else the author's default camera as reference. */
  goToView(id, duration = 1.1) {
    if (!this.api || !this.baseCam) return null;
    const deg = Math.PI / 180;
    const base = this.baseCam;
    const rel = base.position.map((v, i) => v - base.target[i]);
    const baseDist = Math.hypot(...rel) || 1;
    const ax = this.axes;
    const el0 = Math.asin(Math.max(-1, Math.min(1, rel[2] / baseDist)));
    const h0 = Math.atan2(rel[1], rel[0]);

    let floor = null;
    let target = base.target;
    let dir;           /* horizontal unit vector from the car towards the camera */
    let el = 2 * deg;
    let r;
    if (ax) {
      const F = ax.f, S = ax.s;
      const L = ax.wheelbase * 1.75, W = L * 0.42, H = L * 0.34;
      /* the iframe is a little larger than the visible hero (its edge controls are cropped away), so size the car to what is visible */
      const fh = Math.max(1, this.iframe?.clientHeight || 400);
      const vw = Math.max(1, this.host.clientWidth || 400), vh = Math.max(1, this.host.clientHeight || 300);
      const tan = Math.tan(((this.fov || 45) * deg) / 2);
      const fit = (w, hh, depth) => Math.max((w * fh) / (2 * tan * vw), (hh * fh) / (2 * tan * vh)) * 1.24 + depth / 2;
      target = [ax.c[0], ax.c[1], ax.z + ax.wheelbase * 0.13];
      const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
      const spec = {
        side: () => { dir = S; el = 2 * deg; r = fit(L, H, W); },
        front34: () => { dir = norm(F[0] * 0.8 + S[0] * 0.6, F[1] * 0.8 + S[1] * 0.6); el = 9 * deg; r = fit(L * 0.82, H, W); },
        front: () => { dir = F; el = 3 * deg; r = fit(W * 1.1, H, L); },
        rear: () => { dir = [-F[0], -F[1]]; el = 4 * deg; r = fit(W * 1.1, H, L); },
        top: () => { dir = S; el = 88 * deg; r = fit(L, W, H); },
        wheel: () => {
          if (ax.wheel) target = [ax.wheel[0], ax.wheel[1], ax.wheel[2]];
          dir = norm(S[0] * Math.cos(28 * deg) + F[0] * Math.sin(28 * deg), S[1] * Math.cos(28 * deg) + F[1] * Math.sin(28 * deg));
          el = 4 * deg; r = ax.wheelbase * 0.62;
        }
      }[id] || (() => { dir = [Math.cos(h0), Math.sin(h0)]; el = el0; r = baseDist; });
      spec();
      /* where the road surface lands in the hero, so the page can place a soft contact shadow under the car */
      if (id !== 'top' && id !== 'wheel') {
        const px = (u) => (u * fh) / (2 * tan * r);
        const span = { side: ax.wheelbase * 1.75, front34: ax.wheelbase * 1.4, front: ax.wheelbase * 0.74, rear: ax.wheelbase * 0.74 }[id] || ax.wheelbase * 1.4;
        floor = { y: vh / 2 + px(target[2] - (ax.z - ax.wheelbase * 0.115)), w: px(span) };
      }
    } else {
      const k = { side: 1.6, front34: 1.4, front: 1.4, rear: 1.4, top: 1.7, wheel: 0.55 }[id] || 1.4;
      const off = { side: 90 * deg, front34: 0, front: -35 * deg, rear: 180 * deg, top: 0, wheel: 70 * deg }[id] ?? 0;
      dir = [Math.cos(h0 - off), Math.sin(h0 - off)];
      el = id === 'top' ? 88 * deg : id === 'front34' ? el0 : 3 * deg;
      r = baseDist * k;
    }
    const pos = [target[0] + r * dir[0] * Math.cos(el), target[1] + r * dir[1] * Math.cos(el), target[2] + r * Math.sin(el)];
    this.api.setCameraLookAt(pos, target, duration);
    return floor;
  }

  screenshot() {
    return new Promise((resolve, reject) => {
      if (!this.api) { reject(new Error('No model loaded')); return; }
      this.api.getScreenShot('image/png', (err, url) => {
        if (err || !url) { reject(err || new Error('Capture failed')); return; }
        fetch(url).then((r) => r.blob()).then(resolve, reject);
      });
    });
  }
}
