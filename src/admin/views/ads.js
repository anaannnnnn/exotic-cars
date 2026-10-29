import { h, icon, toast, failed, field, input, select, confirmBox, errorState } from '../ui.js';
import { get, post, del } from '../api.js';
import { pickFiles, uploadPhotos, displayUrl } from '../media.js';

const FONTS = ['Instrument Sans Variable', 'Archivo Variable', 'Michroma'];
export function mountAds(view) {
  view.append(h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Website content' }), h('h1', { class: 'phead__title', text: 'Home advertisements' })]), h('p', { class: 'muted small', text: 'Slides rotate every 4 seconds. Upload an image and add optional copy.' })]));
  const form = h('form', { class: 'card ad-form' });
  const fileLabel = h('span', { class: 'muted small', text: 'No image selected' });
  let file = null, image = '';
  const preview = h('img', { class: 'ad-preview', alt: 'Advertisement preview', hidden: true });
  const copy = input('text', '', { maxlength: 160, placeholder: 'Optional headline or offer text' });
  const font = select('font', FONTS.map((f) => [f, f.replace(' Variable', '')]), FONTS[0]);
  const pick = h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => pickFiles((files) => { file = files[0]; image = ''; fileLabel.textContent = file?.name || 'No image selected'; if (file) { preview.src = URL.createObjectURL(file); preview.hidden = false; } }, { multiple: false }) }, [icon('upload'), 'Choose image']);
  form.append(h('header', { class: 'card__head' }, [h('h2', { text: 'Add slide' }), h('small', { text: 'Use JPEG, PNG or WebP · up to 4 MB after resizing' })]), field('Image', h('div', { class: 'ad-file' }, [pick, fileLabel])), preview,
    field('Text (optional)', copy), field('Website font', font), h('div', { class: 'card__actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, [icon('plus'), 'Add slide'])));
  view.append(form);
  const list = h('div', { class: 'ad-list rows' });
  view.append(h('h2', { class: 'section-title', text: 'Current slides' }), list);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      if (file) image = (await uploadPhotos([file]))[0];
      if (!image) throw new Error('Choose an image before adding the slide.');
      await post('admin/ads', { image, text: copy.value, font: font.value, active: true });
      file = null; image = ''; copy.value = ''; font.value = FONTS[0]; preview.hidden = true; fileLabel.textContent = 'No image selected'; toast('Advertisement added'); await load();
    } catch (err) { failed(err); } finally { button.disabled = false; }
  });
  async function load() {
    try {
      const ads = await get('admin/ads');
      list.replaceChildren(...(ads.length ? ads.map((ad, i) => h('article', { class: 'row ad-row' }, [
        h('span', { class: 'row__img' }, h('img', { src: displayUrl(ad.image), alt: '' })),
        h('span', { class: 'row__t' }, [h('b', { text: ad.text || `Image only · slide ${i + 1}` }), h('small', { text: `${ad.font.replace(' Variable', '')} · ${new Date(ad.createdAt).toLocaleDateString()}` })]),
        h('button', { class: 'qbtn', type: 'button', 'aria-label': 'Delete advertisement', onclick: async () => { if (!(await confirmBox({ title: 'Delete this slide?', body: 'It will stop appearing on the home page.', ok: 'Delete slide', danger: true }))) return; try { await del(`admin/ads/${ad.id}`); toast('Slide deleted'); load(); } catch (err) { failed(err); } } }, icon('trash'))
      ])) : [h('p', { class: 'empty', text: 'No slides yet. Add the first advertisement above.' })]));
    } catch (err) { list.replaceChildren(errorState(err, load)); }
  }
  load();
}
