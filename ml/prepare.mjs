import {readFileSync} from 'node:fs';
import {demo,parseCSV} from '../dist/core.mjs';
import {fingerprint} from '../dist/ml.mjs';
const input=process.argv[2];
const parsed=input==='--demo'?{rows:demo(),errors:[]}:parseCSV(readFileSync(input,'utf8'));
if(parsed.errors.length)throw Error(JSON.stringify(parsed.errors));
console.log(JSON.stringify({rows:parsed.rows,fingerprint:await fingerprint(parsed.rows),source:input==='--demo'?'synthetic-demo':'user-csv'}));
