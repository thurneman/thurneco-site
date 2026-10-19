/* Transportlager för kontakt- och ansökningsformuläret (contact.js).
   contact.js postar till /api/contact. Sajten är statisk, så anropet omdirigeras här till
   Web3Forms, som mejlar till autopilot@thurneco.se där ATS-jobbet läser in kandidaten.
   Laddas efter contact.js. Rör inte contact.js, den ägs av designpaketet. */
(()=>{
 const KEY='';   /* Web3Forms access key, kopplad till autopilot@thurneco.se */
 const ENDPOINT='https://api.web3forms.com/submit';
 const FALLBACK_TO='filip@thurneco.se';

 /* Bilagor skickas inte (kräver betald formulärtjänst). Dölj filfältet, be om länk i meddelandet. */
 const style=document.createElement('style');
 style.textContent='.contact-application label[for="contact-documents"],#contact-file-help{display:none}';
 document.head.append(style);

 const originalFetch=window.fetch.bind(window);
 window.fetch=function(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  if(!/\/api\/contact$/.test(url))return originalFetch(input,init);
  return send(init?.body);
 };

 async function send(payload){
  const get=k=>(payload instanceof FormData?payload.get(k):null)||'';
  const data={
   name:get('name'),email:get('email'),message:get('message'),
   type:get('type')||'contact',
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
  try{
   const res=await originalFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({
    access_key:KEY,subject,from_name:'thurneco.se',replyto:data.email,...data
   })});
   const out=await res.json().catch(()=>({}));
   return jsonResponse(res.ok&&out.success!==false?200:502,{ok:res.ok&&out.success!==false});
  }catch{
   return jsonResponse(503,{ok:false});
  }
 }

 function jsonResponse(status,body){
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 }

 /* Ansökan: LinkedIn obligatoriskt, meddelandet valfritt. Kontakt: som designpaketet bestämt. */
 const patchOpen=()=>{
  const api=window.ThurneContact;if(!api||api.__thurnePatched)return false;
  const open=api.open;
  api.open=function(options={}){
   open.call(api,options);
   const form=document.querySelector('.contact-form');if(!form)return;
   const job=!!options.job,li=form.elements.linkedin,msg=form.elements.message;
   li.required=job;msg.required=!job;
   msg.placeholder=job?'Kort om dig. Länk till CV (OneDrive, Google Drive, Dropbox) går bra att lägga här.':'';
   const liLabel=form.querySelector('label[for="contact-linkedin"] span');if(liLabel)liLabel.textContent=job?'':'(valfritt)';
   const msgLabel=form.querySelector('label[for="contact-message"]');if(msgLabel&&job&&!msgLabel.querySelector('span')){const s=document.createElement('span');s.textContent=' (valfritt)';msgLabel.insertBefore(s,msg);}
   const note=form.querySelector('.contact-submit span');if(note)note.textContent=job?'Din ansökan går till Filip.':'Ditt meddelande går till Filip.';
  };
  api.__thurnePatched=true;return true;
 };
 if(!patchOpen()){document.addEventListener('DOMContentLoaded',patchOpen);setTimeout(patchOpen,0);}
})();
