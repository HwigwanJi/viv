import {renderLifeGallery,createMindLifeRuntime} from './mind-life.mjs';
const root=document.querySelector('#mind-life');root.innerHTML=renderLifeGallery();const runtime=createMindLifeRuntime();runtime.mount(root);addEventListener('pagehide',()=>runtime.destroy(),{once:true});
