import {readFile,writeFile,mkdir,readdir,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url),assets={};
async function collect(dir,prefix=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name==='server'||entry.name==='.openai')continue;
    const key=prefix+'/'+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
    if(entry.isDirectory())await collect(url,key);else assets[key]=await readFile(url,'utf8');
  }
}
await collect(new URL('dist/',root));
const orders=(await readFile(new URL('dist/orders.mjs',root),'utf8')).replaceAll('export function','function');
const api=(await readFile(new URL('worker/api.mjs',root),'utf8')).replace(/^import .*;\n/,'').replaceAll('export async function','async function');
const worker=`${orders}\n${api}\nconst ASSETS=${JSON.stringify(assets)};\nexport default {async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return api(request,env);const key=url.pathname==='/'?'/index.html':url.pathname;if(!Object.hasOwn(ASSETS,key))return new Response('Not found',{status:404});const ext=key.split('.').pop();return new Response(ASSETS[key],{headers:{'Content-Type':({html:'text/html; charset=utf-8',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml'})[ext]||'text/plain','X-Content-Type-Options':'nosniff'}});}};`;
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),worker);
await cp(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
await cp(new URL('drizzle/',root),new URL('dist/.openai/drizzle/',root),{recursive:true});
console.log('Built Worker with',Object.keys(assets).length,'assets');
