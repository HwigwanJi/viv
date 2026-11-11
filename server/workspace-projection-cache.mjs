import {decodeUniverseSource} from './universe-storage.mjs';
import {projectCommandReceiptForStorage} from '../dist/domain/workspace-storage.mjs';

const KINDS=new Set(['universeSourceSnapshots','commandReceipts']);
const project=row=>{const value=JSON.parse(row.payload);return row.kind==='universeSourceSnapshots'?decodeUniverseSource(value):row.kind==='commandReceipts'?projectCommandReceiptForStorage(value,{legacyInline:true}):value;};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** Cache validated immutable projections, keyed by owner and exact stored bytes.
 * The quota accounts UTF-16 source/output text; entry count bounds object overhead.
 * Every caller receives its own object and every changed source is revalidated. */
export class WorkspaceProjectionCache {
 constructor({maximumBytes=64*1024*1024,maximumEntries=512}={}){
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0||!Number.isSafeInteger(maximumEntries)||maximumEntries<0)throw new TypeError('Invalid workspace projection cache bounds');
  this.maximumBytes=maximumBytes;this.maximumEntries=maximumEntries;this.used=0;this.items=new Map();
 }
 read(owner,row){
  if(!this.maximumBytes||!this.maximumEntries||!KINDS.has(row.kind)||typeof owner!=='string'||typeof row.object_id!=='string')return project(row);
  const key=JSON.stringify([owner,row.kind,row.object_id]),cached=this.items.get(key);
  if(cached?.raw===row.payload){this.items.delete(key);this.items.set(key,cached);const value=structuredClone(cached.value);if(cached.frozenSnapshot)freeze(value.snapshot);return value;}
  if(cached){this.items.delete(key);this.used-=cached.cost;}
  const value=project(row),cost=2*(key.length+row.payload.length+JSON.stringify(value).length);
  if(this.maximumEntries>0&&cost<=this.maximumBytes){
   while(this.items.size&&(this.used+cost>this.maximumBytes||this.items.size>=this.maximumEntries)){
    const oldest=this.items.keys().next().value;this.used-=this.items.get(oldest).cost;this.items.delete(oldest);
   }
   this.items.set(key,{raw:row.payload,value:structuredClone(value),frozenSnapshot:!!value?.snapshot&&Object.isFrozen(value.snapshot),cost});this.used+=cost;
  }
  return value;
 }
 evictOwner(owner){for(const [key,entry]of this.items)if(JSON.parse(key)[0]===owner){this.items.delete(key);this.used-=entry.cost;}}
}

// Shared across request-scoped repositories. It contains no authorization state.
export const workspaceProjectionCache=new WorkspaceProjectionCache();
