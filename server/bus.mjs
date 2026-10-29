import { EventEmitter } from 'node:events';

/* A tiny in-process event bus: the API publishes what happened (a lead came in, a discount needs approval...) and each
   open CRM screen, subscribed through /admin/events, hears it at once. One container serves the site, so one bus is enough. */
const bus = new EventEmitter();
bus.setMaxListeners(500);
let seq = 0;
export const publish = (type, data = {}) => { bus.emit('event', { id: ++seq, type, at: new Date().toISOString(), ...data }); };
export const subscribe = (fn) => { bus.on('event', fn); return () => bus.off('event', fn); };
export const listeners = () => bus.listenerCount('event');
