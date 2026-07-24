import { readFileSync, readdirSync, statSync } from 'node:fs';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { validateMnemonic } from '@scure/bip39';
const roots = ['C:/Users/Nasro/.claude', 'C:/Users/Nasro/AppData/Local/Temp/claude', 'G:/Programmes Installés/caches/temp/claude', 'C:/tmp'];
const hits = new Set(); let scanned = 0;
function walk(d){ let e; try { e = readdirSync(d,{withFileTypes:true}); } catch { return; }
  for (const x of e){ const p = d+'/'+x.name;
    if (x.isDirectory()){ if (!/node_modules|\.git/.test(x.name)) walk(p); }
    else if (/\.(txt|json|md|jsonl|log)$/.test(x.name)){ try { const s=statSync(p); if(s.size>5_000_000) continue; const t=readFileSync(p,'utf8').toLowerCase(); const tok=t.match(/[a-z]+/g)||[]; scanned++;
      for(let i=0;i+12<=tok.length;i++){ let ok=true; for(let j=0;j<12;j++) if(!wordlist.includes(tok[i+j])){ok=false;break;} if(ok){const ph=tok.slice(i,i+12).join(' '); if(validateMnemonic(ph,wordlist)) hits.add(ph);} } } catch{} } } }
for (const r of roots) walk(r);
console.log('fichiers scannés:', scanned, 'mnemonics valides:', hits.size);
for (const h of hits) console.log(' -', h);
