import * as stock from '../data/stock.js';
import { h, icon } from '../ui/dom.js';
import { brandMark } from '../ui/brand.js';
import { openSettings, openLogin, closePanel } from '../ui/panels.js';
import { setShopBrand } from './shop.js';
const FEATURED=['Ferrari','Lamborghini','Porsche','McLaren','Rolls Royce','Bentley'];
export function mountHome(root){
 const cars=stock.queryStock({tab:'sale'}),brands=new Set(cars.map(c=>c.brand)).size;
 const hero=cars.find(c=>c.id===6638)||cars[0];
 const picks=[hero,cars.find(c=>c.brand==='Lamborghini'),cars.find(c=>c.id===6644)].filter(Boolean);
 const match=stock.configuratorMatch(hero);
 const photo=h('img',{src:stock.coverUrl(hero),alt:hero.title,fetchpriority:'high',width:800,height:600});
 root.append(h('main',{class:'home'},[
  h('header',{class:'home__top'},[
   h('a',{class:'wordmark',href:'#/',text:'EXOTIC'}),
   h('span',{class:'home__location'},[h('i',{'aria-hidden':'true'}),'Dubai, UAE']),
   h('div',{class:'home__tools'},[h('button',{class:'round round--sm',type:'button','aria-label':'Settings',onclick:openSettings},icon('gear')),h('button',{class:'round round--sm',type:'button','aria-label':'Account',onclick:openLogin},icon('user'))])
  ]),
  h('section',{class:'home__hero'},[
   h('div',{class:'home__hero-copy'},[
    h('p',{class:'home__eyebrow'},[h('span',{class:'eyebrow-dot','aria-hidden':'true'}),'THE EXOTIC COLLECTION']),
    h('h1',{class:'home__title'},['Find your',h('br'),h('em',{text:'next obsession.'})]),
    h('p',{class:'home__lede',text:'Extraordinary cars. A world of possibilities. Find the one that moves you, then make it yours.'}),
    h('div',{class:'home__hero-actions'},[h('a',{class:'cta',href:'#/shop'},['Explore the collection',icon('forward')]),h('span',{class:'home__count',text:`${cars.length} cars · ${brands} marques`})])
   ]),
   h('div',{class:'spotlight'},[
    h('div',{class:'spotlight__top'},[h('span',{class:'spotlight__label',text:'IN THE SPOTLIGHT'}),h('span',{class:'spotlight__index',text:'01 / EXOTIC'})]),
    h('a',{class:'spotlight__image',href:`#/shop/${hero.id}`},photo),
    h('div',{class:'spotlight__bottom'},[h('div',{},[h('p',{text:hero.brand}),h('h2',{text:hero.title.replace(/^Ferrari /,'')}),h('span',{text:`${hero.year} · ${stock.kmLabel(hero) || hero.exterior}`})]),h('a',{class:'spotlight__go',href:match?`#/shop/${hero.id}/configure`:`#/shop/${hero.id}`,'aria-label':match?`Configure ${hero.title}`:`View ${hero.title}`},icon('forward'))]),
    h('span',{class:'spotlight__note',text:match?'YOUR VISION. YOUR CONFIGURATION.':'FIND YOUR NEXT DRIVE.'})
   ])
  ]),
  h('section',{class:'home__brands','aria-label':'Browse by marque'},FEATURED.map(m=>h('button',{class:'marque',type:'button','aria-label':`Browse ${m}`,onclick:()=>setShopBrand(m)},[brandMark(m==='Rolls Royce'?'Rolls-Royce':m),h('span',{text:m})]))),
  h('section',{class:'home-picks'},[
   h('div',{class:'section-heading'},[h('div',{},[h('p',{class:'eyebrow',text:'A CLOSER LOOK'}),h('h2',{text:'Exceptional by nature.'})]),h('a',{class:'text-link',href:'#/shop'},['View all cars',icon('forward')])]),
   h('div',{class:'home-picks__grid'},picks.map(c=>h('a',{class:'scard',href:`#/shop/${c.id}`},[h('span',{class:'scard__img'},[h('img',{src:stock.coverUrl(c),alt:c.title,loading:'lazy',width:800,height:600}),h('span',{class:'badge',text:'Available'})]),h('span',{class:'scard__body'},[h('span',{class:'scard__title',text:c.title}),h('span',{class:'scard__meta',text:`${c.year} · ${stock.kmLabel(c) || c.exterior}`}),h('span',{class:'scard__footer'},[h('span',{class:'scard__price',text:stock.priceLabel(c)}),h('span',{class:'card-arrow','aria-hidden':'true'},icon('forward'))])])]))
   )
  ])
 ]));
 return {kind:'home',destroy(){closePanel()}};
}
