// Report Studio rewrites a line of the partner's report when one of its
// corrections changes it (sample ID, typo list). Two kinds of error got
// through to clients:
//  - Question marks. The partner's own PDF already prints "?" where its
//    software could not write a character: "?2-adrenergic" (beta), "outcomes ?
//    either" (a dash), "gene?diet" (a hyphen), "individual?s" (an apostrophe).
//    Report Studio only fixes the few it lists word for word, so the rest
//    reached the client.
//  - Spelling and grammar slips in the partner's text that are not on the
//    tool's typo list ("Resiliant", "You maybe", "High likely" ...).
// Before serving the tool, the LIMS wraps its correction step (the function
// that applies the typo list to each line) so that every line also gets:
//  1. the lost characters put back, by rule, wherever the meaning is clear,
//  2. the extra corrections below (spaces in them match any run of spaces),
//  3. when the line is rewritten, characters Montserrat lacks (Greek letters,
//     the non-breaking hyphen, odd spaces) spelled out, instead of the tool
//     printing "?" for them.
// These apply whatever corrections are saved in the tool's settings.
// The tool is minified, so its correction step is found by shape. If a new
// version changes it, the wrap is skipped and the tool works as before.

// Extra corrections, [what the partner's report says, what to print].
// Matched only as whole words, like the tool's own list.
const FIXES = [
  ['Resiliant', 'Resilient'],
  ['You maybe slightly', 'You may be slightly'],
  ['Slightly Increased risk', 'Slightly increased risk'],
  ['High likely to', 'Highly likely to'],
  ['appetite control, leading less', 'appetite control, leading to less'],
  ['body clock and disrupting', 'body clock and disrupted'],
  ['needs to further investigated', 'needs to be further investigated'],
  ['some of which has been attributed', 'some of which have been attributed'],
  ['metabolism.In anaerobic', 'metabolism. In anaerobic'],
  ['with the muscles ability', "with the muscles' ability"],
  ['physical overloading is one of', 'physical overloading are one of'],
  ['glutamate that produces the', 'glutamate that produce the'],
  ['near these genes increases risk', 'near these genes increase risk'],
  ['The MC4R -Melanocortin receptor gene', 'The MC4R (melanocortin 4 receptor) gene'],
  ['warm-up ,', 'warm-up,'],
  ['region : Human', 'region: Human'],
  // From a Fitness report (MDP00020260051), 11 Nov 2026
  ['(?-carotene 15,15?-monooxygenase', '(beta-carotene 15,15\u2032-monooxygenase'],
  ['Vitamin A fortified crap (steal from Vit D).', 'Vitamin A-fortified foods, such as breakfast cereals and milk.'],
  ['4. vegetables like broccoli', '4. Vegetables like broccoli'],
  ['salmon, Mackerel, herring', 'salmon, mackerel, herring'],
  ['eggs are also good source of', 'eggs are also good sources of'],
  ['one of the abundant minerals', 'one of the most abundant minerals'],
  ['belongs to a immunoglobulin', 'belongs to an immunoglobulin'],
  ['Prostate specific antigen (PSA), is', 'Prostate-specific antigen (PSA) is'],
  ['non insulin dependent', 'non-insulin-dependent'],
  ['pain and Enhanced', 'pain and enhanced'],
];

// Greek letters and other characters missing from the tool's Montserrat.
const GLYPHS = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  ν: 'nu', ξ: 'xi', ο: 'o', ρ: 'rho', σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', ψ: 'psi', ω: 'omega',
  Α: 'A', Β: 'B', Γ: 'Gamma', Ε: 'E', Ζ: 'Z', Η: 'H', Θ: 'Theta', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ξ: 'Xi', Ο: 'O',
  Π: 'Pi', Ρ: 'P', Σ: 'Sigma', Τ: 'T', Υ: 'Y', Φ: 'Phi', Ψ: 'Psi',
  '\u2011': '-', '\u2010': '-', '\u00ad': '',
};

// Runs in the browser, inside the tool. Kept to plain ES2020.
const REPAIR = String.raw`var mdpFixes=__FIXES__.map(function(f){
 var w=/[A-Za-z0-9]/;var re=f[0].replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&").replace(/ +/g,"\\s+");
 return{re:new RegExp((w.test(f[0][0])?"(?<![A-Za-z0-9])":"")+re+(w.test(f[0].slice(-1))?"(?![A-Za-z0-9])":""),"g"),to:f[1]}});
var mdpGlyphs=__GLYPHS__;
function mdpRepairText(s){
 if(typeof s!=="string"||!s)return s;
 s=s.replace(/\uFFFD/g,"?");
 if(s.indexOf("?")>=0){
  /* beta-adrenergic receptors (ADRB1, ADRB2, ADRB3) */
  s=s.replace(/\?([1-3])-adrenergic/g,"beta-$1 adrenergic");
  /* a dash between words: "outcomes ? either" */
  s=s.replace(/(\S) +\? +(?=[a-z(])/g,"$1 \u2013 ");
  /* inside a word: an apostrophe before s/t/d/ll/re/ve/m at its end, a hyphen otherwise. Web addresses are left alone. */
  s=s.replace(/\S+/g,function(w){return /[\/=&]|www\./i.test(w)?w:w.replace(/([A-Za-z])\?(s|t|d|ll|re|ve|m)(?![A-Za-z])/g,"$1\u2019$2").replace(/([A-Za-z])\?(?=[A-Za-z])/g,"$1-")});
 }
 for(var i=0;i<mdpFixes.length;i++)s=s.replace(mdpFixes[i].re,mdpFixes[i].to);
 return s}
function mdpSafeGlyphs(s){
 return typeof s!=="string"?s:s.replace(/[\u0370-\u03ff\u2010\u2011\u00ad]/g,function(c){return c in mdpGlyphs?mdpGlyphs[c]:c})
  .replace(/[\u2000-\u2006\u2028\u2029\u202f\u205f]/g," ").replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g,"")}
`;

// The tool's correction step: function X(e,t){let r=e;for(let n of t){...}return r}
const APPLY_RE = /function ([\w$]+)\(e,t\)\{let r=e;(for\(let n of t\)\{if\(!n\|\|!n\.find\|\|n\.find===n\.replace\)continue;[\s\S]{0,800}?r=a\+r\.slice\(i\)\})return r\}/;

const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function patchText(text) {
  if (!APPLY_RE.test(text)) return text;
  const code = REPAIR.replace('__FIXES__', () => js(FIXES)).replace('__GLYPHS__', () => js(GLYPHS));
  return text.replace(APPLY_RE, (m, name, body) => `${code}function ${name}(e,t){const e0=e;e=mdpRepairText(e);let r=e;${body}return r!==e0?mdpSafeGlyphs(r):r}`);
}

module.exports = { patchText, FIXES, APPLY_RE };
