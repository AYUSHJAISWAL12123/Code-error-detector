const LANGS={
 js:{kw:'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static'.split(' '),lit:['true','false','null','undefined','NaN','Infinity'],line:'//',block:true,tpl:true},
 c:{kw:'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private new delete namespace using bool'.split(' '),lit:['NULL','true','false'],line:'//',block:true,pre:true},
 py:{kw:'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '),lit:['True','False','None'],line:'#',block:false,triple:true}
};
const SAMPLES={
js:'function greet(name) {\n  var msg = "Hello, + name\n  if (name = "admin") {\n    console.log("Welcome")\n  }\n  return msg;\n\nlet arr = [1, 2, 3);\n',
c:'#include <stdio.h>\n\nint main() {\n    int a = 5\n    if (a = 5) {\n        printf("hi);\n    }\n    return 0;\n',
py:'def add(a, b)\n    return a + b\n\nx = 10\nif x = 10:\n    print "ok"\n  y = 5\n'
};
const $=id=>document.getElementById(id);
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const RE={ws:/\s+/y,num:/0[xX][\da-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+/y,id:/[A-Za-z_$][\w$]*/y,
 op:/===|!==|==|!=|<=|>=|=>|\+\+|--|&&|\|\||<<|>>|[+\-*\/%&|^]=|[+\-*\/%=<>!&|^~?:.]/y,br:/[()\[\]{};,]/y};
function m(re,s,i){re.lastIndex=i;return re.exec(s)}

/* ---------- 1. LEXER ---------- */
function lex(src,L){
  const T=[],E=[],n=src.length;let i=0;
  const starts=[0];for(let k=0;k<n;k++)if(src[k]==='\n')starts.push(k+1);
  const lineOf=x=>{let a=0,b=starts.length-1;while(a<b){const mid=(a+b+1)>>1;if(starts[mid]<=x)a=mid;else b=mid-1}return a+1};
  const add=(t,s,bad)=>{const k={t,s,i,ln:lineOf(i),eln:lineOf(i+Math.max(s.length-1,0))};if(bad)k.bad=1;T.push(k);i+=s.length;return k};
  const err=(msg,tok)=>E.push({sev:'e',msg,tok});
  while(i<n){
    let r;const c=src[i];
    if(r=m(RE.ws,src,i)){i+=r[0].length;continue}
    if(L.pre&&c==='#'&&/^[ \t]*$/.test(src.slice(starts[lineOf(i)-1],i))){let e=src.indexOf('\n',i);if(e<0)e=n;add('pre',src.slice(i,e));continue}
    if(src.startsWith(L.line,i)){let e=src.indexOf('\n',i);if(e<0)e=n;add('com',src.slice(i,e));continue}
    if(L.block&&src.startsWith('/*',i)){let e=src.indexOf('*/',i+2);if(e<0){const k=add('com',src.slice(i),1);err('Unterminated block comment — missing */',k)}else add('com',src.slice(i,e+2));continue}
    if(L.triple&&(src.startsWith('"""',i)||src.startsWith("'''",i))){const q=src.substr(i,3);let e=src.indexOf(q,i+3);
      if(e<0){const k=add('str',src.slice(i),1);err('Unterminated triple-quoted string',k)}else add('str',src.slice(i,e+3));continue}
    if(c==='"'||c==="'"||(L.tpl&&c==='`')){let j=i+1,ok=false;
      while(j<n){const ch=src[j];if(ch==='\\'){j+=2;continue}if(ch===c){ok=true;j++;break}if(ch==='\n'&&c!=='`')break;j++}
      if(j>n)j=n;
      if(ok)add('str',src.slice(i,j));else{const k=add('str',src.slice(i,j),1);err('Unterminated string literal — missing closing '+c,k)}continue}
    if(r=m(RE.num,src,i)){add('num',r[0]);continue}
    if(r=m(RE.id,src,i)){const w=r[0];add(L.kw.includes(w)?'kw':L.lit.includes(w)?'lit':'id',w);continue}
    if(r=m(RE.op,src,i)){add('op',r[0]);continue}
    if(r=m(RE.br,src,i)){add('p',r[0]);continue}
    const k=add('x',c,1);err('Unexpected character “'+c+'”',k);
  }
  return{T,E,lineOf,starts};
}

/* ---------- 2. SYNTAX CHECKS ---------- */
function analyze(src,lang){
  const L=LANGS[lang],{T,E,lineOf,starts}=lex(src,L);
  const code=T.filter(t=>t.t!=='com');
  const warn=(msg,tok)=>E.push({sev:'w',msg,tok});
  const bad=(msg,tok)=>E.push({sev:'e',msg,tok});

  // bracket matching with a stack
  const pairs={')':'(',']':'[','}':'{'},st=[];
  for(const t of code){if(t.t!=='p')continue;
    if('([{'.includes(t.s))st.push(t);
    else if(pairs[t.s]){const top=st.pop();
      if(!top){bad('Unmatched closing “'+t.s+'” — no opening bracket',t)}
      else if(top.s!==pairs[t.s]){bad('Mismatched bracket: “'+top.s+'” on line '+top.ln+' closed by “'+t.s+'”',t)}}}
  st.forEach(t=>bad('Unclosed “'+t.s+'” — missing closing bracket',t));

  // paren depth after each code token
  let d=0;code.forEach(t=>{if(t.s==='('||t.s==='[')d++;else if(t.s===')'||t.s===']')d=Math.max(0,d-1);t.d=d});

  // assignment inside condition
  if(lang!=='py'){
    code.forEach((t,k)=>{if(t.t==='kw'&&(t.s==='if'||t.s==='while')&&code[k+1]&&code[k+1].s==='('){
      let dep=0;for(let j=k+1;j<code.length;j++){const u=code[j];
        if(u.s==='(')dep++;else if(u.s===')'){dep--;if(!dep)break}
        else if(u.s==='='&&dep===1){warn('Assignment “=” inside condition — did you mean “==”?',u);break}}}});
  }

  if(lang!=='py'){
    // missing semicolon heuristic
    const ctl=['if','for','while','switch','function','catch','else','class','with'];
    code.forEach((t,k)=>{const nx=code[k+1];if(nx&&nx.ln<=t.eln)return;
      if(t.d!==0||t.t==='pre')return;
      const endsStmt=['id','num','str','lit'].includes(t.t)||t.s===')'||t.s===']'||t.s==='++'||t.s==='--';
      if(!endsStmt)return;
      let f=k;while(f>0&&code[f-1].eln>=t.ln)f--;
      if(code[f].t==='pre')return;
      if(t.s===')'&&ctl.includes(code[f].s))return;
      if(t.s===')'&&code.slice(f,k).some(u=>u.t==='kw'&&ctl.includes(u.s)&&u.s!=='function'&&u.s!=='class'))return;
      if(!nx){warn('Missing semicolon “;” at end of statement',t);return}
      if(nx.s==='{'||nx.s==='.'||nx.s==='?'||nx.s===':'||nx.s===','||nx.s===')'||nx.s===']'||nx.t==='op')return;
      if(nx.s==='}'&&t.s!==')')return;
      if(code.slice(f,k+1).some(u=>u.s==='=>'||u.s==='{'&&lang==='js'&&false))return;
      warn('Missing semicolon “;” at end of statement',t);
    });
  }else{
    // Python: group tokens by line
    const lines=[];let cur=null,depth=0;
    code.forEach(t=>{if(!cur||cur.ln!==t.ln){cur={ln:t.ln,toks:[],sd:depth};lines.push(cur)}cur.toks.push(t);depth=t.d});
    const blk=['if','elif','else','for','while','def','class','try','except','finally','with'];
    const stack=[0];let prev=null;
    for(const ln of lines){
      if(ln.sd>0)continue;
      const f=ln.toks[0],last=ln.toks[ln.toks.length-1];
      const text=src.slice(starts[ln.ln-1],f.i),ind=text.replace(/\t/g,'    ').length;
      if(/ /.test(text)&&/\t/.test(text))warn('Mixed tabs and spaces in indentation',f);
      if(prev){
        if(prev.colon&&ind<=prev.ind)bad('Expected an indented block after “:”',f);
        else if(!prev.colon&&ind>prev.ind)bad('Unexpected indent',f);
      }
      if(ind>stack[stack.length-1])stack.push(ind);
      else{while(stack.length&&stack[stack.length-1]>ind)stack.pop();
        if(stack[stack.length-1]!==ind){bad('Unindent does not match any outer indentation level',f);stack.push(ind)}}
      const hasColon=ln.toks.some(t=>t.s===':'&&t.d===0);
      if(f.t==='kw'&&blk.includes(f.s)&&ln.toks[ln.toks.length-1].d===0&&!hasColon)bad('Missing “:” at end of “'+f.s+'” statement',last);
      if(['if','elif','while'].includes(f.s)){const eq=ln.toks.find(t=>t.s==='='&&t.d===0);if(eq)bad('Use “==” for comparison, not “=” in a condition',eq)}
      ln.toks.forEach((t,k)=>{if(t.t==='id'&&t.s==='print'&&ln.toks[k+1]&&['str','id','num'].includes(ln.toks[k+1].t))bad('Missing parentheses in call to “print”',t)});
      prev={ind,colon:last.s===':'};
    }
  }

  // JavaScript: ask the real engine's parser as a final check
  if(lang==='js'&&!E.some(e=>e.sev==='e')&&src.trim()){
    try{new Function(src)}catch(e){E.push({sev:'e',msg:'Parser: '+e.message,tok:null,gen:true})}
  }
  E.forEach(e=>{if(e.tok){e.line=e.tok.ln;e.col=e.tok.i-starts[e.tok.ln-1]+1;if(e.sev==='e')e.tok.err=1;else e.tok.wrn=1}else{e.line=1;e.col=1}});
  E.sort((a,b)=>a.line-b.line||a.col-b.col);
  return{T,E,starts,lines:starts.length};
}

/* ---------- 3. HIGHLIGHTER ---------- */
function render(src,res,lang){
  const{T,E}=res,lnState={};
  E.forEach(e=>{if(lnState[e.line]!=='e')lnState[e.line]=e.sev});
  let html='',pos=0;
  const span=(txt,cls)=>txt.split('\n').map(p=>p?'<span class="'+cls+'">'+esc(p)+'</span>':'').join('\n');
  T.forEach((t,k)=>{
    html+=esc(src.slice(pos,t.i));
    let cls={kw:'kw',lit:'lit',str:'str',num:'num',com:'com',pre:'pre',op:'op',x:''}[t.t]||'';
    if(t.t==='id'){let j=k+1;const nx=T[j];if(nx&&nx.s==='('&&nx.i===t.i+t.s.length)cls='fn'}
    if(t.err)cls+=' bad';else if(t.wrn)cls+=' wrn';
    html+=cls?span(t.s,cls):esc(t.s);
    pos=t.i+t.s.length;
  });
  html+=esc(src.slice(pos));
  const rows=html.split('\n');
  $('in').innerHTML=rows.map((r,i)=>'<div class="l '+(lnState[i+1]||'')+'">'+(r||'&#8203;')+'</div>').join('');
  $('gut').innerHTML=rows.map((_,i)=>'<div class="'+(lnState[i+1]||'')+'">'+(lnState[i+1]?'●':'')+' '+(i+1)+'</div>').join('');
  sync();
  // problems
  const ne=E.filter(e=>e.sev==='e').length,nw=E.length-ne;
  let ph='<div class="pills"><span class="pill e">'+ne+' error'+(ne===1?'':'s')+'</span><span class="pill w">'+nw+' warning'+(nw===1?'':'s')+'</span></div>';
  ph+=E.length?E.map(e=>'<div class="item" data-l="'+e.line+'" data-c="'+e.col+'"><span class="dot '+e.sev+'"></span><div><div>'+esc(e.msg)+'</div><div class="loc">'+(e.gen?'whole file':'Line '+e.line+', Col '+e.col)+'</div></div></div>').join('')
    :'<div class="empty">✓ No problems detected</div>';
  $('prob').innerHTML=ph;
  // tokens
  const names={kw:'KEYWORD',lit:'LITERAL',id:'IDENTIFIER',num:'NUMBER',str:'STRING',op:'OPERATOR',p:'PUNCTUATION',com:'COMMENT',pre:'PREPROCESSOR',x:'UNKNOWN'};
  $('tok').innerHTML='<table><tr><th>Ln</th><th>Type</th><th>Lexeme</th></tr>'+T.slice(0,400).map(t=>'<tr><td>'+t.ln+'</td><td>'+names[t.t]+'</td><td>'+esc(t.s.length>40?t.s.slice(0,40)+'…':t.s.replace(/\n/g,'↵'))+'</td></tr>').join('')+'</table>';
  $('cnt').textContent=res.lines+' lines · '+T.length+' tokens · '+ne+' errors · '+nw+' warnings';
}
function sync(){const ta=$('ta');const tr='translate('+(-ta.scrollLeft)+'px,'+(-ta.scrollTop)+'px)';
  $('in').style.transform=tr;$('gut').firstElementChild&&($('gut').style.paddingTop='0');
  $('gut').innerHTML&&($('gut').style.transform='');
  $('gut').scrollTop=ta.scrollTop}
function run(){const src=$('ta').value,lang=$('lang').value;render(src,analyze(src,lang),lang)}
function caret(){const ta=$('ta'),b=ta.value.slice(0,ta.selectionStart).split('\n');$('pos').textContent='Ln '+b.length+', Col '+(b[b.length-1].length+1)}

/* ---------- events ---------- */
const ta=$('ta');
ta.addEventListener('input',()=>{run();caret()});
ta.addEventListener('scroll',sync);
['keyup','click'].forEach(e=>ta.addEventListener(e,caret));
ta.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const s=ta.selectionStart;ta.setRangeText('    ',s,ta.selectionEnd,'end');run()}});
$('lang').onchange=()=>{ta.value=SAMPLES[$('lang').value];run()};
$('sample').onclick=()=>{ta.value=SAMPLES[$('lang').value];run()};
$('clear').onclick=()=>{ta.value='';run();ta.focus()};
$('theme').onclick=()=>{const r=document.documentElement,dark=getComputedStyle(r).colorScheme.includes('dark');r.setAttribute('data-theme',dark?'light':'dark')};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===b));
  $('prob').classList.toggle('hide',b.dataset.t!=='prob');$('tok').classList.toggle('hide',b.dataset.t!=='tok')});
$('prob').addEventListener('click',e=>{const it=e.target.closest('.item');if(!it)return;
  const l=+it.dataset.l,c=+it.dataset.c,idx=ta.value.split('\n').slice(0,l-1).reduce((a,s)=>a+s.length+1,0)+c-1;
  ta.focus();ta.setSelectionRange(idx,idx);ta.scrollTop=Math.max(0,(l-4)*21);sync();caret()});
ta.value=SAMPLES.js;run();caret();
