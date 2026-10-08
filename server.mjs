import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('./dist/',import.meta.url);
const types={html:'text/html; charset=utf-8',css:'text/css',mjs:'text/javascript',svg:'image/svg+xml'};
http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=new URL(pathname==='/'?'index.html':'.'+pathname,root);if(!fileURLToPath(file).startsWith(fileURLToPath(root)))throw Error();const body=await readFile(file);res.writeHead(200,{'Content-Type':types[file.pathname.split('.').pop()]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}}).listen(5180,'127.0.0.1',()=>console.log('Qadam AI: http://127.0.0.1:5180'));
