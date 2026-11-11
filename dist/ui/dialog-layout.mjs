export function layoutDialogForm(dialog) {
  const form=dialog.querySelector('.dialog-body > form');
  let footer=form?.querySelector('.form-actions');
  if(!footer){const submit=form?.querySelector('[type=submit]');if(!submit||submit.parentElement!==form)return;footer=form.ownerDocument.createElement('div');footer.className='form-actions';footer.append(submit);form.append(footer);}
  const content=form.ownerDocument.createElement('div');
  content.className='dialog-form-content';
  if(form.classList.contains('form-grid')){
    form.classList.remove('form-grid');
    content.classList.add('form-grid');
  }
  footer.remove();
  content.append(...form.childNodes);
  form.append(content,footer);
  form.classList.add('dialog-form');
}
