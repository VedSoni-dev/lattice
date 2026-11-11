// Renders the landing page's media with no external assets.
//   media/compose.mp4   smooth grayscale video of a skill tree growing (dithered live on the page)
//   media/compose.gif   the same clip, ordered-dithered (README)
//   media/lattice.gif   a dithered fly-through of a 3D lattice (page + README)
// Requires ffmpeg on PATH. Run: node scripts/make-media.mjs
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';

const INK=[11,12,14],PAPER=[236,234,226],ACCENT=[62,99,255];
await mkdir('media',{recursive:true});

const bayer=(()=>{const m=[[0]];let n=1;while(n<8){const next=[];for(let y=0;y<n*2;y++){next.push([]);for(let x=0;x<n*2;x++){const q=(y<n?0:2)+(x<n?0:1),v=[0,2,3,1][q];next[y].push(4*m[y%n][x%n]+v);}}m.length=0;m.push(...next);n*=2;}return (x,y)=>(m[y&7][x&7]+.5)/64;})();

function encode(file,w,h,fps,frames,args){
  return new Promise((ok,fail)=>{
    const p=spawn('ffmpeg',['-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgb24','-s',`${w}x${h}`,'-r',String(fps),'-i','-',...args,file],{stdio:['pipe','inherit','inherit']});
    p.on('error',fail);p.on('close',c=>c?fail(new Error('ffmpeg failed for '+file)):ok());
    for(const f of frames)p.stdin.write(f);p.stdin.end();
  });
}
const gifArgs=s=>['-vf',`scale=iw*${s}:ih*${s}:flags=neighbor,split[a][b];[a]palettegen=max_colors=4:reserve_transparent=0:stats_mode=full[p];[b][p]paletteuse=dither=none`,'-loop','0'];

// Ordered dither of a (lum, accent) field into the three brand colours.
function dither(lum,acc,w,h){
  const out=Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,t=bayer(x,y),c=acc[i]>t?ACCENT:lum[i]>t?PAPER:INK;
    out[i*3]=c[0];out[i*3+1]=c[1];out[i*3+2]=c[2];
  }
  return out;
}
function smooth(lum,acc,w,h){
  const out=Buffer.alloc(w*h*3);
  for(let i=0;i<w*h;i++){const a=Math.min(1,acc[i]),l=Math.min(1,lum[i])*(1-a);for(let k=0;k<3;k++)out[i*3+k]=Math.round(INK[k]*(1-l-a)+PAPER[k]*l+ACCENT[k]*a);}
  return out;
}

// ---- compose: foundation skills appear, composed skills build on them, pulses climb the edges.
{
  const W=320,H=240,FPS=24,N=168;
  const rows=[
    [{x:40,y:200},{x:100,y:200},{x:160,y:200},{x:220,y:200},{x:280,y:200}],
    [{x:70,y:130,c:[0,1]},{x:160,y:130,c:[1,2,3]},{x:250,y:130,c:[3,4]}],
    [{x:115,y:62,c:[0,1]},{x:205,y:62,c:[1,2]}],
    [{x:160,y:16,c:[0,1]}],
  ];
  const ease=x=>x<=0?0:x>=1?1:1-Math.pow(1-x,3);
  const segDist=(px,py,ax,ay,bx,by)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));return [Math.hypot(px-ax-dx*t,py-ay-dy*t),t];};
  const lumFrames=[],dith=[],sm=[];
  for(let f=0;f<N;f++){
    const T=f/N,lum=new Float32Array(W*H),acc=new Float32Array(W*H);
    const fade=T>.9?1-(T-.9)/.1:1;
    const prims=[];
    rows.forEach((row,r)=>row.forEach((n,i)=>{
      const born=.04+r*.17+i*.025,g=ease((T-born)/.1)*fade;
      if(g<=0)return;
      prims.push({type:'node',x:n.x,y:n.y,r:(r===3?9:r?7:5.5)*g,g,top:r===3});
      (n.c||[]).forEach(ci=>{const ch=rows[r-1][ci];prims.push({type:'edge',ax:ch.x,ay:ch.y,bx:n.x,by:n.y,g,pulse:(T*3+i*.3+ci*.17)%1});});
    }));
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x;
      let l=(x%16===0&&y%16===0)?.5:(x%16===0||y%16===0)?.045:0;
      let a=0;
      for(const p of prims){
        if(p.type==='edge'){
          const [d,t]=segDist(x,y,p.ax,p.ay,p.bx,p.by);
          const drawn=t<=p.g;
          if(drawn)l=Math.max(l,.5*Math.max(0,1-d/1.4));
          const pd=Math.hypot(x-(p.ax+(p.bx-p.ax)*p.pulse),y-(p.ay+(p.by-p.ay)*p.pulse));
          if(p.g>.99)a=Math.max(a,Math.max(0,1-pd/5)*.95*fade);
        }else{
          const d=Math.hypot(x-p.x,y-p.y);
          if(d<p.r+12)l=Math.max(l,.18*Math.max(0,1-(d-p.r)/12)*p.g);
          if(d<p.r)l=Math.max(l,p.top?.6+.4*(d/p.r):.95-.35*(d/p.r));
          if(p.top&&d<p.r)a=Math.max(a,.85*p.g);
          if(Math.abs(d-p.r-3)<.8)l=Math.max(l,.7*p.g);
        }
      }
      lum[i]=l;acc[i]=a;
    }
    lumFrames.push(1);dith.push(dither(lum,acc,W,H));sm.push(smooth(lum,acc,W,H));
  }
  await encode('media/compose.mp4',W,H,FPS,sm,['-vf','scale=640:480:flags=bicubic','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-movflags','+faststart','-an']);
  await encode('media/compose.gif',W,H,FPS,dith,gifArgs(2));
  console.log('compose: '+N+' frames');
}

