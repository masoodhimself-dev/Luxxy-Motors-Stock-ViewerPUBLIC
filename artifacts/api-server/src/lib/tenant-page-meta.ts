const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
/** Replace fallback metadata before JavaScript executes; never interpolate raw dealer content. */
export function tenantPageHtml(html:string,name:string,city:string){
 const title=escape(`${name} — Used cars${city?` in ${city}`:''}`);
 const description=escape(`Browse the current used car stock at ${name}${city?` in ${city}`:''}. View photos, specifications and prices.`);
 return html.replace(/<title>[\s\S]*?<\/title>/i,()=>`<title>${title}</title>`)
 .replace(/<meta\s+([^>]*?)content="[^"]*"([^>]*)>/gi,(tag,a,b)=>{
  const attrs=a+b;
  if(/(?:name|property)="(?:og:site_name)"/i.test(attrs))return `<meta ${a}content="${escape(name)}"${b}>`;
  if(/(?:name|property)="(?:og:title|twitter:title)"/i.test(attrs))return `<meta ${a}content="${title}"${b}>`;
  if(/(?:name|property)="(?:description|og:description|twitter:description)"/i.test(attrs))return `<meta ${a}content="${description}"${b}>`;
  return tag;
 });
}
