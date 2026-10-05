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
    /* the fixed screen area the insets are measured in; defaults to the host. A page that moves the host to place the
       car (goToView returns `shift`) passes the element that stays put. */
    this.viewport = null;
    /* 'center': the car sits in the middle of the free area. 'bottom': it stands on the lower edge of it. */
    this.anchor = 'center';
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
    this.lastSet = null;   /* the camera position goToView last asked for */
    this.paintSource = null;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };   /* screen areas covered by floating UI, in px */
    this.frame = null;     /* where the car last landed: { cy (viewport px), unit (px per wheelbase) } */
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
    const fr = this.iframe?.getBoundingClientRect(), vr = (this.viewport || this.host)?.getBoundingClientRect();
    if (!fr || !vr || !fr.width || !fr.height) return false;
    /* sample the flank around where goToView put the car (else the middle of the free area); the iframe is larger than the screen */
    const ins = this.insets;
    const boxW = Math.max(60, vr.width - ins.left - ins.right), boxH = Math.max(60, vr.height - ins.top - ins.bottom);
    const cx = vr.left + vr.width / 2, cy = vr.top + (this.frame ? this.frame.cy : ins.top + boxH / 2);
    const u = this.frame ? this.frame.unit : Math.min(boxW / 1.9, boxH);
    const pick = (x, y) => new Promise((ok) => {
      const t = setTimeout(() => ok(null), 1500);
      try { this.api.pickFromScreen([Math.round(x - fr.left), Math.round(y - fr.top)], (e, r) => { clearTimeout(t); ok(!e && r?.material?.id ? r.material.id : null); }); } catch { clearTimeout(t); ok(null); }
    });
    const pts = [];
    for (const fx of [-0.45, -0.22, 0, 0.22, 0.45]) for (const fy of [-0.1, 0, 0.08]) pts.push([cx + u * fx, cy + u * fy]);
    const seen = {};
    (await Promise.all(pts.map(([x, y]) => pick(x, y)))).forEach((id) => { if (id) seen[id] = (seen[id] || 0) + 1; });
    const ranked = Object.entries(seen).filter(([id]) => !this.roles.rim[id] && !this.roles.caliper[id] && !this.roles.glass[id]).sort((p, q) => q[1] - p[1]);
    if (!ranked.length || ranked[0][1] < 3) return false;
    const id = ranked[0][0];
    if (this.roles.paint[id] && Object.keys(this.roles.paint).length === 1) { this.paintSource = 'pick'; return false; }
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
      this.api.getCameraLookAt((err, cam) => {
        /* skip the camera we set ourselves - reading it back as "the author's framing" would compound on every refresh */
        const mine = this.lastSet && cam && Math.hypot(...cam.position.map((v, i) => v - this.lastSet[i])) < 1e-3 * (Math.hypot(...this.lastSet) + 1);
        if (!err && cam && !mine) this.baseCam = { position: [...cam.position], target: [...cam.target] };
        resolve();
      });
    });
  }

  /**
   * For a car whose wheels were not found: measure it. The viewer frames all geometry, a grid of rays is cast across
   * the frame, and the 3D points they hit give the car's footprint - its length axis (the long spread of points), its
   * width, ground and roof. From those it builds the same axes the wheel search gives, so every view, the bottom
   * anchoring and the contact shadow work as for any other car. Floor or shadow planes are left out by ignoring hits
   * in the lowest sliver of the height. Call it behind the loading veil. Resolves true when it found the axes.
   */
  async calibrate() {
    if (!this.api || this.axes || !this.baseCam || !this.iframe) return false;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const ok = await new Promise((r) => { try { this.api.focusOnVisibleGeometries(0, () => r(true)); } catch { r(false); } });
    if (!ok) return false;
    await wait(250);
    const fw = this.iframe.clientWidth, fh = this.iframe.clientHeight, C = 28, R = 40;
    const pick = (x, y) => new Promise((done) => {
      const t = setTimeout(() => done(null), 2000);
      try { this.api.pickFromScreen([x, y], (e, r) => { clearTimeout(t); const p = !e && r?.material && r.position3D; done(p ? [p[0], p[1], p[2]] : null); }); } catch { clearTimeout(t); done(null); }
    });
    const jobs = [];
    for (let i = 1; i < C; i++) for (let j = 1; j < R; j++) jobs.push(pick(Math.round((fw * i) / C), Math.round((fh * j) / R)));
    let P = (await Promise.all(jobs)).filter(Boolean);
    if (P.length < 30) return false;
    const zs = P.map((p) => p[2]).sort((a, b) => a - b);
    const zlo = zs[Math.floor(zs.length * 0.01)], zhi = zs[Math.floor(zs.length * 0.99)];
    const ground = zlo;
    P = P.filter((p) => p[2] > zlo + (zhi - zlo) * 0.06 && p[2] <= zhi);
    if (P.length < 20) return false;
    /* principal axis of the footprint = the car's length */
    const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
    let sxx = 0, syy = 0, sxy = 0;
    P.forEach((p) => { sxx += (p[0] - cx) ** 2; syy += (p[1] - cy) ** 2; sxy += (p[0] - cx) * (p[1] - cy); });
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let a = [Math.cos(th), Math.sin(th)];
    const span = (v) => { const q = P.map((p) => (p[0] - cx) * v[0] + (p[1] - cy) * v[1]).sort((x, y) => x - y); return [q[Math.floor(q.length * 0.01)], q[Math.ceil(q.length * 0.99) - 1]]; };
    const [a0, a1] = span(a), [s0, s1] = span([-a[1], a[0]]);
    const length = a1 - a0, width = s1 - s0;
    if (!(length > 0) || length < width * 1.2) return false;
    /* the author's camera looks at the car from the front, as in the wheel search */
    const rel = this.baseCam.position.map((v, i) => v - this.baseCam.target[i]);
    if (rel[0] * a[0] + rel[1] * a[1] < 0) a = [-a[0], -a[1]];
    let s = [-a[1], a[0]];
    if (rel[0] * s[0] + rel[1] * s[1] < 0) s = [-s[0], -s[1]];
    /* the middle of the footprint (the spans were measured from the mean point, along a and its perpendicular) */
    const am = (a0 + a1) / 2, sm = (s0 + s1) / 2;
    const centre = [cx + Math.cos(th) * am - Math.sin(th) * sm, cy + Math.sin(th) * am + Math.cos(th) * sm];
    const wheelbase = length / 1.75, z = ground + wheelbase * 0.115;
    const wheel = [centre[0] + a[0] * wheelbase * 0.5 + s[0] * width * 0.45, centre[1] + a[1] * wheelbase * 0.5 + s[1] * width * 0.45, z];
    this.axes = { c: centre, z, f: a, s, wheelbase, wheel, pts: [], measured: true };
    return true;
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
    /* The camera always looks at the car itself, so a swipe turns the car in place. Where the car lands on screen is
       done by moving the host instead: `shift` is how far (px) the host's middle must move down. */
    const vp = this.viewport || this.host;
    const vpW = Math.max(1, vp.clientWidth || 400), vpH = Math.max(1, vp.clientHeight || 300);
    const ins = this.insets;
    const vw = Math.max(140, vpW - ins.left - ins.right), vh = Math.max(120, vpH - ins.top - ins.bottom);
    let cy = ins.top + vh / 2;
    if (ax) {
      const F = ax.f, S = ax.s;
      const L = ax.wheelbase * 1.75, W = L * 0.42, H = L * 0.34;
      /* the iframe is larger than the visible screen (its edge controls are cropped away), so size the car to what is visible */
      const fh = Math.max(1, this.iframe?.clientHeight || 400);
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
          el = 4 * deg; r = ax.wheelbase * 0.62 * (fh / (vpH + 220));   /* tuned for a frame 220px taller than the screen */
        }
      }[id] || (() => { dir = [Math.cos(h0), Math.sin(h0)]; el = el0; r = baseDist; });
      spec();
      const px = (u) => (u * fh) / (2 * tan * r);
      const ground = ax.z - ax.wheelbase * 0.115;
      if (id !== 'top' && id !== 'wheel') {
        /* stand the car on the lower edge of the free area (the near corner of a 3/4 view reaches lower than the axle line) */
        const below = px(target[2] - ground) * (id === 'front34' ? 1.3 : 1.08), above = px(ax.wheelbase * 0.3);
        const pad = Math.min(18, vh * 0.04);
        if (this.anchor === 'bottom') {
          const low = ins.top + vh - pad - below;
          if (low - above >= ins.top + pad) cy = Math.max(cy, low);
        }
        cy = Math.max(vpH * 0.2, Math.min(vpH * 0.8, cy));   /* the host overhangs the screen by 30% each way */
        /* where the road surface lands, so the page can place a soft contact shadow under the car */
        const span = { side: ax.wheelbase * 1.75, front34: ax.wheelbase * 1.4, front: ax.wheelbase * 0.74, rear: ax.wheelbase * 0.74 }[id] || ax.wheelbase * 1.4;
        floor = { y: cy + px(target[2] - ground), w: px(span) };
      }
      this.frame = { cy, unit: px(ax.wheelbase) };
    } else {
      /* No axes (calibrate() could not measure the car either): a rough size from the author's camera, which frames
         the car for a 16:9 landscape window (about two thirds of its width). */
      const fh = Math.max(1, this.iframe?.clientHeight || 400);
      const tan = Math.tan(((this.fov || 45) * deg) / 2);
      const Lc = 0.66 * (16 / 9) * 2 * tan * baseDist, Hc = Lc * 0.34;
      const fit = (w, hh, depth) => Math.max((w * fh) / (2 * tan * vw), (hh * fh) / (2 * tan * vh)) * 1.2 + depth / 2;
      const off = { side: 90 * deg, front34: 0, front: -35 * deg, rear: 180 * deg, top: 0, wheel: 70 * deg }[id] ?? 0;
      dir = [Math.cos(h0 - off), Math.sin(h0 - off)];
      el = id === 'top' ? 88 * deg : id === 'front34' ? el0 : 3 * deg;
      r = { side: () => fit(Lc, Hc, Lc * 0.42), front34: () => fit(Lc * 0.85, Hc, Lc * 0.42), front: () => fit(Lc * 0.46, Hc, Lc), rear: () => fit(Lc * 0.46, Hc, Lc), top: () => fit(Lc, Lc * 0.42, Hc), wheel: () => Lc * 0.36 * (fh / (vpH + 220)) }[id]?.() ?? fit(Lc * 0.85, Hc, Lc * 0.42);
      /* lower the car towards the strip as far as its estimated height allows */
      if (this.anchor === 'bottom' && id !== 'top' && id !== 'wheel') {
        const half = ((Hc * fh) / (2 * tan * r)) * 0.6;
        cy = Math.max(cy, Math.min(ins.top + vh - half - Math.min(18, vh * 0.04), vpH * 0.8));
      }
      this.frame = { cy, unit: (Lc / 1.75) * fh / (2 * tan * r) };
    }
    const pos = [target[0] + r * dir[0] * Math.cos(el), target[1] + r * dir[1] * Math.cos(el), target[2] + r * Math.sin(el)];
    this.api.setCameraLookAt(pos, target, duration);
    this.lastSet = pos;
    return { floor, shift: Math.round(cy - vpH / 2) };
  }

  /**
   * Turntable camera: the car seen from `angle` degrees around its own vertical axis (0 = side, 90 = front),
   * at a fixed distance, so a slider can turn the car without the visitor orbiting freely.
   */
  spin(angle, duration = 0) {
    if (!this.api || !this.baseCam) return null;
    const deg = Math.PI / 180, a = angle * deg;
    const base = this.baseCam, ax = this.axes;
    const fh = Math.max(1, this.iframe?.clientHeight || 400);
    const hostW = Math.max(1, this.host.clientWidth || 400), hostH = Math.max(1, this.host.clientHeight || 300);
    const ins = this.insets;
    const vw = Math.max(140, hostW - ins.left - ins.right), vh = Math.max(120, hostH - ins.top - ins.bottom);
    const tan = Math.tan(((this.fov || 45) * deg) / 2);
    let target, dir, r, el, floor = null;
    if (ax) {
      const F = ax.f, S = ax.s, L = ax.wheelbase * 1.75, W = L * 0.42, H = L * 0.34;
      dir = [S[0] * Math.cos(a) + F[0] * Math.sin(a), S[1] * Math.cos(a) + F[1] * Math.sin(a)];
      el = 7 * deg;
      /* sized for the side view and kept constant, so the car does not grow or shrink while it turns */
      r = Math.max((L * fh) / (2 * tan * vw), (H * fh) / (2 * tan * vh)) * 1.14 + L * 0.45;
      target = [ax.c[0], ax.c[1], ax.z + ax.wheelbase * 0.13];
      target = [target[0], target[1], target[2] + ((ins.top - ins.bottom) / 2) * ((2 * r * tan) / fh)];
      const px = (u) => (u * fh) / (2 * tan * r);
      floor = { y: hostH / 2 + px(target[2] - (ax.z - ax.wheelbase * 0.115)), w: px(L * Math.abs(Math.cos(a)) + W * 1.15 * Math.abs(Math.sin(a))) };
    } else {
      const rel = base.position.map((v, i) => v - base.target[i]);
      const d = Math.hypot(...rel) || 1, h0 = Math.atan2(rel[1], rel[0]);
      dir = [Math.cos(h0 + a), Math.sin(h0 + a)];
      el = Math.asin(Math.max(-1, Math.min(1, rel[2] / d)));
      r = d; target = base.target;
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
