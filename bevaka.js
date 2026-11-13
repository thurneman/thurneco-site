/* Bevaka jobb: kandidaten lämnar sin mejladress och hörs av när något passar.
   Återanvänder dialogen i contact.js (rörs inte) och transporten i contact-transport.js.
   Länken /lediga-jobb/?bevaka=1 öppnar rutan direkt. Inga personuppgifter läggs i adressen. */
(()=>{
 const TEXT={
  title:'Bevaka jobb',
  intro:'Lämna din mejl, så hör vi av oss när något passar. Allt utom mejladressen är valfritt.',
  label:'Vad letar du efter?',
  placeholder:'Skriv gärna några rader om vad du letar efter, eller annat som är värt att veta om dig. Länka, ladda upp eller beskriv, så brett som bara en bransch om du vill.',
  submit:'Starta bevakning ',
  note:'Vi använder dina uppgifter bara för att höra av oss om uppdrag som passar dig. Du kan avsluta när du vill.',
  done:'Tack! Bevakningen är igång. Vi hör av oss när något passar.'
 };
 let watching=false;
 const dialog=()=>document.querySelector('.contact-dialog');
 const labelText=(label,text)=>{if(label?.firstChild?.nodeType===3)label.firstChild.nodeValue=text;};

 function openWatch(){
  const api=window.ThurneContact;if(!api)return;
  const tab=document.querySelector('.career-tab[aria-selected="true"]')?.dataset.type;
  window.ThurneWatch={intresse:tab==='consulting'?'Konsultuppdrag':tab==='recruitment'?'Anställning':''};
  /* Ett sammanhang krävs för att contact.js ska skicka med LinkedIn och bilagor. Transporten känner igen id:t. */
  api.open({job:{id:'bevakning',title:'Bevakning av jobb',type:'watch'}});
  const d=dialog(),form=d?.querySelector('.contact-form');if(!form)return;
  watching=true;
  d.querySelector('#contact-title').textContent=TEXT.title;
  d.querySelector('#contact-intro').textContent=TEXT.intro;
  d.querySelector('.contact-role').hidden=true;
  const name=form.elements.name,nameLabel=form.querySelector('label[for="contact-name"]');
  name.required=false;
  if(nameLabel&&!nameLabel.querySelector('[data-watch-optional]')){const s=document.createElement('span');s.dataset.watchOptional='';s.textContent=' (valfritt)';nameLabel.insertBefore(s,name);}
  const phoneLabel=form.querySelector('label[for="contact-phone"]');if(phoneLabel)phoneLabel.hidden=true;
  form.elements.phone.disabled=true;
  form.elements.linkedin.required=false;
  const liSpan=form.querySelector('label[for="contact-linkedin"] span');if(liSpan)liSpan.textContent='(valfritt)';
  labelText(form.querySelector('label[for="contact-message"]'),TEXT.label);
  form.elements.message.required=false;form.elements.message.placeholder=TEXT.placeholder;form.elements.message.rows=6;
  const submit=form.querySelector('button[type=submit]:not([data-attach])');
  if(submit)submit.innerHTML=TEXT.submit+(submit.querySelector('svg')?.outerHTML||'');
  const note=form.querySelector('.contact-submit span');if(note)note.textContent=TEXT.note;
  form.elements.email.focus();
 }

 function restore(){
  if(!watching)return;watching=false;delete window.ThurneWatch;
  const form=dialog()?.querySelector('.contact-form');if(!form)return;
  form.elements.name.required=true;
  form.querySelector('[data-watch-optional]')?.remove();
  const phoneLabel=form.querySelector('label[for="contact-phone"]');if(phoneLabel)phoneLabel.hidden=false;
  labelText(form.querySelector('label[for="contact-message"]'),'Meddelande');form.elements.message.rows=4;
 }

 const init=()=>{
  const d=dialog();if(!d)return;
  d.addEventListener('close',restore);
  const success=d.querySelector('.contact-success');
  if(success)new MutationObserver(()=>{if(watching&&!success.hidden)success.querySelector('p').textContent=TEXT.done;}).observe(success,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('click',event=>{if(event.target.closest('[data-watch]'))openWatch();});
  if(new URLSearchParams(location.search).has('bevaka'))openWatch();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
