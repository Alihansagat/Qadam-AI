import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {api} from './worker/api.mjs';
import {openDB} from './worker/local-db.mjs';
await mkdir(new URL('./output/',import.meta.url),{recursive:true});
const DB=openDB(fileURLToPath(new URL('./output/local.sqlite',import.meta.url)));
const root=new URL('./dist/',import.meta.url);
const types={json:'application/json',html:'text/html; charset=utf-8',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml'};
http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1:5180'),pathname=decodeURIComponent(url.pathname);
  if(pathname.startsWith('/api/')){
    if(!['127.0.0.1:5180','localhost:5180'].includes(req.headers.host)){res.writeHead(403);res.end();return;}
    let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1024*1024){res.writeHead(413);res.end();return;}}
    const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-owner');
    const response=await api(new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:data}),{DB});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const file=new URL(pathname==='/'?'index.html':'.'+pathname,root);if(!fileURLToPath(file).startsWith(fileURLToPath(root)))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':types[file.pathname.split('.').pop()]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(body);
}catch{res.writeHead(404);res.end('Not found');}}).listen(5180,'127.0.0.1',()=>console.log('Qadam AI: http://127.0.0.1:5180'));
