import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { getSettings, onSettings } from '../state/settings.js';
gsap.registerPlugin(ScrollTrigger);
export { gsap };
export const motionEnabled = () => !getSettings().reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Every page owns its animations and removes them before the router replaces its DOM. */
export function animatePage(root, kind) {
  let context;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  function start() {
    context?.revert();
    if (!motionEnabled()) return;
    context = gsap.context(() => {
      if (kind === 'home') {
        gsap.timeline({defaults:{ease:'power3.out'}})
          .from('.home__top', {y:-12,opacity:0,duration:.6})
          .from('.home__hero-copy > *', {y:32,opacity:0,stagger:.08,duration:.8}, .12)
          .from('.spotlight', {y:42,rotate:2,opacity:0,duration:1}, .2)
          .from('.home__brands', {y:12,opacity:0,duration:.6}, .65);
        gsap.from('.home-picks .scard', {y:28,opacity:0,stagger:.1,duration:.75,ease:'power3.out',scrollTrigger:{trigger:'.home-picks',start:'top 90%',once:true}});
      } else if (kind === 'car') {
        gsap.from('.car__title', {y:18,opacity:0,duration:.65});
        gsap.from('.car__panel', {y:24,opacity:0,duration:.65,delay:.1,ease:'power3.out'});
        gsap.from('.buy', {y:24,opacity:0,duration:.5,delay:.2});
      } else {
        gsap.from('.head, .scar__info', {y:22,opacity:0,duration:.65,ease:'power3.out'});
        const cards = [...root.querySelectorAll('.scard')].slice(0,8);
        if (cards.length) gsap.from(cards, {y:26,opacity:0,stagger:.045,duration:.65,ease:'power3.out'});
        const gallery = root.querySelector('.gal');
        if (gallery) gsap.from(gallery, {opacity:0,duration:.7});
      }
    }, root);
  }
  start();
  const off=onSettings(start);
  media.addEventListener('change',start);
  return () => {off();media.removeEventListener('change',start);context?.revert();};
}

export function revealOptions(element) {
  if (!motionEnabled()) return;
  gsap.killTweensOf(element);
  gsap.fromTo(element,{y:8,opacity:0},{y:0,opacity:1,duration:.3,ease:'power2.out',clearProps:'transform,opacity'});
}
