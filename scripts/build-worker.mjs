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
const modules=new Map(),chunks=[];
async function bundle(url){
  if(modules.has(url.href))return modules.get(url.href);
  const id='module'+modules.size;modules.set(url.href,id);
  let source=await readFile(url,'utf8');
  for(const match of [...source.matchAll(/^import \{([^}]+)\} from ['"]([^'"]+)['"];?$/gm)]){
    const child=await bundle(new URL(match[2],url));source=source.replace(match[0],`const {${match[1]}}=${child};`);
  }
  const names=[...source.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map(m=>m[1]);
  source=source.replace(/^export /gm,'');
  if(/^import /m.test(source)||/^export /m.test(source))throw Error('Unsupported module syntax: '+url.pathname);
  chunks.push(`const ${id}=(()=>{${source}\nreturn {${names.join(',')}};})();`);return id;
}
const apiModule=await bundle(new URL('worker/api.mjs',root));
const worker=`${chunks.join('\n')}\nconst ASSETS=${JSON.stringify(assets)};
export default {async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return ${apiModule}.api(request,env);const key=url.pathname==='/'?'/index.html':url.pathname;if(!Object.hasOwn(ASSETS,key))return new Response('Not found',{status:404});const ext=key.split('.').pop();return new Response(ASSETS[key],{headers:{'Content-Type':({html:'text/html; charset=utf-8',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml'})[ext]||'text/plain','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache','Referrer-Policy':'same-origin'}});}};`;
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),worker);
await cp(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
await cp(new URL('drizzle/',root),new URL('dist/.openai/drizzle/',root),{recursive:true});
console.log('Built Worker with',Object.keys(assets).length,'assets');
