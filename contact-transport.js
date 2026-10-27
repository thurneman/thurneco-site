/* Transportlager för kontakt- och ansökningsformuläret (contact.js).
   contact.js postar till /api/contact. Sajten är statisk, så anropet omdirigeras här till
   Web3Forms (Pro, med bilagor), som mejlar till de adresser som är kopplade till formuläret,
   bland annat autopilot@thurneco.se där ATS-jobbet läser in kandidaten.
   Laddas efter contact.js. Rör inte contact.js, den ägs av designpaketet. */
(()=>{
 const KEY='e3095b35-44bc-44e0-8098-1786bfb5d1f0';   /* Web3Forms access key (publik), formulär registrerat på filip@thurneco.se */
 const ENDPOINT='https://api.web3forms.com/submit';
 const FALLBACK_TO='filip@thurneco.se';
 const MAX_FILE=5*1024*1024;   /* Web3Forms standarduppladdare tar högst 5 MB per fil */

 /* Bilagor går med i inskicket, så den gamla mailto-knappen "Skicka in med bifogat CV" döljs. */
 const style=document.createElement('style');
 style.textContent='.contact-form [data-attach]{display:none !important}';
 document.head.append(style);

 const originalFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  if(!/\/api\/contact$/.test(url))return originalFetch(input,init);
  return send(init?.body);
 };

 async function send(payload){
  const get=k=>(payload instanceof FormData?payload.get(k):null)||'';
  const files=payload instanceof FormData?payload.getAll('documents').filter(f=>f&&typeof f==='object'&&f.size>0):[];
  const data={
   name:get('name'),email:get('email'),message:get('message'),
   type:get('type')||'contact',
   phone:get('phone'),
   job_id:get('jobId'),job_title:get('jobTitle'),job_type:get('jobType'),
   linkedin:get('linkedin'),
   botcheck:get('website')?'1':''
  };
  const isApplication=data.type==='application';
  const subject=isApplication?`Ansökan: ${data.job_title} [${data.job_id}]`:`Kontakt via thurneco.se: ${data.name}`;
  if(!KEY){
   /* Ingen nyckel ännu: öppna ett mejl med samma innehåll så att inget går förlorat. */
   const body=`${data.message}\n\nNamn: ${data.name}\nE-post: ${data.email}${isApplication?`\nLinkedIn: ${data.linkedin||'-'}\nRoll: ${data.job_title} [${data.job_id}]`:''}\n`;
   window.location.href=`mailto:${FALLBACK_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
   return jsonResponse(502,{ok:false});
  }
  if(files.some(f=>f.size>MAX_FILE))return jsonResponse(413,{ok:false});
  try{
   /* multipart/form-data, utan egen Content-Type så att webbläsaren sätter boundary. */
   const fd=new FormData();
   fd.append('access_key',KEY);fd.append('subject',subject);fd.append('from_name','thurneco.se');fd.append('replyto',data.email);
   for(const [k,v] of Object.entries(data))fd.append(k,v);
   if(files.length){
    fd.append('attachment_count',String(files.length));
    files.forEach((f,i)=>fd.append(i===0?'attachment':`attachment${i+1}`,f,f.name));
   }
   const res=await originalFetch(ENDPOINT,{method:'POST',headers:{Accept:'application/json'},body:fd});
   const out=await res.json().catch(()=>({}));
   return jsonResponse(res.ok&&out.success!==false?200:502,{ok:res.ok&&out.success!==false});
  }catch{
   return jsonResponse(503,{ok:false});
  }
 }

 function jsonResponse(status,body){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 }

 /* Ansökan: LinkedIn obligatoriskt, meddelandet valfritt, CV bifogas direkt i formuläret. Kontakt: som designpaketet bestämt. */
 const patchOpen=()=>{
  const api=window.ThurneContact;if(!api||api.__thurnePatched)return false;
  const open=api.open;
  api.open=function(options={}){
   open.call(api,options);
   const form=document.querySelector('.contact-form');if(!form)return;
   const job=!!options.job,li=form.elements.linkedin,msg=form.elements.message,docs=form.elements.documents;
   li.required=job;msg.required=!job;
   msg.placeholder=job?'Kort om dig: upplägg (eget bolag eller underkonsult), när du är tillgänglig och ungefärligt timarvode.':'';
   const liLabel=form.querySelector('label[for="contact-linkedin"] span');if(liLabel)liLabel.textContent=job?'':'(valfritt)';
   const msgLabel=form.querySelector('label[for="contact-message"]');if(msgLabel&&job&&!msgLabel.querySelector('span')){const s=document.createElement('span');s.textContent=' (valfritt)';msgLabel.insertBefore(s,msg);}
   const help=form.querySelector('#contact-file-help');if(help)help.textContent='PDF eller Word. Högst 3 filer, högst 5 MB per fil.';
   if(docs&&!docs.__thurneSize){docs.__thurneSize=true;docs.addEventListener('change',()=>{const big=[...docs.files].some(f=>f.size>MAX_FILE);docs.setCustomValidity(big?'Varje fil får vara högst 5 MB. Spara CV:t som PDF om det är större.':'');if(big)docs.reportValidity();});}
   const note=form.querySelector('.contact-submit span');if(note)note.textContent=job?'Din ansökan och ditt CV går till Filip.':'Ditt meddelande går till Filip.';
  };
  api.__thurnePatched=true;return true;
 };
 if(!patchOpen()){document.addEventListener('DOMContentLoaded',patchOpen);setTimeout(patchOpen,0);}
})();
