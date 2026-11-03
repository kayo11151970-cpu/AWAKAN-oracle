import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../admin/',import.meta.url);
const template=await readFile(new URL('template.html',root),'utf8');
const runtime=await readFile(new URL('admin.js',root),'utf8');
if(runtime.includes('</script'))throw new Error('Unsafe script terminator');
await writeFile(new URL('index.html',root),template.replace('/* ADMIN_RUNTIME */',()=>runtime));
console.log('Built mobile admin page (no secret key, server-enforced access).');
