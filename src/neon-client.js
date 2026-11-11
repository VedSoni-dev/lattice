export function createNeonClient(){
  const listeners=new Set();
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('lattice-auth'):null;
  const notify=(event,session)=>{for(const fn of listeners)fn(event,session);};
  async function request(action,body){
    const response=await fetch('/api/auth?action='+action,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to sign in.');return data;
  }
  channel?.addEventListener('message',async()=>{try{const {session}=await request('session');notify(session?'SIGNED_IN':'SIGNED_OUT',session);}catch{}});
  return {
    requestAuth:request,
    auth:{
      async getSession(){return {data:await request('session')};},
      async signOut(){await request('logout',{});notify('SIGNED_OUT',null);channel?.postMessage('changed');return {error:null};},
      onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};}
    },
    async rpc(_name,input){try{const response=await fetch('/api/workspace',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not update your workspace.');return {data:result.data,error:null};}catch(error){return {data:null,error};}}
  };
}
