// Keep the original request envelope until a definitive receipt arrives.
export async function submitFunding(request,path,body,{storage=globalThis.sessionStorage}={}){
  const key='cji-paper-funding:'+JSON.stringify({path,payload:Object.fromEntries(Object.entries(body).filter(([k])=>!['idempotencyKey','expectedRevision'].includes(k)))});
  let envelope=body;
  try{const saved=storage?.getItem(key);if(saved){const parsed=JSON.parse(saved);if(parsed.path===path&&typeof parsed.body?.idempotencyKey==='string')envelope=parsed.body;}storage?.setItem(key,JSON.stringify({path,body:envelope}));}catch{}
  try{
    let value;
    try{value=await request(path,envelope);}catch(error){if(error.serverResponse)throw error;value=await request(path,envelope);}
    try{storage?.removeItem(key);}catch{}
    return value;
  }catch(error){if(error.serverResponse)try{storage?.removeItem(key);}catch{}throw error;}
}

export const submitPaperFunding=submitFunding;
