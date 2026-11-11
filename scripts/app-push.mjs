import webpush from 'web-push';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function loadPushKeys(root){
 const file=path.join(root,'.runtime','web-push-vapid.json');
 try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const keys=webpush.generateVAPIDKeys();await writeFile(file,JSON.stringify(keys)+'\n',{flag:'wx',mode:0o600});return keys;
}