// ---- lattice: a seamless fly-through (the camera travels exactly one cell per loop).
{
  const W=240,H=160,FPS=24,N=96;
  const fr=v=>v-Math.floor(v);
  const sdf=(x,y,z)=>{const qx=fr(x)-.5,qy=fr(y)-.5,qz=fr(z)-.5;
    const s=Math.sqrt(qx*qx+qy*qy+qz*qz)-.16;
    const r=Math.min(Math.hypot(qy,qz),Math.hypot(qx,qz),Math.hypot(qx,qy))-.022;
    return [Math.min(s,r),s<r];};
  const hash=(a,b,c)=>fr(Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453);
  const frames=[];
  for(let f=0;f<N;f++){
    const T=f/N,lum=new Float32Array(W*H),acc=new Float32Array(W*H);
    const cz=T,yaw=.35*Math.sin(T*Math.PI*2),pitch=.18;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){
      let dx=(i-W/2)/H,dy=(H/2-j)/H,dz=.9;
      const L=Math.hypot(dx,dy,dz);dx/=L;dy/=L;dz/=L;
      let ty=dy*cp-dz*sp,tz=dy*sp+dz*cp;dy=ty;dz=tz;
      let tx=dx*cy+dz*sy;tz=-dx*sy+dz*cy;dx=tx;dz=tz;
      let d=0,hit=false,node=false,px=0,py=0,pz=0;
      for(let k=0;k<70&&d<14;k++){px=dx*d;py=.02+dy*d;pz=cz+dz*d;const [s,n]=sdf(px,py,pz);if(s<.002){hit=true;node=n;break;}d+=s;}
      const idx=j*W+i;
      if(!hit){lum[idx]=0;continue;}
      const e=.002,b=sdf(px,py,pz)[0];
      let nx=sdf(px+e,py,pz)[0]-b,ny=sdf(px,py+e,pz)[0]-b,nz=sdf(px,py,pz+e)[0]-b;const nl=Math.hypot(nx,ny,nz)||1;nx/=nl;ny/=nl;nz/=nl;
      const diff=Math.max(0,nx*.45+ny*.75-nz*.48),rim=Math.pow(1-Math.max(0,-(nx*dx+ny*dy+nz*dz)),2);
      const fog=Math.exp(-d*.34);
      lum[idx]=Math.pow(Math.min(1,(.1+.85*diff+.4*rim)*fog),1.25);
      if(node){const h=hash(Math.floor(px),Math.floor(py),Math.floor(pz));if(h>.78){const pulse=.5+.5*Math.sin(Math.PI*2*(T*2+h*7));acc[idx]=(.25+.8*pulse)*fog*(.6+diff);}}
    }
    frames.push(dither(lum,acc,W,H));
  }
  await encode('media/lattice.gif',W,H,FPS,frames,gifArgs(2));
  console.log('lattice: '+N+' frames');
}

// ---- dither-band.png: a tileable ordered-dither fade (transparent -> accent), used by the workspace UI.
{
  const W=64,H=24,px=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const t=1-y/(H-1),e=t*t*(3-2*t),on=e*.85>bayer(x,y),o=(y*W+x)*4;if(on){px[o]=ACCENT[0];px[o+1]=ACCENT[1];px[o+2]=ACCENT[2];px[o+3]=255;}}
  await new Promise((ok,fail)=>{const p=spawn('ffmpeg',['-y','-loglevel','error','-f','rawvideo','-pix_fmt','rgba','-s',`${W}x${H}`,'-i','-','-frames:v','1','-pix_fmt','rgba','media/dither-band.png'],{stdio:['pipe','inherit','inherit']});p.on('error',fail);p.on('close',c=>c?fail(new Error('band')):ok());p.stdin.end(px);});
  console.log('dither-band.png');
}
