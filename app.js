// Lattice landing: a small real-time ordered-dither renderer (WebGL1) and the page's interactions.
// Every canvas.dither renders a scene at "cell" resolution, then CSS scales it up with pixelated sampling,
// so one fragment = one dither cell. Each cell is thresholded against an 8x8 Bayer matrix into 3 inks.
(()=>{
'use strict';
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const THEMES={
  dark:{ink:[11,12,14],paper:[236,234,226],accent:[62,99,255]},
  light:{ink:[222,219,208],paper:[11,12,14],accent:[62,99,255]},
};
const HEADER=`precision highp float;
uniform vec2 uRes;uniform float uT;uniform vec2 uMouse;uniform float uHover;uniform float uU1;uniform float uU2;uniform sampler2D uSrc;
uniform vec3 uInk,uPaper,uAccent;
float bayer2(vec2 a){a=floor(a);return fract(dot(a,vec2(.5,a.y*.75)));}
float bayer4(vec2 a){return bayer2(.5*a)*.25+bayer2(a);}
float bayer8(vec2 a){return bayer4(.5*a)*.25+bayer2(a);}
float hash3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float seg(vec2 p,vec2 a,vec2 b,out float h){vec2 pa=p-a,ba=b-a;h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
`;
const MAIN=`
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 s=scene(uv);
  float th=bayer8(gl_FragCoord.xy)+.0078;
  vec3 c=s.y>th?uAccent:(s.x>th?uPaper:uInk);
  gl_FragColor=vec4(c/255.,1.);
}`;

const SCENES={
  // A raymarched 3D lattice: the camera flies through it; some nodes pulse in the accent ink.
  lattice:{cell:3,glsl:`
float mapL(vec3 p,out float node){
  p*=1.7;
  vec3 q=fract(p)-.5;
  float s=length(q)-.15;
  float r=min(min(length(q.yz),length(q.xz)),length(q.xy))-.022;
  node=step(s,r);
  return min(s,r)/1.7;
}
vec2 scene(vec2 uv){
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec3 ro=vec3(0.,.02,uT*.14);
  vec3 rd=normalize(vec3(p,1.));
  rd.yz*=rot(.16-uMouse.y*.28);
  rd.xz*=rot(uMouse.x*.55+.22*sin(uT*.06));
  float d=0.,node=0.,hit=0.;vec3 pos=ro;
  for(int i=0;i<84;i++){pos=ro+rd*d;float h=mapL(pos,node);if(h<.002){hit=1.;break;}d+=h;if(d>15.)break;}
  if(hit<.5)return vec2(0.);
  float nd;vec2 e=vec2(.002,0.);
  vec3 n=normalize(vec3(mapL(pos+e.xyy,nd)-mapL(pos-e.xyy,nd),mapL(pos+e.yxy,nd)-mapL(pos-e.yxy,nd),mapL(pos+e.yyx,nd)-mapL(pos-e.yyx,nd)));
  float diff=max(0.,dot(n,normalize(vec3(.45,.75,-.48))));
  float rim=pow(1.-max(0.,-dot(n,rd)),2.);
  float fog=exp(-d*.42);
  float lum=pow(clamp((.1+.85*diff+.4*rim)*fog,0.,1.),1.2);
  float acc=0.;
  if(node>.5){
    vec3 id=floor(pos*1.7);float h=hash3(id);
    // a wave of "approvals" travels forward through the lattice
    float wave=smoothstep(.85,1.,sin(id.z*.9-uT*1.1+h*2.)*.5+.5);
    if(h>.72)acc=(.2+.85*max(wave,.5+.5*sin(uT*1.5+h*40.)*.6))*fog*(.55+diff);
  }
  float shade=(1.-smoothstep(.42,.78,uv.x))*(1.-smoothstep(.76,.9,uv.y));
  float k=mix(.16,mix(1.,.04,shade*shade*(3.-2.*shade)),uU1)*.9;
  return vec2(lum*k,acc*mix(.55,1.,1.-shade*.8));
}`},
  // The moment of "yes": rings radiate from a point; a burst when the draft is saved.
  ripple:{cell:3,glsl:`
vec2 scene(vec2 uv){
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec2 o=vec2(-.28,.12)+uMouse*.07;
  float d=length(p-o);
  float rings=0.;
  for(int i=0;i<4;i++){float r=fract(uT*.22+float(i)*.25)*1.6;rings+=smoothstep(.035,0.,abs(d-r))*(1.-r/1.6);}
  float grid=(mod(gl_FragCoord.x,8.)<1.&&mod(gl_FragCoord.y,8.)<1.)?.35:0.;
  float lum=clamp(rings*.75+.16*exp(-d*3.)+grid*.4+uHover*.06,0.,1.);
  float core=smoothstep(.09,0.,d)*(.55+.35*sin(uT*3.));
  float burst=uU1*smoothstep(.07,0.,abs(d-(1.-uU1)*1.1))*1.2;
  return vec2(lum,max(core,burst));
}`},
  // Borrowing: a skill streams out to three teammates' agents; the active stream lights up.
  flow:{cell:3,glsl:`
vec2 scene(vec2 uv){
  float asp=uRes.x/uRes.y;
  vec2 p=gl_FragCoord.xy/uRes.y;
  vec2 a=vec2(.2*asp,.5)+uMouse*.03;
  float lum=(mod(gl_FragCoord.x,8.)<1.&&mod(gl_FragCoord.y,8.)<1.)?.14:0.;
  float acc=0.;
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 b=vec2(.42*asp,.745-fi*.245);
    float h;float d=seg(p,a,b,h);
    float on=1.-step(.5,abs(uU1-fi));
    float line=smoothstep(.007,0.,d);
    float dash=step(.55,fract(h*9.-uT*(1.2+on*1.6)));
    lum=max(lum,line*(.28+.25*on));
    acc=max(acc,line*dash*(.25+.8*on));
    float tb=length(p-b);
    lum=max(lum,smoothstep(.022,.0,tb)*.9);
    acc=max(acc,on*smoothstep(.05,.0,abs(tb-.04-.02*sin(uT*4.)))*.8);
  }
  float da=length(p-a);
  lum=max(lum,smoothstep(.06,.0,da)*.95+.12*exp(-da*6.));
  lum=max(lum,smoothstep(.012,0.,abs(da-.085-.015*sin(uT*2.)))*.6);
  acc=max(acc,smoothstep(.035,0.,da));
  return vec2(lum+uHover*.04,acc);
}`},
  // Builder: each pinned child is a slab; the composed skill sits on top in the accent ink.
  stack:{cell:3,glsl:`
float slab(vec2 p,vec2 c,float hw,float th,out float face){
  vec2 q=p-c;float w=1.-abs(q.x)/hw;face=0.;
  if(w<0.)return 0.;
  float hh=hw*.5;
  float top=hh*w,bot=-hh*w;
  if(q.y>top||q.y<bot-th)return 0.;
  if(q.y>=bot){face=3.;return 1.;}
  face=q.x<0.?2.:1.;return 1.;
}
vec2 scene(vec2 uv){
  float n=uU1;
  vec2 p=(gl_FragCoord.xy-vec2(.5*uRes.x,(.5-min(n,12.)*.026)*uRes.y))/uRes.y;
  p.y+=.06;
  p.x-=uMouse.x*.02;
  float hw=min(.34,.42*uRes.x/uRes.y);
  float th=.034;
  float gap=min(.075,.52/max(n+1.,1.));
  float lum=0.,acc=0.;
  // floor grid
  vec2 g=vec2(p.x/hw+p.y/(hw*.5),-p.x/hw+p.y/(hw*.5));
  if(p.y<0.&&abs(g.x)<1.6&&abs(g.y)<1.6){vec2 f=abs(fract(g*4.)-.5);if(min(f.x,f.y)<.04)lum=.18;}
  // draw from top to bottom: first hit wins
  float found=0.;
  float total=floor(n)+1.;
  for(int i=13;i>=0;i--){
    float fi=float(i);
    if(found>.5)break;
    bool isTop=fi>=ceil(n-.001);
    if(fi>ceil(n-.001))continue;
    float drop=isTop?0.:(1.-clamp(n-fi,0.,1.))*.5;
    float y=(isTop?max(n,0.):fi)*gap+drop+(isTop?(1.-clamp(n-floor(n),0.,1.))*0.:0.);
    float face;
    float hit=slab(p,vec2(0.,y),hw,th,face);
    if(hit>.5){
      found=1.;
      float shade=face>2.5?.82:face>1.5?.5:.3;
      if(isTop){
        shade=face>2.5?.95:face>1.5?.6:.42;
        acc=shade*(.75+.25*sin(uT*2.))+uHover*.6;
        lum=shade;
      }else{
        float h=hash2(vec2(fi,3.));
        lum=shade*(.82+.18*h);
        if(face>2.5){vec2 q=p-vec2(0.,y);if(abs(q.y)<.004&&abs(q.x)<hw*.6)lum=.15;}
      }
    }
  }
  if(found<.5&&n<.01){
    float face;float hit=slab(p,vec2(0.,0.),hw,th,face);
    if(hit>.5)lum=max(lum,.12);
  }
  return vec2(lum,acc);
}`},
  // Any video/canvas: luminance drives paper, blue-ish pixels become the accent ink.
  video:{cell:4,hoverCell:2,source:'video',glsl:`
vec2 scene(vec2 uv){
  vec3 c=texture2D(uSrc,uv).rgb;
  float a=clamp((c.b-c.r-.12)*2.,0.,1.);
  float l=dot(c,vec3(.299,.587,.114));
  return vec2(l*(1.-a)*1.1,a);
}`},
  // The footer wordmark: text rendered to a texture, lit by a dithered spotlight that follows the cursor.
  wordmark:{cell:3,source:'text',glsl:`
vec2 scene(vec2 uv){
  float a=texture2D(uSrc,uv).a;
  float asp=uRes.x/uRes.y;
  vec2 p=gl_FragCoord.xy/uRes.y;
  vec2 m=(uMouse*.5+.5)*vec2(asp,1.);
  float d=length((p-m)*vec2(1.,1.4));
  float light=exp(-d*d*5.)*uHover;
  float wave=.5+.5*sin(p.x*5.-uT*1.1+p.y*2.5);
  float lum=a*(.2+.3*wave+.7*light)+(1.-a)*light*.1;
  float acc=a*smoothstep(.15,.6,light)*.95;
  return vec2(lum,acc);
}`},
};

// ---------- renderer ----------
function compile(gl,src,type){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}

class Dither{
  constructor(canvas){
    this.canvas=canvas;this.name=canvas.dataset.scene;this.def=SCENES[this.name];
    const gl=canvas.getContext('webgl',{antialias:false,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'high-performance'});
    if(!gl)throw new Error('webgl');
    this.gl=gl;
    const prog=gl.createProgram();
    gl.attachShader(prog,compile(gl,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',gl.VERTEX_SHADER));
    gl.attachShader(prog,compile(gl,HEADER+this.def.glsl+MAIN,gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    this.u={};for(const k of ['uRes','uT','uMouse','uHover','uU1','uU2','uSrc','uInk','uPaper','uAccent'])this.u[k]=gl.getUniformLocation(prog,k);
    const theme=THEMES[canvas.dataset.theme||'dark'];
    gl.uniform3fv(this.u.uInk,theme.ink);gl.uniform3fv(this.u.uPaper,theme.paper);gl.uniform3fv(this.u.uAccent,theme.accent);
    if(this.def.source){
      this.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
      gl.uniform1i(this.u.uSrc,0);
    }
    if(this.def.source==='video')this.video=document.getElementById(canvas.dataset.src);
    this.cell=this.def.cell;this.mouse=[0,0];this.mouseT=[0,0];this.hover=0;this.hoverT=0;
    this.u1=0;this.u1T=0;this.u1V=0;this.flash=0;this.visible=true;this.dirty=true;
    this.t0=performance.now();
  }
  resize(){
    const r=this.canvas.getBoundingClientRect();
    const w=Math.max(2,Math.round(r.width/this.cell)),h=Math.max(2,Math.round(r.height/this.cell));
    if(w!==this.canvas.width||h!==this.canvas.height){
      this.canvas.width=w;this.canvas.height=h;this.gl.viewport(0,0,w,h);
      if(this.def.source==='text')this.drawText();
      this.dirty=true;
    }
  }
  drawText(){
    const c=this.textCanvas||(this.textCanvas=document.createElement('canvas'));
    const w=this.canvas.width,h=this.canvas.height;c.width=w;c.height=h;
    const x=c.getContext('2d');x.clearRect(0,0,w,h);
    let size=h*1.05;x.font=`600 ${size}px Geist, system-ui, sans-serif`;
    const mw=x.measureText('lattice').width;size*=Math.min(1,(w*.98)/mw);
    x.font=`600 ${size}px Geist, system-ui, sans-serif`;
    x.textBaseline='alphabetic';x.fillStyle='#fff';
    if('letterSpacing' in x)x.letterSpacing=`${-size*.05}px`;
    const tw=x.measureText('lattice').width;
    x.fillText('lattice',(w-tw)/2,h*.78);
    this.upload(c);
  }
  upload(src){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.tex);try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);}catch{}}
  setCell(c){if(c!==this.cell){this.cell=c;this.resize();}}
  render(now){
    const gl=this.gl,t=(now-this.t0)/1000;
    if(this.video&&this.video.readyState>=2)this.upload(this.video);
    gl.uniform2f(this.u.uRes,this.canvas.width,this.canvas.height);
    gl.uniform1f(this.u.uT,reduce?8:t);
    gl.uniform2f(this.u.uMouse,this.mouse[0],this.mouse[1]);
    gl.uniform1f(this.u.uHover,this.hover);
    gl.uniform1f(this.u.uU1,this.u1);
    gl.uniform1f(this.u.uU2,this.flash);
    gl.drawArrays(gl.TRIANGLES,0,3);
    this.dirty=false;
  }
  step(dt){
    const k=1-Math.exp(-dt*6);
    this.mouse[0]+=(this.mouseT[0]-this.mouse[0])*k;this.mouse[1]+=(this.mouseT[1]-this.mouse[1])*k;
    this.hover+=(this.hoverT-this.hover)*(1-Math.exp(-dt*8));
    if(this.name==='stack'){ // springy count, so a new slab drops in and settles
      const a=(this.u1T-this.u1)*90-this.u1V*14;this.u1V+=a*dt;this.u1+=this.u1V*dt;
      this.hover=this.flash;this.flash*=Math.exp(-dt*2.2);
    }
    if(this.name==='ripple'){this.u1=this.flash;this.flash*=Math.exp(-dt*1.6);}
  }
}

const instances=[];
let webgl=true;
for(const canvas of document.querySelectorAll('canvas.dither')){
  try{instances.push(new Dither(canvas));}catch(e){webgl=false;console.warn('Dither disabled:',e.message);}
}
if(!webgl||!instances.length)document.documentElement.classList.add('no-webgl');
const byName=n=>instances.find(i=>i.name===n);

// pointer tracking: the hero follows the whole window; others follow their own frame
const hero=byName('lattice');
addEventListener('pointermove',e=>{
  if(hero){hero.mouseT=[e.clientX/innerWidth*2-1,-(e.clientY/innerHeight*2-1)];}
  const hud=document.querySelector('[data-hud="pointer"]');
  if(hud)hud.textContent=`X ${(e.clientX/innerWidth).toFixed(2)} Y ${(e.clientY/innerHeight).toFixed(2)}`;
},{passive:true});
for(const inst of instances){
  if(inst===hero)continue;
  const host=inst.canvas.parentElement;
  host.addEventListener('pointermove',e=>{const r=host.getBoundingClientRect();inst.mouseT=[(e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height*2-1)];inst.hoverT=1;},{passive:true});
  host.addEventListener('pointerleave',()=>{inst.hoverT=0;if(inst.name!=='wordmark')inst.mouseT=[0,0];});
  if(inst.def.hoverCell){
    host.addEventListener('pointerenter',()=>inst.setCell(inst.def.hoverCell));
    host.addEventListener('pointerleave',()=>inst.setCell(inst.def.cell));
  }
}
if(hero)hero.u1=matchMedia('(min-width: 821px)').matches?1:0;

// only render what's on screen
const io=new IntersectionObserver(entries=>{for(const e of entries){const inst=instances.find(i=>i.canvas===e.target);if(!inst)continue;inst.visible=e.isIntersecting;
  if(inst.video){if(e.isIntersecting&&!reduce)inst.video.play().catch(()=>{});else inst.video.pause();}
  if(e.isIntersecting)inst.dirty=true;}},{rootMargin:'80px'});
instances.forEach(i=>io.observe(i.canvas));

function resizeAll(){
  instances.forEach(i=>i.resize());
  if(hero)hero.u1=matchMedia('(min-width: 821px)').matches?1:0;
  const hud=document.querySelector('[data-hud="cells"]');
  if(hud&&hero)hud.textContent=`${hero.canvas.width} × ${hero.canvas.height} CELLS`;
  paintBands();
}
let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(resizeAll,80);});
document.fonts?.ready.then(()=>{const w=byName('wordmark');if(w){w.drawText();w.dirty=true;}});

let last=performance.now();
function loop(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  for(const i of instances){if(!i.visible)continue;if(reduce){i.step(1);if(i.dirty||i.video||i.name==='stack'||i.name==='wordmark')i.render(now);}else{i.step(dt);i.render(now);}}
  tickReels(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
const vid=document.getElementById('compose-video');
if(vid&&reduce)vid.addEventListener('loadeddata',()=>{const v=byName('video');if(v)v.dirty=true;});

// ---------- reels: timecodes, capture sequence, borrow cycle ----------
const reels=[...document.querySelectorAll('[data-reel]')].map(el=>({el,tc:el.querySelector('[data-timecode]'),scrub:el.querySelector('[data-scrub]'),start:performance.now()}));
const fmt=s=>{const f=Math.floor((s%1)*24),sec=Math.floor(s)%60,min=Math.floor(s/60);return [min,sec,f].map(n=>String(n).padStart(2,'0')).join(':');};
const capture=document.querySelector('.capture'),ripple=byName('ripple');
const terms=[...document.querySelectorAll('.borrow .term')],flow=byName('flow');
let capStep=-1,borrowIdx=-1;
function tickReels(now){
  for(const r of reels){
    const v=r.el.querySelector('video');
    const s=v&&v.duration?v.currentTime:(now-r.start)/1000;
    if(r.tc)r.tc.textContent=fmt(s);
    if(r.scrub&&v&&v.duration)r.scrub.style.width=(v.currentTime/v.duration*100)+'%';
  }
  if(capture){
    const t=reduce?5:((now/1000)%7);
    const step=t<.6?0:t<1.6?1:t<2.7?2:t<3.9?3:t<6.4?4:0;
    if(step!==capStep){capStep=step;capture.dataset.step=step;if(step===4&&ripple)ripple.flash=1;}
  }
  if(terms.length){
    const i=reduce?0:Math.floor((now/1600)%3);
    if(i!==borrowIdx){borrowIdx=i;terms.forEach((t,k)=>t.classList.toggle('on',k===i));if(flow)flow.u1=i;}
  }
}

// ---------- dithered gradient bands (CPU, once per resize) ----------
const B8=(()=>{let m=[[0]];for(let n=1;n<8;n*=2){const nx=[];for(let y=0;y<n*2;y++){nx.push([]);for(let x=0;x<n*2;x++){const q=(y<n?0:2)+(x<n?0:1);nx[y].push(4*m[y%n][x%n]+[0,2,3,1][q]);}}m=nx;}return m;})();
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function paintBands(){
  for(const el of document.querySelectorAll('.dband')){
    const cell=4,w=Math.ceil(el.clientWidth/cell),h=Math.ceil(el.clientHeight/cell);
    if(!w||!h||el.dataset.w==w&&el.dataset.h==h)continue;
    el.dataset.w=w;el.dataset.h=h;
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const x=c.getContext('2d'),img=x.createImageData(w,h),A=hex(el.dataset.from),B=hex(el.dataset.to);
    for(let y=0;y<h;y++){const t=y/(h-1),e=t*t*(3-2*t);for(let i=0;i<w;i++){const th=(B8[y&7][i&7]+.5)/64,col=e>th?B:A,o=(y*w+i)*4;img.data[o]=col[0];img.data[o+1]=col[1];img.data[o+2]=col[2];img.data[o+3]=255;}}
    x.putImageData(img,0,0);el.style.backgroundImage=`url(${c.toDataURL()})`;
  }
}

// ---------- builder ----------
const SKILLS=[
  {id:'run-checks',title:'Run release checks',by:'Sam',v:4,required:true,when:'Before tagging'},
  {id:'changelog',title:'Write the changelog',by:'Alex',v:2,required:true,when:'After checks pass'},
  {id:'tag-notes',title:'Tag and publish notes',by:'Sam',v:1,required:true,when:'Last'},
  {id:'docs-site',title:'Update the docs site',by:'Priya',v:3,required:false,when:'If public APIs changed'},
  {id:'launch-post',title:'Draft the launch post',by:'Maya',v:2,required:false,when:'For minor and major versions'},
  {id:'notify',title:'Notify affected customers',by:'Jordan',v:1,required:false,when:'If billing or data handling changes'},
];
const chipsEl=document.querySelector('[data-chips]'),defEl=document.querySelector('[data-definition]');
const statusEl=document.querySelector('[data-status]'),approveBtn=document.querySelector('[data-approve]');
const msgEl=document.querySelector('[data-msg]'),countEl=document.querySelector('[data-stack-count]');
const stack=byName('stack');
let picked=[],version=1,approved=false;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function highlight(obj){
  return esc(JSON.stringify(obj,null,2))
    .replace(/&quot;([^&]+)&quot;(?=:)/g,'<span class="k">"$1"</span>')
    .replace(/: &quot;(.*?)&quot;/g,': <span class="s">"$1"</span>')
    .replace(/^(\s+)&quot;(.*?)&quot;(,?)$/gm,'$1<span class="s">"$2"</span>$3')
    .replace(/: (\d+)/g,': <span class="n">$1</span>')
    .replace(/: (true|false)/g,': <span class="b">$1</span>');
}
function renderBuilder(){
  if(!chipsEl)return;
  const kids=picked.map(id=>SKILLS.find(s=>s.id===id));
  defEl.innerHTML=highlight({
    schema_version:1,
    title:'Ship a release',
    version,
    use_when:'Cutting any tagged release',
    outcome:'A checked, documented, announced release',
    checks:['Every required child reports done'],
    dependencies:kids.map(s=>({id:s.id,version:s.v,required:s.required,when:s.when})),
  });
  chipsEl.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',picked.includes(c.dataset.id)));
  countEl.textContent=picked.length;
  statusEl.textContent=approved?`Approved v${version}`:`Draft v${version}`;
  statusEl.classList.toggle('on',approved);
  approveBtn.textContent=`Approve v${version}`;
  approveBtn.disabled=approved||!picked.length;
  if(stack)stack.u1T=picked.length;
}
if(chipsEl){
  chipsEl.innerHTML=SKILLS.map(s=>`<button type="button" class="chip" data-id="${s.id}" aria-pressed="false"><span class="box" aria-hidden="true"></span>${esc(s.title)} <small>${esc(s.by)} · v${s.v}</small></button>`).join('');
  chipsEl.addEventListener('click',e=>{
    const b=e.target.closest('.chip');if(!b)return;
    const id=b.dataset.id;
    picked=picked.includes(id)?picked.filter(x=>x!==id):[...picked,id];
    if(approved){approved=false;version++;msgEl.textContent=`Editing makes a new draft. v${version-1} stays frozen.`;}
    else msgEl.textContent=picked.length?`${picked.length} pinned. ${picked.filter(id=>SKILLS.find(s=>s.id===id).required).length} required.`:'';
    renderBuilder();
  });
  approveBtn.addEventListener('click',()=>{
    approved=true;
    msgEl.textContent=`Frozen at v${version} with ${picked.length} pinned ${picked.length===1?'child':'children'}. Teammates' agents can borrow it now.`;
    if(stack)stack.flash=1;
    renderBuilder();
  });
  document.querySelector('[data-reset]').addEventListener('click',()=>{picked=[];version=1;approved=false;msgEl.textContent='';renderBuilder();});
  renderBuilder();
}

// ---------- misc ----------
const copyBtn=document.querySelector('[data-copy]');
copyBtn?.addEventListener('click',async()=>{
  const text=document.querySelector('[data-copy-src]').textContent.split('\n').filter(l=>!l.startsWith('#')&&l.trim()).join('\n');
  try{await navigator.clipboard.writeText(text);copyBtn.textContent='Copied';}catch{copyBtn.textContent='Select + copy';}
  setTimeout(()=>copyBtn.textContent='Copy',1600);
});
const nav=document.querySelector('.nav');const onScroll=()=>nav.classList.toggle('scrolled',scrollY>40);addEventListener('scroll',onScroll,{passive:true});onScroll();
const yr=document.querySelector('[data-year]');if(yr)yr.textContent=new Date().getFullYear();
resizeAll();
})();
