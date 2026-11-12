export function optionalSessionStorage(environment=globalThis){
  try{return environment.sessionStorage??null;}catch{return null;}
}
