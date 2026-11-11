import {validateOntologyFacts} from '../dist/domain/strategy-ontology-validation.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleOntologyValidationAPI(request){
 if(!request.headers.get('oai-authenticated-user-id'))return json({ok:false,code:'UNAUTHORIZED'},401);
 if(request.method!=='POST')return json({ok:false,code:'METHOD'},405);
 if(new URL(request.url).search)return json({ok:false,code:'INPUT'},400);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({ok:false,code:'ORIGIN'},403);
 try{
  const reader=request.body?.getReader();if(!reader)return json({ok:false,code:'INPUT'},400);
  const parts=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>200000){await reader.cancel();return json({ok:false,code:'REQUEST_TOO_LARGE'},413);}parts.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return json({ok:true,report:validateOntologyFacts(input)});
 }catch(error){return json({ok:false,code:error.code==='ONTOLOGY_VALIDATION_INPUT'?error.code:'INPUT',message:'온톨로지 검사 입력을 확인하세요.'},400);}
}
