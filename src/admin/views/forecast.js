import { h, icon, compact, skeleton, errorState, chip, LEAD } from '../ui.js';
import { get, qs } from '../api.js';

// Forecast is deliberately transparent: live CRM pipeline drives the outlook; illustrative history is labelled as demo.
const DEMO = [
  ['May', 8, 7180000, 7, 4.1], ['Jun', 6, 5240000, 6, 4.8], ['Jul', 9, 8650000, 8, 4.4],
  ['Aug', 7, 6430000, 7, 5.2], ['Sep', 10, 10250000, 9, 4.6], ['Oct', 8, 7940000, 8, 4.9],
  ['Nov', 11, 11800000, 10, 4.3], ['Dec', 13, 14900000, 11, 4.1], ['Jan', 9, 9160000, 8, 4.7],
  ['Feb', 8, 7820000, 8, 5.1], ['Mar', 12, 12600000, 10, 4.5], ['Apr', 10, 10800000, 9, 4.2]
].map(([month, units, revenue, leads, days]) => ({ month, units, revenue, leads, days }));
const probability = { new: .08, contacted: .18, qualified: .35, negotiating: .68, won: 1, lost: 0 };
const money = (n) => `AED ${compact(n)}`;

export async function mountForecast(view) {
  const header = h('header', { class: 'phead' }, [h('div', {}, [h('p', { class: 'phead__eyebrow', text: 'Exotic Cars Dubai · Revenue intelligence' }), h('h1', { class: 'phead__title', text: 'Sales forecast' })]),
    h('div', { class: 'phead__actions' }, [h('span', { class: 'forecast__live' }, [h('i'), 'Live CRM model'])])]);
  const body = h('div', { class: 'forecast' }, skeleton(8)); view.append(header, body);
  try {
    const [stats, leadRes] = await Promise.all([get('admin/stats'), get(`admin/leads${qs({ limit: 500 })}`)]);
    render(stats, leadRes.data || []);
  } catch (e) { body.replaceChildren(errorState(e, () => mountForecast(view))); }

  function render(stats, leads) {
    const open = leads.filter(l => !['won', 'lost'].includes(l.status));
    const weighted = open.reduce((sum, l) => sum + (Number(l.value) || Number(l.car?.price) || 0) * (probability[l.status] ?? .08), 0);
    const won = leads.filter(l => l.status === 'won');
    const wonValue = won.reduce((s,l)=>s+(Number(l.value)||Number(l.car?.price)||0),0);
    const rawPipe = open.reduce((s,l)=>s+(Number(l.value)||Number(l.car?.price)||0),0);
    const forecast = weighted + wonValue;
    const target = Math.max(1, Math.round(DEMO.reduce((s,m)=>s+m.revenue,0)/12));
    const progress = Math.min(100, Math.round(forecast/target*100));
    const stageRows = Object.entries(probability).filter(([s])=>s!=='lost').map(([stage,p])=>{
      const subset = leads.filter(l=>l.status===stage), value = subset.reduce((s,l)=>s+(Number(l.value)||Number(l.car?.price)||0),0);
      return {stage, count:subset.length, value, weighted:value*p, p};
    });
    const projectedClose = forecast ? Math.max(1, Math.round(forecast / (won.length ? wonValue/won.length : 4200000))) : 0;
    const avgDeal = won.length ? wonValue/won.length : 4200000;
    const avgDays = DEMO.reduce((s,m)=>s+m.days,0)/DEMO.length;
    const insights = [];
    if (open.length) insights.push({title:`${open.length} active opportunities contribute ${money(weighted)} probability-weighted`, detail:`${money(rawPipe)} unweighted pipeline · ${Math.round((weighted/(rawPipe||1))*100)}% blended stage confidence. Negotiation-stage deals carry the greatest near-term impact.`});
    else insights.push({title:'No active opportunities in the pipeline', detail:'New enquiries will appear here automatically. Add deal values to improve the revenue outlook.'});
    const neg = stageRows.find(x=>x.stage==='negotiating');
    if (neg?.count) insights.push({title:`${neg.count} deal${neg.count===1?'':'s'} in negotiation`, detail:`${money(neg.value)} at stake; confirm buyer financing, inspection status and decision date to protect the ${Math.round(neg.p*100)}% planning weight.`});
    const priced = stats.inventory.priced || 0;
    insights.push({title:`${priced} of ${stats.inventory.forSale} active cars have asking prices`, detail:priced ? `${money(stats.inventory.listedValue)} visible inventory value. Pricing the remaining ${stats.inventory.forSale-priced} cars improves stock coverage and lead-value estimates.` : 'Pricing live inventory will make stock coverage and expected deal values more precise.'});
    insights.push({title:`Demo close-time benchmark: ${avgDays.toFixed(1)} days`, detail:'Illustrative 12-month showroom history; replace with imported closed-deal dates before using this benchmark operationally.'});
    const max = Math.max(...DEMO.map(m=>m.revenue));
    body.replaceChildren(
      h('div',{class:'forecast__notice'},[icon('spark'),h('div',{},[h('b',{text:'Demo sales history · illustrative data'}),h('p',{text:'The 12-month history below is realistic sample data for preview. Live forecast figures come from current CRM leads and inventory; demo history is not dealership actuals.'})])]),
      h('section',{class:'forecast__kpis'},[
        metric('Weighted outlook',money(forecast),`${money(wonValue)} closed + ${money(weighted)} weighted open`, 'trend'),
        metric('Open pipeline',money(rawPipe),`${open.length} opportunities · ${leads.filter(l=>l.status==='negotiating').length} negotiating`, 'leads'),
        metric('Average closed deal',won.length?money(avgDeal):'Awaiting wins',`${won.length} closed CRM deal${won.length===1?'':'s'}`, 'money'),
        metric('Inventory coverage',`${priced}/${stats.inventory.forSale}`,`${stats.inventory.forSale ? Math.round(priced/stats.inventory.forSale*100):0}% of active cars priced`, 'car')
      ]),
      h('section',{class:'forecast__grid'},[
        panel('Revenue outlook','Current live CRM · probability weighted',h('div',{class:'forecast__outlook'},[
          h('div',{class:'forecast__target'},[h('span',{text:'Planning target · monthly demo baseline'}),h('b',{text:money(target)})]),
          h('div',{class:'forecast__track'},h('i',{style:`width:${progress}%`})),
          h('div',{class:'forecast__target'},[h('span',{text:`Outlook attainment · ${progress}%`}),h('b',{text:money(forecast)})]),
          h('p',{class:'muted',text:`Planning estimate: about ${projectedClose} deal${projectedClose===1?'':'s'} at ${money(avgDeal)} average. This uses live CRM values when available and a demo fallback average until closed history is recorded.`})
        ])),
        panel('AI insights','Explainable signals from CRM data',h('div',{class:'forecast__insights'},insights.map(i=>h('article',{},[h('span',{},icon('spark')),h('div',{},[h('b',{text:i.title}),h('p',{text:i.detail})])]))))
      ]),
      h('section',{class:'forecast__grid'},[
        panel('Pipeline by stage','Weighted value = deal value × planning probability',h('div',{class:'forecast__stages'},stageRows.map(r=>h('div',{class:'forecast__stage'},[
          h('div',{class:'forecast__stage-title'},[chip(LEAD[r.stage]?.label||r.stage,LEAD[r.stage]?.tone),h('span',{text:`${Math.round(r.p*100)}% weight · ${r.count} deals`})]),
          h('div',{class:'forecast__track'},h('i',{style:`width:${rawPipe?Math.max(r.value/rawPipe*100,r.value?3:0):0}%`})),
          h('div',{class:'forecast__target'},[h('span',{text:`${money(r.value)} raw`}),h('b',{text:`${money(r.weighted)} weighted`})])
        ])))),
        panel('Sales history','Illustrative sample · last 12 months · AED',h('div',{class:'forecast__history'},DEMO.map(m=>h('div',{class:'forecast__month'},[
          h('div',{class:'forecast__bar-wrap',title:`${m.units} cars · ${money(m.revenue)} · ${m.leads} leads`},h('i',{style:`height:${Math.max(6,m.revenue/max*100)}%`})),
          h('small',{text:m.month}),h('b',{text:String(m.units)})
        ]))))
      ]),
      panel('Closed sales ledger','Won leads with recorded values', won.length ? h('div',{class:'forecast__ledger'},won.slice(0,12).map(l=>h('div',{},[
        h('span',{},[h('b',{text:l.car?.title||'Vehicle sale'}),h('small',{text:`${l.name} · ${new Date(l.updatedAt||l.createdAt).toLocaleDateString('en-GB')}`})]),h('b',{text:money(Number(l.value)||Number(l.car?.price)||0)})
      ]))) : h('p',{class:'muted',text:'No won deals with actual sale records yet. When leads are moved to Won and assigned a value, they will be listed here. The chart above remains clearly marked sample data.'}))
    );
  }
}
function metric(label,value,sub,ic){return h('article',{class:'forecast__metric'},[h('span',{},icon(ic)),h('small',{text:label}),h('b',{text:value}),h('p',{text:sub})]);}
function panel(title,sub,content){return h('article',{class:'card forecast__panel'},[h('header',{class:'card__head'},[h('h2',{text:title}),h('small',{text:sub})]),content]);}
