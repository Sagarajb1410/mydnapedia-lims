// Report Studio reads a counselling form filled in Word. Its own reader only
// accepts the form exactly as first issued (18 tables, the lifestyle table
// fifth), so a form whose layout was updated in Word was refused. Before
// serving the tool, the LIMS swaps in a reader that finds each part of the form
// by its heading (A3, A4, B, C, E1, E2, E4 ...) and ignores added sections.
// The tool is minified, so its own names differ between builds (the 360 and
// Skin Health copies); the pieces are found by their shape, not their names.
// If a new version of the tool changes them, the swap is skipped.
const FIND = /let n=([\w$]+)\(r\),i=n\.findIndex\(R=>R\[0\]&&\/parameter\/i\.test\(R\[0\]\[0\]\|\|""\)&&R\[0\]\.some\(B=>\/response\/i\.test\(B\)\)\);if\(n\.length!==18\|\|i!==4\)throw new Error\("[^"]*"\);/;
const READ_DOCX = /async function [\w$]+\(e\)\{let t,r;try\{t=await [\w$]+\.default\.loadAsync\(e\)/;

const READER = String.raw`function mdpFormTables(r){
let body=r.slice(Math.max(0,r.indexOf("<w:body")));
/* Paragraphs and top-level tables in document order (a table inside a table stays part of its cell). */
let items=[],re=/<w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g,m;
while(m=re.exec(body)){
 if(m[0]==="<w:tbl>"){let d=1,i=re.lastIndex,t=/<w:tbl>|<\/w:tbl>/g;t.lastIndex=i;let x;while(d&&(x=t.exec(body)))d+=x[0]==="<w:tbl>"?1:-1;let end=x?t.lastIndex:body.length;
  let xml=body.slice(m.index,end),flat="<w:tbl>"+xml.slice(7,-8).replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g,y=>y.slice(7,-8).replace(/<\/?w:t(r|c|blPr|blGrid)\b[^>]*>/g,""))+"</w:tbl>";
  /* Word may wrap cells in content controls, or add attributes to rows and cells. */
  flat=flat.replace(/<w:tc [^>]*>/g,"<w:tc>");
  let rows=__TABLES__(flat)[0]||[];items.push({t:rows,txt:rows.flat().join(" ")});re.lastIndex=end}
 else{let txt=(m[0].match(/<w:t(?:\s[^>]*)?>[^<]*/g)||[]).map(y=>y.replace(/<w:t[^>]*>/,"")).join("").replace(/&amp;/g,"&");if(txt.trim())items.push({p:txt})}
}
let T=items.filter(x=>x.t).map(x=>x.t);
let after=(rx,skip)=>{let i=items.findIndex(x=>rx.test(x.p!=null?x.p:x.txt));if(i<0)return null;for(let j=i+1;j<items.length;j++)if(items[j].t){if(skip&&skip(items[j]))continue;return items[j].t}return null};
let own=rx=>(items.find(x=>x.t&&rx.test(x.txt))||{}).t||null;
let isHead=x=>x.t.length===1&&x.t[0].length===1&&/^\s*[A-Z]\.\s/.test(x.t[0][0]||"");
let n=[];
n[1]=own(/patient\s*name/i);
n[3]=own(/height/i)&&own(/weight/i);
n[4]=(items.find(x=>x.t&&x.t[0]&&/parameter/i.test(x.t[0][0]||"")&&x.t[0].some(B=>/response/i.test(B)))||{}).t||null;
n[5]=after(/^\s*A3\b/i);
n[6]=after(/any other\s*\/?\s*details/i);
n[7]=after(/^\s*A4\b/i,isHead);
n[9]=after(/^\s*B\.\s*family/i);
n[11]=after(/^\s*C\.\s*genetic/i);
n[13]=after(/^\s*E1\b/i);
n[14]=after(/^\s*E2\b/i);
n[15]=after(/^\s*E4\b/i);
n[16]=after(/others?\s*-\s*specify/i);
n[17]=own(/genetic counsellor/i);
/* An unchanged form: fall back to the original positions for anything not found by heading. */
if(T.length===18)for(let k of[1,3,4,5,6,7,9,11,13,14,15,16,17])n[k]=n[k]||T[k];
let missing=[];if(!n[1])missing.push("Patient details");if(!n[4])missing.push("A2 Lifestyle (Parameter / Response table)");
if(missing.length)throw new Error("This document is not the MyDNAPedia counselling form, so it cannot be read. Missing: "+missing.join(", ")+".");
for(let k=0;k<18;k++)n[k]=n[k]||[];
if(!n[3].length)n[3]=[[],[]];
if(!n[4][0])n[4]=[[]];
return n}
`;

// A counselling form filled in Word and saved as PDF. The PDF keeps the text
// but not the tables, so the form's parts are rebuilt from where the text sits
// (headings, columns, rows) as a minimal Word document, which then goes through
// the same reader as a .docx. A scanned or handwritten form has no text and is
// refused. Reading happens in the browser with the tool's own PDF library.
const OPEN_PDF = /function ([\w$]+)\(e\)\{let t=[\w$]+\.openDocument\(e,"application\/pdf"\)/;
const PAGE_LINES = /function ([\w$]+)\(e\)\{let t=e\.getBounds\(\),r=\{w:t\[2\]-t\[0\],h:t\[3\]-t\[1\],lines:\[\],images:\[\]\}/;
const PDF_READER = String.raw`function mdpFormPdfXml(bytes){let NL=String.fromCharCode(10);
let doc=__OPEN__(bytes),L=[],N=doc.countPages();
for(let i=0;i<N;i++){let pg=__LINES__(doc.loadPage(i));for(let l of pg.lines){let t=l.text.replace(/\s+/g," ").trim();if(!t||l.y<pg.h*0.06||l.y>pg.h*0.95)continue;L.push({t,x:l.x0,y:i*10000+l.y,size:l.size,bold:l.bold})}}
if(!L.length)throw new Error("This PDF has no readable text (a scan or a photo?). Load the form saved from Word, or type the answers on this tab.");
L.sort((a,b)=>a.y-b.y||a.x-b.x);
/* Lines at the same height make one row. */
let rows=[];for(let l of L){let r=rows[rows.length-1];if(r&&Math.abs(r.y-l.y)<3)r.c.push(l);else rows.push({y:l.y,c:[l]})}
let first=r=>r.c[0].t;
let PARA=/^(A\d\.\s|E\d\.\s|Any other \/ details$|Others - specify$|Genetic Counselling Session$|Personal & Family History Intake|Auto-filled from|BMI is derived|Enter the option|Tick every|Standard closing|Disclaimer:)/i;
let HEAD=/^(Patient Details|[A-E]\.\s+\S.*)$/;
let items=[],block=null,stop=false;
let close=()=>{if(block){items.push({rows:block});block=null}};
for(let r of rows){let t=first(r),one=r.c.length===1,lastIt=items[items.length-1];
 /* A wrapped heading (bold) or instruction (until its full stop) goes on its own line. */
 if(one&&!block&&lastIt&&lastIt.y&&!PARA.test(t)&&!HEAD.test(t)&&r.y-lastIt.y<r.c[0].size*2.2&&((r.c[0].bold&&lastIt.bold)||(lastIt.p&&!lastIt.bold&&!/\.$/.test(lastIt.p)))){if(lastIt.p)lastIt.p+=" "+t;else lastIt.head+=" "+t;lastIt.y=r.y;continue}
 if(/^E6\.\s/i.test(t)){close();items.push({p:t});stop=true;continue}
 if(stop&&!/^Genetic Counsellor/i.test(t)&&!block)continue;
 if(stop&&/^Disclaimer:/i.test(t)){close();break}
 if(one&&PARA.test(t)){close();items.push({p:t,y:r.y,bold:r.c[0].bold});continue}
 if(one&&r.c[0].bold&&HEAD.test(t)){close();items.push({head:t,y:r.y,bold:true});continue}
 (block=block||[]).push(r)}
close();
/* Rows of a block become table rows; columns come from its first row. */
let esc=v=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
let cellXml=v=>"<w:tc><w:p><w:r><w:t xml:space='preserve'>"+String(v).split(NL).map(esc).join("</w:t><w:br/><w:t xml:space='preserve'>")+"</w:t></w:r></w:p></w:tc>";
let tbl=rs=>"<w:tbl>"+rs.map(r=>"<w:tr>"+r.map(cellXml).join("")+"</w:tr>").join("")+"</w:tbl>";
let table=b=>{let head=b[0].c;if(head.length===1)return[[b.map(r=>r.c.map(c=>c.t).join(" ")).join(NL)]];
 let starts=head.map(c=>c.x),col=x=>{let k=0;starts.forEach((s,i)=>{if(x>=s-6)k=i});return k};
 let key=Math.max(0,head.findIndex(c=>/^field$/i.test(c.t))),out=[];
 for(let r of b){let cells=starts.map(()=>""),ks=new Set;for(let c of r.c){let k=col(c.x);cells[k]=cells[k]?cells[k]+" "+c.t:c.t;ks.add(k)}
  let prev=out[out.length-1],open=prev&&/[\/,(&-]$|\([^)]*$/.test(prev[key]||"");
  if(prev&&r!==b[0]&&(open||!ks.has(key)&&!(key===0&&ks.has(0))))cells.forEach((v,k)=>{if(v)prev[k]=prev[k]?prev[k]+" "+v:v});else out.push(cells)}
 return out};
let xml="<w:body>",last=null;
let isHeading=it=>it.head||/^(A\d|E\d|Any other|Others)/i.test(it.p);
for(let it of items){
 if(it.rows){xml+=tbl(table(it.rows));last="t";continue}
 /* An empty answer box leaves no text: keep its place between two headings. */
 if(last==="h"&&isHeading(it))xml+=tbl([[""]]);
 if(!isHeading(it)&&!it.head){xml+="<w:p><w:r><w:t xml:space='preserve'>"+esc(it.p)+"</w:t></w:r></w:p>";continue}
 if(it.head){xml+=tbl([[it.head]]);last="h"}else{xml+='<w:p><w:r><w:t xml:space="preserve">'+esc(it.p)+"</w:t></w:r></w:p>";last=/^(A\d|E\d|Any other|Others)/i.test(it.p)?"h":"p"}}
return xml+"</w:body>"}
`;

function patchForm(text) {
  const m = FIND.exec(text);
  const at = READ_DOCX.exec(text);
  if (m && at) {
    const reader = READER.replace(/\n/g, '').replace('__TABLES__', () => m[1]);
    text = text.replace(FIND, 'let n=mdpFormTables(r);');
    text = text.replace(READ_DOCX, (x) => reader + x);
  }
  // Forms saved as PDF go through the same reader.
  if (!text.includes('let n=mdpFormTables(r);') || text.includes('function mdpFormPdfXml')) return text;
  const open = OPEN_PDF.exec(text);
  const lines = PAGE_LINES.exec(text);
  if (!open || !lines) return text;
  const pdf = PDF_READER.replace(/\n/g, '').replace('__OPEN__', () => open[1]).replace('__LINES__', () => lines[1]);
  return text
    .replace(/(async function [\w$]+\(e\)\{let t,r;try\{)(t=await [\w$]+\.default\.loadAsync\(e\))/, (m, a, b) => `window.__mdpFormPdfXml=b=>mdpFormPdfXml(b);window.__mdpReadForm=b=>${/function ([\w$]+)/.exec(a)[1]}(b);${pdf}${a}if(e[0]===37&&e[1]===80&&e[2]===68&&e[3]===70)r=mdpFormPdfXml(e);else ${b}`)
    .replace('catch{throw new Error("That file is not a Word document (.docx).")}', 'catch(x){throw new Error(/no readable text/.test(x&&x.message)?x.message:"That file is not the counselling form in Word (.docx) or PDF.")}')
    .replace('Load a form filled in Word (.docx)', 'Load a filled form (Word or PDF)')
    .replace(/(id="w-import" accept=")/, '$1.pdf,application/pdf,');
}

module.exports = { patchForm };
