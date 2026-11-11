import {readFile} from 'node:fs/promises';
import {assertEventDataset} from './event-market-datasets.mjs';

/** Local host adapter. Cloud callers inject their own EVENT_DATASETS binding. */
export function createLocalEventDatasetBinding({directory=new URL('./data/upbit-events/',import.meta.url)}={}){
 const cache=new Map();
 async function index(){try{return JSON.parse(await readFile(new URL('index.json',directory),'utf8'));}catch(error){if(error.code==='ENOENT')return {datasets:[]};throw error;}}
 return {async list(){return structuredClone((await index()).datasets??[]);},async get(id){const entry=((await index()).datasets??[]).find(d=>d.id===id||!id);if(!entry||!/^[a-zA-Z0-9_.-]+\.json$/.test(entry.file??''))return null;const key=entry.id+':'+entry.sourceHash;if(!cache.has(key)){const d=assertEventDataset(JSON.parse(await readFile(new URL(entry.file,directory),'utf8')));if(d.id!==entry.id||d.sourceHash!==entry.sourceHash)throw Object.assign(new Error('자료 목록과 실제 원본을 대조하세요.'),{code:'EVENT_DATASET_INDEX',status:409});if(cache.size>=6)cache.delete(cache.keys().next().value);cache.set(key,d);}return cache.get(key);}};
}
