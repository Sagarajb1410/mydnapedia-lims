// Report Studio reads a counselling form filled in Word. Its own reader only
// accepts the form exactly as first issued (18 tables, the lifestyle table
// fifth), so a form whose layout was updated in Word was refused. Before
// serving the tool, the LIMS swaps in a reader that finds each part of the form
// by its heading (A3, A4, B, C, E1, E2, E4 ...) and ignores added sections.
// If a new version of the tool changes these pieces, the swap is skipped.
const FIND = "let n=Mm(r),i=n.findIndex(R=>R[0]&&/parameter/i.test(R[0][0]||\"\")&&R[0].some(B=>/response/i.test(B)));if(n.length!==18||i!==4)throw new Error(\"This document is not the MyDNAPedia counselling form (or its tables were changed), so it cannot be read.\");";

const READER = String.raw`function mdpFormTables(r){
let body=r.slice(Math.max(0,r.indexOf("<w:body")));
/* Paragraphs and top-level tables in document order (a table inside a table stays part of its cell). */
let items=[],re=/<w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g,m;
while(m=re.exec(body)){
 if(m[0]==="<w:tbl>"){let d=1,i=re.lastIndex,t=/<w:tbl>|<\/w:tbl>/g;t.lastIndex=i;let x;while(d&&(x=t.exec(body)))d+=x[0]==="<w:tbl>"?1:-1;let end=x?t.lastIndex:body.length;
  let xml=body.slice(m.index,end),flat="<w:tbl>"+xml.slice(7,-8).replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g,y=>y.slice(7,-8).replace(/<\/?w:t(r|c|blPr|blGrid)\b[^>]*>/g,""))+"</w:tbl>";
  /* Word may wrap cells in content controls, or add attributes to rows and cells. */
  flat=flat.replace(/<w:tc [^>]*>/g,"<w:tc>");
  let rows=Mm(flat)[0]||[];items.push({t:rows,txt:rows.flat().join(" ")});re.lastIndex=end}
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

const FORM_PATCHES = [
  [FIND, 'let n=mdpFormTables(r);'],
  ['async function vc(e){let t,r;', READER.replace(/\n/g, '') + 'async function vc(e){let t,r;'],
];

module.exports = { FORM_PATCHES };
