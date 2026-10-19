/* Shared contact and application dialog. Mail delivery is provided by /api/contact. */
(()=>{
 if(window.ThurneContact)return;
 const arrow='<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
 const dialog=document.createElement('dialog');
 dialog.className='contact-dialog';dialog.setAttribute('aria-labelledby','contact-title');dialog.setAttribute('aria-describedby','contact-intro');
 dialog.innerHTML=`<div class="contact-dialog-inner"><button class="contact-close" type="button" aria-label="Stäng formuläret"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><p class="eyebrow">Thurne Consulting</p><h2 id="contact-title">Skriv till Filip</h2><p id="contact-intro">Berätta vad du har i tankarna, så hör jag av mig.</p><p class="contact-role" hidden></p><form class="contact-form" action="/api/contact" method="post" enctype="multipart/form-data"><div class="contact-fields"><label for="contact-name">Namn<input id="contact-name" name="name" autocomplete="name" maxlength="120" required></label><label for="contact-email">E-postadress<input id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" required></label></div><label for="contact-message">Meddelande<textarea id="contact-message" name="message" rows="4" maxlength="5000" required></textarea></label><div class="contact-application" hidden><label for="contact-linkedin">LinkedIn-profil <span>(valfritt)</span><input id="contact-linkedin" name="linkedin" type="url" inputmode="url" maxlength="500" placeholder="https://www.linkedin.com/in/ditt-namn"></label><label for="contact-documents">CV och andra underlag <span>(valfritt)</span><input id="contact-documents" name="documents" type="file" accept=".pdf,.doc,.docx" multiple aria-describedby="contact-file-help"></label><p id="contact-file-help" class="contact-help">PDF eller Word. Högst 3 filer, totalt 10 MB.</p></div><div class="contact-trap" aria-hidden="true"><label>Webbplats<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="contact-status" role="status" aria-live="polite" hidden></p><div class="contact-submit"><button type="submit" class="button">Skicka meddelande ${arrow}</button><span>Ditt meddelande går till Filip.</span></div></form><div class="contact-success" hidden><p>Tack! Ditt meddelande har skickats till Filip.</p><button type="button" class="button" data-contact-done>Stäng ${arrow}</button></div></div>`;
 document.querySelector('.thurne-site').append(dialog);
 const form=dialog.querySelector('form'),status=dialog.querySelector('.contact-status'),submit=form.querySelector('[type=submit]'),application=dialog.querySelector('.contact-application'),role=dialog.querySelector('.contact-role');
 let context=null,opener=null,pending=false;
 const showStatus=text=>{status.textContent=text;status.hidden=false;};
 const close=()=>dialog.close();
 dialog.querySelector('.contact-close').addEventListener('click',close);
 dialog.querySelector('[data-contact-done]').addEventListener('click',close);
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
 dialog.addEventListener('close',()=>{document.documentElement.classList.remove('contact-open');if(opener?.isConnected)opener.focus();});
 window.ThurneContact={open(options={}){
  if(pending)return;
  opener=document.activeElement;context=options.job||null;
  form.reset();for(const input of form.elements)input.setCustomValidity?.('');status.hidden=true;status.textContent='';form.hidden=false;dialog.querySelector('.contact-success').hidden=true;
  application.hidden=!context;application.querySelectorAll('input').forEach(input=>input.disabled=!context);role.hidden=!context;role.textContent=context?.title||'';
  dialog.querySelector('#contact-title').textContent=context?(context.type==='consulting'?'Ansök till uppdraget':'Ansök till tjänsten'):'Skriv till Filip';
  dialog.querySelector('#contact-intro').textContent=context?'Berätta kort om dig själv och ditt intresse för rollen.':'Berätta vad du har i tankarna, så hör jag av mig.';
  submit.innerHTML=(context?'Skicka ansökan ':'Skicka meddelande ')+arrow;
  document.documentElement.classList.add('contact-open');if(!dialog.open)dialog.showModal();
  dialog.querySelector(options.focusProfile&&context?'#contact-linkedin':'#contact-name').focus();
 }};
 document.addEventListener('click',event=>{const trigger=event.target.closest('[data-contact]');if(!trigger)return;event.preventDefault();window.ThurneContact.open();});
 const linkedin=form.elements.linkedin,documents=form.elements.documents;
 linkedin.addEventListener('input',()=>linkedin.setCustomValidity(''));
 documents.addEventListener('change',()=>documents.setCustomValidity(''));
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(pending)return;
  if(context&&linkedin.value.trim()){
   try{const url=new URL(linkedin.value.trim());if(url.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(url.hostname.toLowerCase())||!/^\/in\/[^/]+\/?$/.test(url.pathname)||url.username||url.password)throw Error();}
   catch{linkedin.setCustomValidity('Ange en länk till en LinkedIn-profil, till exempel https://www.linkedin.com/in/ditt-namn');linkedin.reportValidity();return;}
  }
  const files=context?[...documents.files]:[];
  if(files.length>3||files.reduce((sum,file)=>sum+file.size,0)>10*1024*1024||files.some(file=>! /\.(pdf|docx?)$/i.test(file.name))){documents.setCustomValidity('Välj högst 3 PDF- eller Word-filer på sammanlagt högst 10 MB.');documents.reportValidity();return;}
  if(!form.reportValidity())return;
  if(window.THURNE_PREVIEW){showStatus('Det här är ett utkast. Ditt meddelande har inte skickats.');return;}
  const payload=new FormData(form);payload.set('name',form.elements.name.value.trim());payload.set('email',form.elements.email.value.trim());payload.set('message',form.elements.message.value.trim());payload.set('type',context?'application':'contact');
  payload.delete('documents');for(const file of files)payload.append('documents',file);
  if(context){payload.set('jobId',context.id);payload.set('jobTitle',context.title);payload.set('jobType',context.type);payload.set('linkedin',linkedin.value.trim());}else payload.delete('linkedin');
  pending=true;submit.disabled=true;form.setAttribute('aria-busy','true');showStatus('Skickar…');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch('/api/contact',{method:'POST',body:payload,headers:{Accept:'application/json'},credentials:'same-origin',signal:controller.signal});
   const result=await response.json();if(!response.ok||result.ok!==true)throw Error('Not accepted');
   form.hidden=true;dialog.querySelector('.contact-success').hidden=false;dialog.querySelector('.contact-success p').textContent=context?'Tack! Din ansökan har skickats till Filip.':'Tack! Ditt meddelande har skickats till Filip.';dialog.querySelector('[data-contact-done]').focus();
  }catch{showStatus('Vi kunde inte bekräfta att meddelandet skickades. Din text finns kvar. Försök igen eller mejla filip@thurneco.se.');}
  finally{clearTimeout(timer);pending=false;submit.disabled=false;form.removeAttribute('aria-busy');}
 });
})();
