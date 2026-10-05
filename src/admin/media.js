import { api, SITE } from './api.js';

/* Photos: what to show for a car, and uploads (resized in the browser to WebP, at most 1920 px, before they leave). */
export const PLACEHOLDER = `${SITE}stock/coming-soon.svg`;
const isMedia = (u) => typeof u === 'string' && u.startsWith('/api/v1/media/');
/* imported cars keep a fast self-hosted copy of their first photo until the CRM changes the cover */
export const ownCover = (c) => Boolean(c.cover) && (isMedia(c.cover) || c.customCover || c.id >= 900000);
export const carThumb = (c) => (ownCover(c) ? c.cover : c.id < 900000 ? `${SITE}stock/${c.id}.webp` : PLACEHOLDER);
export const imgFallback = (e) => {
  const img = e.currentTarget;
  if (img.dataset.fb) return;
  img.dataset.fb = '1';
  img.src = PLACEHOLDER;
};

const MAX = 1920;

async function toWebp(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) throw new Error(`${file.name} is not a photo this browser can read.`);
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), hgt = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, hgt);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close?.();
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.84 });
  if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });   /* Safari without WebP encode */
  if (blob.size > 3.8 * 1024 * 1024) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  return blob;
}

/** Upload files; calls onEach(url) as each one lands. Returns the list of URLs. */
export async function uploadPhotos(files, onEach = () => {}) {
  const out = [];
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const blob = await toWebp(f);
    const res = await api('admin/media', { method: 'POST', raw: blob, timeout: 60000 });
    out.push(res.url);
    onEach(res.url);
  }
  return out;
}

/** A hidden file input wired to a button. */
export function pickFiles(onFiles, { multiple = true } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
  input.multiple = multiple;
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  input.click();
}

/** Accept a photo URL for display in the CRM: uploaded media is same-origin, links must be https. */
export const displayUrl = (u) => (isMedia(u) ? new URL(u, location.origin).href : u);
